import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { roles, orchestrates } from './profiles.mjs';
import { files, hash } from './package.mjs';
import { spawnKit } from './spawn-kit.mjs';

// A Role bundle is the exact policy bytes a role receives at session entry.
// This module owns the load-path contract that docs/guide-coverage.md documents:
// which policy files reach which role, and in what order. Both transport
// adapters and the create_agent planner read it from here.

// orchestrates lives in profiles.mjs so spawn-kit.mjs can read it without a
// role-bundle -> spawn-kit -> role-bundle cycle; re-exported to keep the API.
export { orchestrates };

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

// The declared locator set a role's carrier ships: fixed policy surface plus
// every references file, each stat'ed under root — present files report byte
// size + sha256, absent ones a missing marker. Entries sort by absolute path
// so the list carries no bundle/load-order hint. launch.mjs orientation()
// renders the same list into the plan's manifest; a root without
// src/references (a broken or foreign runtime root) yields only missing
// markers instead of throwing — the seat still gets its instructions.
export function policyLocators(root, role) {
  let references = [];
  try { references = files(root, 'src/references'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const declared = ['docs/contract.md', 'src/common.md', `src/roles/${role}.md`,
    ...(orchestrates(role) ? ['src/delegation.md'] : []),
    ...references];
  return declared.map(path => {
    const absolute = join(root, path);
    let stat;
    try { stat = statSync(absolute); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!stat?.isFile()) return { path: absolute, missing: true };
    const bytes = readFileSync(absolute);
    return { path: absolute, bytes: bytes.length, sha256: hash(bytes) };
  }).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// The carrier is the self-contained block that actually reaches the spawned
// seat. prepare appends it to create.initialPrompt (the only field
// create_agent transmits); role-bundle appends it to session-entry
// instructions so seats launched through a provider profile receive the same
// payload. Same text both ways — absolute policy locators (missing markers
// included) and the approximate kit signatures, no file contents inlined. The
// caption names when the locator values were measured: plan-time wording for
// the prepare path, load-time wording for session entry.
export function carrierBlock(kit, locators, caption) {
  const lines = locators.map(entry => entry.missing
    ? `- ${entry.path} — declared but not shipped in this install`
    : `- ${entry.path} — ${entry.bytes} bytes, sha256 ${entry.sha256}`);
  return `\nSpawn kit — role-scoped Paseo MCP signatures (${kit.note}):\n`
    + kit.tools.map(tool => `- ${tool}`).join('\n')
    + `\nPolicy locators — ${caption}:\n`
    + lines.join('\n') + '\n';
}

// Session-entry locators are measured when the bundle renders, not at plan
// time, so the caption must not borrow the prepare path's wording.
const sessionLocatorCaption = 'absolute paths; size/sha256 were measured when these role instructions loaded; verify the file found is the one measured';

export function roleBundle(root, role, env = process.env, options = {}) {
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
    `Use the current authorized Human or delegated assignment and its Paseo workspace. Notifications and heartbeat prompts do not replace that assignment.\n` +
    // Callers that append the carrier themselves (launch.mjs prompt()) opt out
    // here so the block never appears twice in one prompt.
    (options.carrier === false ? '' : carrierBlock(spawnKit(role), policyLocators(policyRoot, role), sessionLocatorCaption));
  return { role, parts, orchestrates: orchestrates(role), instructions };
}

export const roleInstructions = (root, role, env = process.env, options) => roleBundle(root, role, env, options).instructions;
