import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { json, readJson } from '../src/package.mjs';
import { monitor } from '../src/monitor.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
function fixture(t) {
  mkdirSync(join(root, '.local-checks'), { recursive: true });
  const dir = mkdtempSync(join(root, '.local-checks/monitor-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function gitRepo(dir) {
  execFileSync('git', ['init', '-q', dir]);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'monitor@test']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Monitor Test']);
  writeFileSync(join(dir, 'seed.txt'), 'seed');
  execFileSync('git', ['-C', dir, 'add', 'seed.txt']);
  execFileSync('git', ['-C', dir, 'commit', '-qm', 'seed']);
  return dir;
}
function agentState(home, id, fields) {
  const group = join(home, 'agents', 'group');
  mkdirSync(group, { recursive: true });
  writeFileSync(join(group, `${id}.json`), json({ id, ...fields }));
}

test('monitor emits attention once per fingerprint and always rewrites the checkpoint', t => {
  const dir = fixture(t), home = join(dir, 'home'), repo = gitRepo(join(dir, 'repo'));
  agentState(home, 'a1', { lastStatus: 'running', cwd: repo, requiresAttention: true, attentionReason: 'permission pending' });
  const stateFile = join(dir, 'state.json');
  const request = { paseoHome: home, agents: [{ id: 'a1', cwd: repo }], stateFile };
  const first = monitor(request);
  assert.deepEqual(first.signals.map(s => s.kind), ['attention']);
  assert.equal(first.signals[0].agentId, 'a1');
  assert.equal(first.signals[0].evidence.reason, 'permission pending');
  assert.equal(first.stateFile, stateFile);
  assert.ok(readJson(stateFile).a1.emitted.includes('a1|attention|permission pending'));
  const second = monitor(request);
  assert.deepEqual(second.signals, []);
  assert.equal(second.scanned, 1);
  // A stale reason alone is not a trigger: requiresAttention===false suppresses.
  agentState(home, 'a2', { lastStatus: 'idle', cwd: repo, requiresAttention: false, attentionReason: 'stale reason' });
  assert.deepEqual(monitor({ paseoHome: home, agents: [{ id: 'a2', cwd: repo }] }).signals, []);
});

test('monitor counts consecutive follow-up bumps until a commit breaks the streak', t => {
  const dir = fixture(t), home = join(dir, 'home'), repo = gitRepo(join(dir, 'repo'));
  const stateFile = join(dir, 'state.json');
  const request = { paseoHome: home, agents: [{ id: 'a1', cwd: repo }], stateFile };
  const bump = stamp => agentState(home, 'a1', { lastStatus: 'working', cwd: repo, lastUserMessageAt: stamp });
  bump('2026-09-17T01:00:00Z');
  assert.deepEqual(monitor(request).signals, []);
  bump('2026-09-17T02:00:00Z');
  assert.deepEqual(monitor(request).signals, []);
  bump('2026-09-17T03:00:00Z');
  const third = monitor(request);
  assert.deepEqual(third.signals.map(s => s.kind), ['follow-up-round']);
  assert.equal(third.signals[0].evidence.followUpCount, 2);
  writeFileSync(join(repo, 'progress.txt'), 'x');
  execFileSync('git', ['-C', repo, 'add', 'progress.txt']);
  execFileSync('git', ['-C', repo, 'commit', '-qm', 'progress']);
  bump('2026-09-17T04:00:00Z');
  assert.deepEqual(monitor(request).signals, []);
});

test('monitor flags an idle agent with a dirty worktree past the threshold only', t => {
  const dir = fixture(t), home = join(dir, 'home'), repo = gitRepo(join(dir, 'repo'));
  writeFileSync(join(repo, 'dirty.txt'), 'x');
  agentState(home, 'a1', { lastStatus: 'idle', cwd: repo, lastActivityAt: new Date(Date.now() - 3600e3).toISOString() });
  const out = monitor({ paseoHome: home, agents: [{ id: 'a1', cwd: repo }] });
  assert.equal(out.stateless, true);
  assert.equal(out.stateFile, null);
  assert.deepEqual(out.signals.map(s => s.kind), ['idle-dirty']);
  assert.deepEqual(out.signals[0].evidence.dirty, ['dirty.txt']);
  agentState(home, 'a2', { lastStatus: 'finished', cwd: repo, lastActivityAt: new Date().toISOString() });
  assert.deepEqual(monitor({ paseoHome: home, agents: [{ id: 'a2', cwd: repo }] }).signals, []);
  agentState(home, 'a3', { lastStatus: 'working', cwd: repo, lastActivityAt: new Date(Date.now() - 3600e3).toISOString() });
  assert.deepEqual(monitor({ paseoHome: home, agents: [{ id: 'a3', cwd: repo }] }).signals, []);
});

test('monitor flags scope drift and test mirrors from git status paths', t => {
  const dir = fixture(t), home = join(dir, 'home'), repo = gitRepo(join(dir, 'repo'));
  mkdirSync(join(repo, 'src'));
  mkdirSync(join(repo, 'tests'));
  mkdirSync(join(repo, 'docs'));
  writeFileSync(join(repo, 'src/foo.mjs'), 'x');
  writeFileSync(join(repo, 'tests/foo.test.mjs'), 'x');
  writeFileSync(join(repo, 'docs/note.md'), 'x');
  agentState(home, 'a1', { lastStatus: 'working', cwd: repo });
  const out = monitor({ paseoHome: home, agents: [{ id: 'a1', cwd: repo, scope: ['src/', 'tests/'] }] });
  const drift = out.signals.find(s => s.kind === 'scope-drift');
  assert.deepEqual(drift.evidence.offending, ['docs/note.md']);
  const mirror = out.signals.find(s => s.kind === 'test-mirror');
  assert.deepEqual(mirror.evidence.pairs, [{ test: 'tests/foo.test.mjs', implementation: 'src/foo.mjs' }]);
  const globbed = monitor({ paseoHome: home, agents: [{ id: 'a1', cwd: repo, scope: ['src/*', 'tests/*', 'docs/'] }] });
  assert.equal(globbed.signals.some(s => s.kind === 'scope-drift'), false);
  // Non-ASCII paths must match scope literally (core.quotePath=false), not drift.
  mkdirSync(join(repo, 'tài-liệu'));
  writeFileSync(join(repo, 'tài-liệu/ghi-chú.md'), 'x');
  const unicode = monitor({ paseoHome: home, agents: [{ id: 'a1', cwd: repo, scope: ['tài-liệu/'] }] });
  const unicodeDrift = unicode.signals.find(s => s.kind === 'scope-drift');
  assert.deepEqual(unicodeDrift.evidence.offending.sort(), ['docs/note.md', 'src/foo.mjs', 'tests/foo.test.mjs'].sort());
});

test('monitor flags churn only when a dirty path keeps changing across scans', t => {
  const dir = fixture(t), home = join(dir, 'home'), repo = gitRepo(join(dir, 'repo'));
  const file = join(repo, 'seed.txt');
  writeFileSync(file, 'changed');
  utimesSync(file, 1700000000, 1700000000);
  agentState(home, 'a1', { lastStatus: 'working', cwd: repo });
  const stateFile = join(dir, 'state.json');
  const request = { paseoHome: home, agents: [{ id: 'a1', cwd: repo }], stateFile };
  assert.deepEqual(monitor(request).signals, []);
  // Still dirty but untouched between scans: no repeated correction, no emit.
  assert.deepEqual(monitor(request).signals, []);
  // A fresh edit to the same dirty path is the second churn round.
  utimesSync(file, 1700000100, 1700000100);
  const third = monitor(request);
  assert.deepEqual(third.signals.map(s => s.kind), ['file-churn']);
  assert.deepEqual(third.signals[0].evidence, { path: 'seed.txt', scans: 2 });
  assert.deepEqual(monitor(request).signals, []);
  const custom = join(dir, 'custom.json');
  writeFileSync(custom, json({ a1: { churn: { 'seed.txt': { mtime: 1, count: 2 } }, emitted: [] } }));
  const fifth = monitor({ ...request, stateFile: custom, thresholds: { churnScans: 3 } });
  assert.deepEqual(fifth.signals.map(s => s.kind), ['file-churn']);
  assert.equal(fifth.signals[0].evidence.scans, 3);
});

test('monitor records evidence gaps for broken or undeclared cwd and missing state', t => {
  const dir = fixture(t), home = join(dir, 'home'), repo = gitRepo(join(dir, 'repo'));
  // Outside the worktree: fixture dirs sit inside this repo, so an in-repo
  // "plain" directory would resolve to the parent checkout instead.
  const plain = mkdtempSync(join(tmpdir(), 'monitor-plain-'));
  t.after(() => rmSync(plain, { recursive: true, force: true }));
  agentState(home, 'a1', { lastStatus: 'working', cwd: repo });
  const out = monitor({ paseoHome: home, agents: [
    { id: 'a1', cwd: join(dir, 'missing') },
    { id: 'a2', cwd: plain },
    { id: 'a3' },
  ] });
  assert.deepEqual(out.signals, []);
  assert.equal(out.scanned, 3);
  assert.equal(out.gaps.find(g => g.agentId === 'a1').gap, 'cwd is not a directory');
  assert.match(out.gaps.find(g => g.agentId === 'a2' && g.cwd).gap, /not a git repository/);
  assert.equal(out.gaps.filter(g => g.agentId === 'a2').length, 2);
  assert.deepEqual(out.gaps.filter(g => g.agentId === 'a3').map(g => g.gap),
    ['no agent state under paseoHome', 'no cwd declared']);
});

test('monitor honors the signals subset and validates the request shape', t => {
  const dir = fixture(t), home = join(dir, 'home'), repo = gitRepo(join(dir, 'repo'));
  writeFileSync(join(repo, 'outside.md'), 'x');
  agentState(home, 'a1', { lastStatus: 'working', cwd: repo, requiresAttention: true });
  const agents = [{ id: 'a1', cwd: repo, scope: ['src/'] }];
  const out = monitor({ paseoHome: home, agents, signals: ['attention'] });
  assert.deepEqual(out.signals.map(s => s.kind), ['attention']);
  for (const [fields, pattern] of [
    [{}, /request\.agents required/],
    [{ agents: [{ cwd: repo }] }, /agents\[\]\.id required/],
    [{ agents: [{ id: 'a1', cwd: 'relative' }] }, /cwd must be absolute/],
    [{ agents: [{ id: 'a1' }, { id: 'a1' }] }, /Duplicate agents\[\]\.id/],
    [{ agents, signals: ['bogus'] }, /subset/],
    [{ agents, stateFile: 'relative/state.json' }, /Absolute stateFile/],
    [{ agents, thresholds: { idleMinutes: 0 } }, /idleMinutes must be positive/],
    [{ agents, paseoHome: 'relative' }, /Absolute paseoHome/],
  ]) {
    assert.throws(() => monitor({ paseoHome: home, ...fields }), pattern);
  }
});

test('monitor CLI reads request.json and prints the scan', t => {
  const dir = fixture(t), home = join(dir, 'home'), repo = gitRepo(join(dir, 'repo'));
  agentState(home, 'a1', { lastStatus: 'finished', cwd: repo, requiresAttention: true });
  const request = join(dir, 'request.json');
  writeFileSync(request, json({ paseoHome: home, agents: [{ id: 'a1', cwd: repo }] }));
  const out = JSON.parse(execFileSync(process.execPath, [join(root, 'bin/slp.mjs'), 'monitor', request], { encoding: 'utf8' }));
  assert.equal(out.signals[0].kind, 'attention');
  assert.equal(out.stateless, true);
  const missing = spawnSync(process.execPath, [join(root, 'bin/slp.mjs'), 'monitor'], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /monitor requires <request\.json>/);
});
