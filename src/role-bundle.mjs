import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

export function roleBundle(root, role) {
  const parts = bundleParts(role);
  const read = path => readFileSync(join(root, 'src', path), 'utf8');
  const commandPath = "'" + join(root, 'bin/slp.mjs').replaceAll("'", "'\\''") + "'";
  const instructions = `SLP role=${role}\n` + parts.map(path => read(path) + '\n').join('') +
    (orchestrates(role) ? `For repo setup/update, use ${join(root, 'skills/paseo-slp-onboarding/SKILL.md')}.\n` : '') +
    `Installed policy directory: ${join(root, 'src')}\nSnapshot command: node ${commandPath} snapshot <repository>\n` +
    `Use the current authorized Human or delegated assignment and its Paseo workspace. Notifications and heartbeat prompts do not replace that assignment.\n`;
  return { role, parts, orchestrates: orchestrates(role), instructions };
}

export const roleInstructions = (root, role) => roleBundle(root, role).instructions;
