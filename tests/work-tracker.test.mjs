// tests/work-tracker.test.mjs — the beads work-tracker package side:
// src/work-tracker.mjs reader semantics, findBd PATH scan, the read-only
// probe against a fake `bd` on a temp PATH (T5 — no real bd exists on this
// machine and none is ever installed), the seat-env overlay, the session-
// entry block and the `slp tracker` CLI. The plugin-reader parity pin (T7)
// lives at the bottom — both sides must answer identically on the same
// fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WORK_TRACKER_FILE,
  beadsSeatEnv,
  findBd,
  probeWorkTracker,
  readWorkTrackerSetting,
  workTrackerBlock,
} from '../src/work-tracker.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

function tmp(t, prefix = 'wt-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A daemon-home-shaped fixture: the state file lives under
// <home>/slp-runtime/state/, matching the plugin's <stableRoot>/state.
function tmpHome(t) {
  const home = tmp(t, 'wt-home-');
  mkdirSync(join(home, 'slp-runtime', 'state'), { recursive: true });
  return home;
}

const settingPath = home => join(home, WORK_TRACKER_FILE);
const writeSetting = (home, value) => writeFileSync(settingPath(home), typeof value === 'string' ? value : JSON.stringify(value));

// A fake `bd` executable on a temp PATH — a shell script, never a real
// install. whereJson=null makes `bd where` fail like an uninitialized repo.
function fakeBd(t, { version = 'bd version 0.21.0 (build abc123)', versionExit = 0, whereJson = null, whereExit = 1, captureEnv = null } = {}) {
  const dir = tmp(t, 'wt-bd-');
  const path = join(dir, 'bd');
  const q = s => `'${String(s).replaceAll("'", "'\\''")}'`;
  writeFileSync(path, `#!/bin/sh
${captureEnv ? `printf 'BD_DISABLE_METRICS=%s\\nPATH=%s\\n' "$BD_DISABLE_METRICS" "$PATH" > ${q(captureEnv)}\n` : ''}if [ "$1" = "version" ]; then
  printf '%s\\n' ${q(version)}
  exit ${versionExit}
fi
if [ "$1" = "where" ]; then
  ${whereJson === null ? `echo 'no beads workspace here' >&2` : `printf '%s\\n' ${q(whereJson)}`}
  exit ${whereExit}
fi
exit 0
`);
  chmodSync(path, 0o755);
  return { dir, path };
}

// ---------------------------------------------------------------------------
// readWorkTrackerSetting — the §4 contract
// ---------------------------------------------------------------------------

test('setting reader: absent file is disabled without error; valid files read through', t => {
  const home = tmpHome(t);
  assert.deepEqual(readWorkTrackerSetting(home), { enabled: false, error: null });
  writeSetting(home, { schemaVersion: 1, tracker: 'beads', enabled: true });
  assert.deepEqual(readWorkTrackerSetting(home), { enabled: true, error: null });
  writeSetting(home, { schemaVersion: 1, tracker: 'beads', enabled: false });
  assert.deepEqual(readWorkTrackerSetting(home), { enabled: false, error: null });
});

test('setting reader: corrupt or foreign shapes are disabled plus a surfaced error', t => {
  const home = tmpHome(t);
  writeSetting(home, '{corrupt');
  const broken = readWorkTrackerSetting(home);
  assert.equal(broken.enabled, false);
  assert.match(broken.error, /not valid JSON/);
  for (const [name, value, pattern] of [
    ['array', [1], /expected an object/],
    ['wrong schemaVersion', { schemaVersion: 2, tracker: 'beads', enabled: true }, /expected schemaVersion 1/],
    ['foreign tracker', { schemaVersion: 1, tracker: 'linear', enabled: true }, /expected tracker "beads"/],
    ['non-boolean enabled', { schemaVersion: 1, tracker: 'beads', enabled: 'yes' }, /enabled to be a boolean/],
    ['extra key', { schemaVersion: 1, tracker: 'beads', enabled: true, extra: 1 }, /unexpected keys: extra/],
  ]) {
    writeSetting(home, JSON.stringify(value));
    const result = readWorkTrackerSetting(home);
    assert.equal(result.enabled, false, name);
    assert.match(result.error, pattern, name);
  }
});

test('setting reader: non-ENOENT filesystem errors propagate', t => {
  const home = tmpHome(t);
  // A directory at the file path → EISDIR, which is not a "missing setting".
  mkdirSync(settingPath(home));
  assert.throws(() => readWorkTrackerSetting(home), error => error.code === 'EISDIR');
});

// ---------------------------------------------------------------------------
// findBd — PATH scan
// ---------------------------------------------------------------------------

test('findBd: first executable bd in absolute PATH order; relative entries skipped', t => {
  const one = fakeBd(t, {});
  const two = fakeBd(t, {});
  assert.equal(findBd({ PATH: `${one.dir}${delimiter}${two.dir}` }), one.path);
  assert.equal(findBd({ PATH: two.dir }), two.path);
  // A relative PATH entry is never consulted even when it resolves against cwd.
  const rel = tmp(t, 'wt-rel-');
  writeFileSync(join(rel, 'bd'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  assert.equal(findBd({ PATH: rel.slice(1) }), null, 'relative PATH entry skipped');
  assert.equal(findBd({ PATH: '' }), null);
  assert.equal(findBd({}), null);
});

test('findBd: a non-executable bd is skipped for the next PATH entry', t => {
  const dead = tmp(t, 'wt-dead-');
  writeFileSync(join(dead, 'bd'), '#!/bin/sh\nexit 0\n', { mode: 0o644 });
  const live = fakeBd(t, {});
  assert.equal(findBd({ PATH: `${dead}${delimiter}${live.dir}` }), live.path);
  assert.equal(findBd({ PATH: dead }), null);
});

// ---------------------------------------------------------------------------
// probeWorkTracker — read-only, gaps are data (T5)
// ---------------------------------------------------------------------------

test('probe: enabled field follows the setting file; absent home leaves it null', t => {
  const home = tmpHome(t);
  const repo = tmp(t, 'wt-repo-');
  const withoutHome = probeWorkTracker(repo, { env: { PATH: '/nonexistent' } });
  assert.equal(withoutHome.enabled, null);
  assert.equal(withoutHome.state, 'unavailable');
  writeSetting(home, { schemaVersion: 1, tracker: 'beads', enabled: true });
  const withHome = probeWorkTracker(repo, { daemonHome: home, env: { PATH: '/nonexistent' } });
  assert.equal(withHome.enabled, true);
  writeSetting(home, '{corrupt');
  const corrupt = probeWorkTracker(repo, { daemonHome: home, env: { PATH: '/nonexistent' } });
  assert.equal(corrupt.enabled, false);
  assert.ok(corrupt.gaps.some(gap => /tracker setting unreadable/.test(gap)));
});

test('probe: missing bd reports a gap and never throws', t => {
  const repo = tmp(t, 'wt-repo-');
  const result = probeWorkTracker(repo, { env: { PATH: '/nonexistent-bd-dir' } });
  assert.equal(result.tracker, 'beads');
  assert.equal(result.repository, repo);
  assert.equal(result.state, 'unavailable');
  assert.equal(result.bd, null);
  assert.equal(result.workspace, null);
  assert.ok(result.gaps.some(gap => /bd not found on PATH/.test(gap)));
});

test('probe: a repository that is not a directory is a gap, and bd is never consulted', t => {
  const bd = fakeBd(t, {});
  const missing = join(tmp(t, 'wt-repo-'), 'gone');
  const result = probeWorkTracker(missing, { env: { PATH: bd.dir } });
  assert.equal(result.state, 'unavailable');
  assert.equal(result.bd, null, 'no bd probe ran for a missing repository');
  assert.ok(result.gaps.some(gap => /not a directory/.test(gap)));
});

test('probe: bd version failures and garbage output degrade to gaps', t => {
  const repo = tmp(t, 'wt-repo-');
  const failing = fakeBd(t, { versionExit: 1 });
  const failed = probeWorkTracker(repo, { env: { PATH: failing.dir } });
  assert.equal(failed.state, 'unavailable');
  assert.deepEqual(failed.bd, { path: failing.path, version: null });
  assert.ok(failed.gaps.some(gap => /bd version failed/.test(gap)));

  // Garbage version output is a gap, but the workspace probe still runs.
  const garbage = fakeBd(t, { version: 'this is not a version line' });
  const odd = probeWorkTracker(repo, { env: { PATH: garbage.dir } });
  assert.equal(odd.state, 'uninitialized');
  assert.equal(odd.bd.version, null);
  assert.ok(odd.gaps.some(gap => /version output unrecognized/.test(gap)));
});

test('probe: failing bd where means uninitialized; JSON means ready', t => {
  const repo = tmp(t, 'wt-repo-');
  const absent = fakeBd(t, {});
  const uninit = probeWorkTracker(repo, { env: { PATH: absent.dir } });
  assert.equal(uninit.state, 'uninitialized');
  assert.equal(uninit.workspace, null);
  assert.equal(uninit.bd.version, '0.21.0');
  assert.ok(uninit.gaps.some(gap => /not a beads workspace/.test(gap)));

  const present = fakeBd(t, { whereJson: '{"Path":"/repo/.beads","Prefix":"slp","RedirectedFrom":""}', whereExit: 0 });
  const ready = probeWorkTracker(repo, { env: { PATH: present.dir } });
  assert.equal(ready.state, 'ready');
  assert.deepEqual(ready.workspace, { path: '/repo/.beads', prefix: 'slp', redirectedFrom: '' });
  assert.equal(ready.gaps.length, 0);

  const malformed = fakeBd(t, { whereJson: 'not json', whereExit: 0 });
  const odd = probeWorkTracker(repo, { env: { PATH: malformed.dir } });
  assert.equal(odd.state, 'uninitialized');
  assert.ok(odd.gaps.some(gap => /bd where failed/.test(gap)));
});

test('probe: bd is spawned read-only with forced telemetry off and a cwd', t => {
  const repo = tmp(t, 'wt-repo-');
  const captureEnv = join(tmp(t, 'wt-env-'), 'env');
  const bd = fakeBd(t, { whereJson: '{"Path":"/repo/.beads","Prefix":"slp"}', whereExit: 0, captureEnv });
  // A Human-set BD_DISABLE_METRICS=0 is overridden for the probe — telemetry
  // stays off for SLP-run commands regardless of the ambient env.
  const result = probeWorkTracker(repo, { env: { PATH: bd.dir, BD_DISABLE_METRICS: '0' } });
  assert.equal(result.state, 'ready');
  assert.equal(readFileSync(captureEnv, 'utf8'), `BD_DISABLE_METRICS=1\nPATH=${bd.dir}\n`);
});

test('probe: the run seam receives file, args, env and cwd — no real spawn needed', t => {
  const repo = tmp(t, 'wt-repo-');
  const calls = [];
  const bd = fakeBd(t, {});
  const result = probeWorkTracker(repo, {
    env: { PATH: bd.dir },
    run: (file, args, options) => {
      calls.push({ file, args, env: options.env, cwd: options.cwd });
      return args[0] === 'version' ? 'bd version 1.2.3 (x)' : '{"Path":"/p","Prefix":"pre"}';
    },
  });
  assert.equal(result.state, 'ready');
  assert.equal(result.bd.version, '1.2.3');
  assert.deepEqual(calls.map(call => call.args), [['version'], ['where', '--json']]);
  for (const call of calls) {
    assert.equal(call.file, bd.path);
    assert.equal(call.cwd, repo);
    assert.equal(call.env.BD_DISABLE_METRICS, '1');
    assert.equal(call.env.PATH, bd.dir);
  }
});

// ---------------------------------------------------------------------------
// beadsSeatEnv — per-seat actor identity (spec §5.1/§6.3)
// ---------------------------------------------------------------------------

test('beadsSeatEnv: SLP actor always wins; profile/metrics are overridable defaults', () => {
  assert.deepEqual(beadsSeatEnv({ role: 'peer', agentId: 'abc', env: {} }), {
    BEADS_ACTOR: 'slp-peer-abc',
    BD_AGENT_PROFILE: 'conservative',
    BD_DISABLE_METRICS: '1',
  });
  // A preset BEADS_ACTOR (e.g. a daemon-wide one) is replaced — attribution
  // must name the seat.
  const overridden = beadsSeatEnv({ role: 'lead', agentId: 'a1', env: { BEADS_ACTOR: 'human-cli' } });
  assert.equal(overridden.BEADS_ACTOR, 'slp-lead-a1');
  // Human-set BD_* values are preserved — the overlay only fills defaults.
  const preserved = beadsSeatEnv({
    role: 'supervisor', agentId: 's9',
    env: { BD_AGENT_PROFILE: 'aggressive', BD_DISABLE_METRICS: '0' },
  });
  assert.deepEqual(preserved, { BEADS_ACTOR: 'slp-supervisor-s9' });
  assert.throws(() => beadsSeatEnv({ role: 'human', agentId: 'x', env: {} }), /SLP role/);
  assert.throws(() => beadsSeatEnv({ role: 'peer', agentId: '', env: {} }), /agentId/);
});

// ---------------------------------------------------------------------------
// workTrackerBlock — the session-entry pointer (spec §5.3)
// ---------------------------------------------------------------------------

const shq = value => "'" + value.replaceAll("'", "'\\''") + "'";

test('workTrackerBlock: disabled states emit nothing; enabled emits the pointer', t => {
  const home = tmpHome(t);
  const render = () => workTrackerBlock(home, { cli: 'slp', policyDir: '/policy/src', shq });
  assert.equal(render(), '', 'absent file — disabled by default');
  writeSetting(home, { schemaVersion: 1, tracker: 'beads', enabled: false });
  assert.equal(render(), '', 'explicit off stays silent');
  writeSetting(home, { schemaVersion: 1, tracker: 'beads', enabled: true });
  const block = render();
  assert.match(block, /^Work tracker: beads \(enabled in SLP settings\)/);
  assert.ok(block.includes('/policy/src/references/work-tracking.md'), 'names the policy reference');
  assert.ok(block.includes('slp tracker <repository>'), 'names the probe command');
  assert.ok(block.includes(`--paseo-home ${shq(home)}`), 'names the explicit home');
  assert.ok(block.endsWith('\n') && block.trim().split('\n').length === 1, 'one line');
});

test('workTrackerBlock: a corrupt setting emits one gap line, not a throw', t => {
  const home = tmpHome(t);
  writeSetting(home, '{corrupt');
  const block = workTrackerBlock(home, { cli: 'slp', policyDir: '/policy/src', shq });
  assert.match(block, /^Work tracker: setting unreadable — work-tracker\.json is not valid JSON/);
  assert.match(block, /record this gap/);
  assert.ok(block.endsWith('\n') && block.trim().split('\n').length === 1, 'one gap line');
});

// ---------------------------------------------------------------------------
// `slp tracker` CLI (spec §5.2)
// ---------------------------------------------------------------------------

const SLP = join(root, 'bin', 'slp.mjs');
const runCli = (args, env = {}) => spawnSync(process.execPath, [SLP, ...args], {
  env: { PATH: process.env.PATH, ...env },
  encoding: 'utf8',
});

test('tracker CLI: prints the probe JSON and exits 0 even when not ready', t => {
  const repo = tmp(t, 'wt-repo-');
  const home = tmpHome(t);
  const missing = runCli(['tracker', repo], { PATH: '/nonexistent-bd' });
  assert.equal(missing.status, 0, missing.stderr);
  const parsed = JSON.parse(missing.stdout);
  assert.equal(parsed.tracker, 'beads');
  assert.equal(parsed.state, 'unavailable');
  assert.equal(parsed.enabled, null, 'no --paseo-home means the setting is not read');
  assert.ok(parsed.gaps.length > 0);

  writeSetting(home, { schemaVersion: 1, tracker: 'beads', enabled: true });
  const bd = fakeBd(t, { whereJson: '{"Path":"/repo/.beads","Prefix":"slp"}', whereExit: 0 });
  const ready = runCli(['tracker', repo, '--paseo-home', home], { PATH: bd.dir });
  assert.equal(ready.status, 0, ready.stderr);
  const out = JSON.parse(ready.stdout);
  assert.equal(out.enabled, true);
  assert.equal(out.state, 'ready');
  assert.equal(out.bd.version, '0.21.0');
});

test('tracker CLI: argument validation matches the other commands', () => {
  assert.notEqual(runCli(['tracker']).status, 0);
  assert.match(runCli(['tracker']).stderr, /requires <repository>/);
  const bad = runCli(['tracker', '/tmp', '--bogus']);
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /Unknown flag --bogus/);
  const relative = runCli(['tracker', '/tmp', '--paseo-home', 'relative']);
  assert.notEqual(relative.status, 0);
  assert.match(relative.stderr, /Absolute path required/);
});
