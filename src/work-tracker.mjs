import { execFileSync } from 'node:child_process';
import { accessSync, constants, readFileSync, statSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import { roles } from './profiles.mjs';

// Beads (`bd`) work-tracker detection and the session-entry pointer.
// Detect, never install (spec §2): nothing here downloads, installs,
// initializes, upgrades or configures beads — no `bd init`, `bd setup`,
// `bd hooks install`, `bd sync`/`bd dolt push`, and no edits to beads config.
// A missing or broken tracker is a gap carried in the result, never a thrown
// error and never a spawn blocker (spec §3.6).
//
// Parity note: readWorkTrackerSetting below is mirrored by
// plugin/server/work-tracker.ts readSetting — absent file = disabled,
// unparseable or foreign-shape file = disabled plus a surfaced error string,
// non-ENOENT filesystem errors propagate. The plugin's file root is its
// stableRoot (<daemonHome>/slp-runtime); this module takes the daemon home.
// beadsSeatEnv and the bd detection/version-parse logic are likewise mirrored
// (the plugin cannot import package code — the no-cross-boundary rule), so
// keep the argument order, defaults and error strings aligned. tests/
// work-tracker.test.mjs pins identical results on the same fixtures.

// The tracker enablement flag, relative to the daemon home. Sole writer is
// the manager surface via the set-work-tracker RPC (atomic 0600 whole-file
// write); this module and the seat CLI only ever read it.
export const WORK_TRACKER_FILE = 'slp-runtime/state/work-tracker.json';

// The five schema checks and their reason strings are the wire between this
// reader and the plugin's — a mismatch must surface identically on both sides.
const schemaFail = reason => `work-tracker.json failed schema validation: ${reason}`;

export function readWorkTrackerSetting(daemonHome) {
  let raw;
  try {
    raw = readFileSync(join(daemonHome, WORK_TRACKER_FILE), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { enabled: false, error: null };
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { enabled: false, error: `work-tracker.json is not valid JSON: ${error.message}` };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { enabled: false, error: schemaFail('expected an object') };
  }
  if (parsed.schemaVersion !== 1) return { enabled: false, error: schemaFail('expected schemaVersion 1') };
  if (parsed.tracker !== 'beads') return { enabled: false, error: schemaFail('expected tracker "beads"') };
  if (typeof parsed.enabled !== 'boolean') return { enabled: false, error: schemaFail('expected enabled to be a boolean') };
  const extra = Object.keys(parsed).filter(key => !['schemaVersion', 'tracker', 'enabled'].includes(key)).sort();
  if (extra.length > 0) return { enabled: false, error: schemaFail(`unexpected keys: ${extra.join(', ')}`) };
  return { enabled: parsed.enabled, error: null };
}

// First executable `bd` on the caller's PATH, in order. Only absolute PATH
// entries are eligible — a relative entry would resolve against whatever cwd
// the probe happens to run in. On Windows the binary lands as bd.exe; plain
// `bd` is checked last there so an extensionless shim cannot shadow it.
export function findBd(env = process.env) {
  const pathEnv = typeof env?.PATH === 'string' ? env.PATH : '';
  const names = process.platform === 'win32' ? ['bd.exe', 'bd.cmd', 'bd.bat', 'bd'] : ['bd'];
  for (const entry of pathEnv.split(delimiter)) {
    if (!isAbsolute(entry)) continue;
    for (const name of names) {
      const candidate = join(entry, name);
      try {
        if (!statSync(candidate).isFile()) continue;
        if (process.platform !== 'win32') accessSync(candidate, constants.X_OK);
        return candidate;
      } catch { /* not here — keep scanning */ }
    }
  }
  return null;
}

// `bd version` prints `bd version <semver> (…)` [verify]. Accept the exact
// documented shape first, then fall back to any semver-looking token so an
// upstream format tweak still yields a version instead of a gap.
const VERSION_LINE = /bd\s+version\s+(\S+)/;
const SEMVER_TOKEN = /(\d+\.\d+\.\d+[^\s]*)/;
const parseBdVersion = output => VERSION_LINE.exec(output)?.[1] ?? SEMVER_TOKEN.exec(output)?.[1] ?? null;

const summarize = (value, max = 160) => {
  const text = String(value).replaceAll('\n', ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

// The probe runs only read-only bd commands: `bd version`, then `bd where
// --json` in the target repository — 5 s timeout, 64 KiB cap, telemetry off
// (forced: the probe env always carries BD_DISABLE_METRICS=1). `run` is the
// test seam; production uses execFileSync. Every bd-side failure lands in
// gaps and a non-ready state — the function only throws on non-ENOENT
// filesystem errors while reading the setting file (same rule as the
// communication-language reader).
export function probeWorkTracker(repository, { daemonHome = null, env = process.env, run = defaultRun } = {}) {
  const result = {
    tracker: 'beads',
    repository,
    enabled: null,
    state: 'unavailable',
    bd: null,
    workspace: null,
    gaps: [],
  };
  if (daemonHome !== null) {
    const setting = readWorkTrackerSetting(daemonHome);
    result.enabled = setting.enabled;
    if (setting.error !== null) result.gaps.push(`tracker setting unreadable — ${setting.error}`);
  }
  let isRepoDir = false;
  try {
    isRepoDir = statSync(repository).isDirectory();
  } catch { /* reported below as a gap, not a crash */ }
  if (!isRepoDir) {
    result.gaps.push(`repository is not a directory: ${repository}`);
    return result;
  }
  const path = findBd(env);
  if (path === null) {
    result.gaps.push('bd not found on PATH — install is a Human action (brew install beads, npm i -g @beads/bd, or the upstream install.sh)');
    return result;
  }
  result.bd = { path, version: null };
  const runEnv = { ...env, BD_DISABLE_METRICS: '1' };
  try {
    const output = run(path, ['version'], { env: runEnv, cwd: repository });
    result.bd.version = parseBdVersion(output);
    if (result.bd.version === null) result.gaps.push(`bd version output unrecognized: ${summarize(output)}`);
  } catch (error) {
    result.gaps.push(`bd version failed: ${summarize(error.message)}`);
    return result;
  }
  try {
    const parsed = JSON.parse(run(path, ['where', '--json'], { env: runEnv, cwd: repository }));
    // Field names (Path/Prefix/RedirectedFrom) are [verify] in the spec —
    // missing keys degrade to null fields instead of a thrown probe.
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('expected an object');
    result.workspace = {
      path: typeof parsed.Path === 'string' ? parsed.Path : null,
      prefix: typeof parsed.Prefix === 'string' ? parsed.Prefix : null,
      redirectedFrom: typeof parsed.RedirectedFrom === 'string' ? parsed.RedirectedFrom : null,
    };
    result.state = 'ready';
  } catch (error) {
    result.state = 'uninitialized';
    result.gaps.push(`bd where failed — repository is not a beads workspace: ${summarize(error.message)}`);
  }
  return result;
}

// execFileSync with the probe's fixed bounds — the only side effect is
// spawning the read-only command; a nonzero exit, timeout or oversized output
// throws and lands in gaps.
const defaultRun = (file, args, { env, cwd }) => execFileSync(file, args, {
  env,
  cwd,
  encoding: 'utf8',
  timeout: 5000,
  maxBuffer: 64 * 1024,
  stdio: ['ignore', 'pipe', 'pipe'],
});

// Seat env overlay for hook-family providers (spec §6.3). BEADS_ACTOR is
// always SLP's per-seat identity — a daemon-wide or user-set actor would
// erase attribution in bd history. BD_AGENT_PROFILE and BD_DISABLE_METRICS
// are defaults only: an explicit Human-set env wins.
export function beadsSeatEnv({ role, agentId, env = {} }) {
  if (!roles.includes(role)) throw new Error(`beadsSeatEnv requires an SLP role, got ${role}`);
  if (typeof agentId !== 'string' || agentId.length === 0) throw new Error('beadsSeatEnv requires a non-empty agentId');
  const overlay = { BEADS_ACTOR: `slp-${role}-${agentId}` };
  if (env.BD_AGENT_PROFILE === undefined) overlay.BD_AGENT_PROFILE = 'conservative';
  if (env.BD_DISABLE_METRICS === undefined) overlay.BD_DISABLE_METRICS = '1';
  return overlay;
}

// The session-entry pointer appended between communication-language and the
// assignment line in managed entry() renders. Disabled (absent or valid-off
// file) emits nothing at all — the disabled render is byte-identical to the
// pre-feature one. An unreadable/foreign setting emits one gap line; the seat
// records the gap and works on without the tracker. Enabled emits one line:
// the self-gated reference to read, and the probe command with the explicit
// daemon home (unavailable/uninitialized is a gap to record, never a block).
export function workTrackerBlock(daemonHome, { cli, policyDir, shq }) {
  const setting = readWorkTrackerSetting(daemonHome);
  if (setting.error !== null) {
    return `Work tracker: setting unreadable — ${setting.error}; continuing without the tracker, record this gap.\n`;
  }
  if (!setting.enabled) return '';
  return `Work tracker: beads (enabled in SLP settings) — read ${join(policyDir, 'references', 'work-tracking.md')} before tracked work; ` +
    `run ${cli} tracker <repository> --paseo-home ${shq(daemonHome)} first and treat an unavailable or uninitialized state as a recorded gap to continue without the tracker.\n`;
}
