import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { roles } from './profiles.mjs';

// A Role bundle is the exact policy bytes a role receives at session entry.
// This module owns the load-path contract that docs/guide-coverage.md documents:
// which policy files reach which role, and in what order. Both transport
// adapters and the create_agent planner read it from here.

// Supervisor and Lead orchestrate; Peer owns one bounded outcome and never spawns.
export const orchestrates = role => role !== 'peer';

export function bundleParts(role) {
  if (!roles.includes(role)) throw new Error('Unknown role');
  return ['common.md', `roles/${role}.md`, ...(orchestrates(role) ? ['delegation.md'] : [])];
}

// POSIX single-quote escaping for one shell argument.
const shq = value => "'" + value.replaceAll("'", "'\\''") + "'";

// Managed launch (spec §10): the plugin dispatcher freezes the verified Node,
// the stable candidate root and the canonical daemon home in the provider env.
// Helper text must render those absolute paths verbatim — a missing or
// relative value means the launch env is broken, so fail rather than render
// commands that would resolve the wrong runtime or home.
function managedRuntime(env) {
  if (env.SLP_MANAGED_RUNTIME !== '1') return null;
  const need = name => {
    const value = env[name];
    if (typeof value !== 'string' || !isAbsolute(value)) throw new Error(`Managed runtime requires absolute ${name}`);
    return value;
  };
  return { node: need('SLP_NODE_BIN'), runtimeRoot: need('SLP_RUNTIME_ROOT'), daemonHome: need('SLP_DAEMON_HOME') };
}

// The home-dependent helpers, each rendered with the explicit daemon home so
// no invocation silently resolves a default or foreign home. monitor takes the
// home inside its request JSON. install/upgrade/uninstall are standalone-
// install operations — never this managed runtime's lifecycle — but they are
// listed so an authorized use still names the home explicitly.
function managedHelpers(cli, home) {
  const q = shq(home);
  return `Managed runtime helpers (SLP_MANAGED_RUNTIME=1) — always this verified Node, stable runtime CLI and explicit daemon home:\n` +
    `  ${cli} routes <repository> --paseo-home ${q}\n` +
    `  ${cli} inventory --paseo-home ${q}\n` +
    `  ${cli} agents --paseo-home ${q}\n` +
    `  ${cli} notebook <repository> --paseo-home ${q}\n` +
    `  ${cli} monitor <request.json> — the request must carry "paseoHome": ${JSON.stringify(home)}\n` +
    `  ${cli} install <dir> --paseo-home ${q} — standalone installs only; the plugin owns this runtime's lifecycle\n` +
    `  upgrade/uninstall take no home flag — the target installation's paseo-binding.json must record ${q}; verify it before running them\n` +
    `  init/materialize/snapshot/prepare/prepare-handoff/verify are repo-scoped: they take explicit paths and never touch a daemon home.\n`;
}

export function roleBundle(root, role, env = process.env) {
  const parts = bundleParts(role);
  const read = path => readFileSync(join(root, 'src', path), 'utf8');
  const managed = managedRuntime(env);
  // Managed sessions render the verified absolute Node and the stable runtime
  // CLI; unmanaged sessions keep the historical `node <bin/slp.mjs>` form.
  const cli = managed
    ? `${shq(managed.node)} ${shq(join(managed.runtimeRoot, 'bin/slp.mjs'))}`
    : `node ${shq(join(root, 'bin/slp.mjs'))}`;
  // Policy text may name only the managed runtime root — never this checkout's
  // path — so the skill/policy locators derive from policyRoot, not root.
  const policyRoot = managed ? managed.runtimeRoot : root;
  const policyDir = join(policyRoot, 'src');
  const instructions = `SLP role=${role}\n` + parts.map(path => read(path) + '\n').join('') +
    (orchestrates(role) ? `For repo setup/update, use ${join(policyRoot, 'skills/paseo-slp-onboarding/SKILL.md')}.\n` : '') +
    `Installed policy directory: ${policyDir}\nSnapshot command: ${cli} snapshot <repository>\n` +
    (managed ? managedHelpers(cli, managed.daemonHome) : '') +
    `Use the current authorized Human or delegated assignment and its Paseo workspace. Notifications and heartbeat prompts do not replace that assignment.\n`;
  return { role, parts, orchestrates: orchestrates(role), instructions };
}

export const roleInstructions = (root, role, env = process.env) => roleBundle(root, role, env).instructions;
