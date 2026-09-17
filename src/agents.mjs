import { readdirSync, readFileSync, lstatSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { paseoHome } from './routing.mjs';
import { devinProviderPattern } from './binding.mjs';

// Agent state lives under <paseoHome>/agents/<group>/<agentId>.json; the daemon
// owns it. `paseo inspect --json` does not surface persistence.nativeHandle, so
// linking a Devin ACP session back to `devin -r` requires reading persistence
// here — a best-effort host detail, not a contract. Read-only: never writes.
const text = value => typeof value === 'string' && value ? value : null;
const shellQuote = value => /\s/.test(value) ? JSON.stringify(value) : value;

const attachHint = (provider, cwd, nativeHandle) =>
  devinProviderPattern.test(provider ?? '') && cwd && nativeHandle
    ? `cd ${shellQuote(cwd)} && devin -r ${shellQuote(nativeHandle)}`
    : null;

export function agents(home = paseoHome()) {
  if (typeof home !== 'string' || !isAbsolute(home)) throw new Error('Absolute Paseo home required');
  const dir = join(home, 'agents');
  let groups;
  try { groups = readdirSync(dir); } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const result = [];
  for (const group of groups) {
    const groupDir = join(dir, group);
    let names;
    try {
      if (!lstatSync(groupDir).isDirectory()) continue;
      names = readdirSync(groupDir);
    } catch { continue; }
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      let state;
      try { state = JSON.parse(readFileSync(join(groupDir, name), 'utf8')); } catch { continue; }
      if (state === null || typeof state !== 'object' || typeof state.id !== 'string') continue;
      const provider = text(state.provider) ?? text(state.persistence?.provider);
      const cwd = text(state.cwd) ?? text(state.persistence?.metadata?.cwd);
      const nativeHandle = text(state.persistence?.nativeHandle);
      result.push({
        id: state.id,
        title: text(state.title),
        provider,
        cwd,
        workspaceId: text(state.workspaceId),
        status: text(state.lastStatus) ?? text(state.status),
        lastActivityAt: text(state.lastActivityAt),
        nativeHandle,
        attach: attachHint(provider, cwd, nativeHandle),
      });
    }
  }
  return result.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
