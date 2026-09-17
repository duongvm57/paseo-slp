import { readdirSync, readFileSync, lstatSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { isAbsolute, join, resolve, basename } from 'node:path';
import { paseoHome } from './routing.mjs';
import { json, readJson } from './package.mjs';

// On-demand signal scan for a Supervisor/Lead observer: one invocation is one
// scan — not a daemon, no held turn, no verdicts. Candidates come only from
// daemon-owned agent state files and each declared worktree's git status; the
// host exposes no cheap structured timeline read (`paseo logs` renders for
// humans and get_agent_activity has no tail/limit), so rendered output is
// never parsed. With a stateFile checkpoint only new fingerprints are emitted
// and the checkpoint is always rewritten — it is the only write. Without one
// the scan emits everything detectable and is flagged stateless.
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value ? value : null;
const millis = value => { const ms = typeof value === 'number' ? value : Date.parse(value); return Number.isFinite(ms) ? ms : null; };
const kinds = ['attention', 'follow-up-round', 'idle-dirty', 'scope-drift', 'test-mirror', 'file-churn'];

// Agent state lives under <paseoHome>/agents/<group>/<id>.json; monitor needs
// fields agents.mjs does not expose, so it keeps its own minimal reader.
function readAgentStates(home) {
  const dir = join(home, 'agents');
  let groups;
  try { groups = readdirSync(dir); } catch (error) {
    if (error.code === 'ENOENT') return new Map();
    throw error;
  }
  const states = new Map();
  for (const group of groups) {
    let names;
    try {
      if (!lstatSync(join(dir, group)).isDirectory()) continue;
      names = readdirSync(join(dir, group));
    } catch { continue; }
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      let state;
      try { state = JSON.parse(readFileSync(join(dir, group, name), 'utf8')); } catch { continue; }
      if (record(state) && typeof state.id === 'string') states.set(state.id, state);
    }
  }
  return states;
}

// A missing, non-repo or failing cwd is an evidence gap, never a crash. HEAD
// doubles as the commit marker for follow-up tracking; %ct records the last
// commit time as evidence.
function probeGit(cwd) {
  let stat;
  try { stat = lstatSync(cwd); } catch { stat = null; }
  if (!stat?.isDirectory()) return { gap: 'cwd is not a directory' };
  const git = args => execFileSync('git', ['--no-optional-locks', '-C', cwd, ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000, maxBuffer: 8 * 1024 * 1024 });
  let dirty;
  try {
    // -uall keeps untracked paths per file so scope/test-mirror matching sees
    // them; core.quotePath=false keeps non-ASCII paths literal instead of
    // octal-escaped, which would never match a declared scope entry.
    dirty = git(['-c', 'core.quotePath=false', 'status', '--porcelain=v1', '--untracked-files=all']).split('\n').filter(Boolean)
      .map(line => line.slice(3).split(' -> ').pop().replace(/^"|"$/g, ''));
  } catch (error) { return { gap: text(error.stderr?.trim().split('\n')[0]) ?? 'git status failed' }; }
  try {
    const [head, committedAt] = git(['log', '-1', '--format=%H%x00%ct']).trim().split('\0');
    return { dirty, head, committedAt: new Date(Number(committedAt) * 1000).toISOString() };
  } catch { return { dirty, head: null, committedAt: null }; }
}

// Minimal scope matcher: an entry without `*` matches the path itself or
// anything beneath it as a directory prefix; `*` matches any run of
// characters, including '/'.
const inScope = (path, scope) => scope.some(entry => entry.includes('*')
  ? new RegExp(`^${entry.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(path)
  : path === entry || path.startsWith(entry.endsWith('/') ? entry : `${entry}/`));

const isTestPath = path => path.startsWith('tests/') || /\.test\.[^/]+$/.test(path);
// tests/foo.test.mjs and src/foo.mjs share the stem 'foo'.
const stemOf = path => basename(path).replace(/\.test\.[^.]+$/, '').replace(/\.[^.]+$/, '');

export function monitor(request) {
  if (!record(request)) throw new Error('Monitor request must be a JSON object');
  const home = request.paseoHome ?? paseoHome();
  if (typeof home !== 'string' || !isAbsolute(home)) throw new Error('Absolute paseoHome required');
  if (!Array.isArray(request.agents) || !request.agents.length) throw new Error('request.agents required');
  const seen = new Set();
  for (const entry of request.agents) {
    if (!record(entry) || !text(entry.id)) throw new Error('agents[].id required');
    if (seen.has(entry.id)) throw new Error(`Duplicate agents[].id ${entry.id}`);
    seen.add(entry.id);
    if (entry.cwd != null && !isAbsolute(entry.cwd)) throw new Error(`agents[${entry.id}].cwd must be absolute`);
    if (entry.scope != null && (!Array.isArray(entry.scope) || entry.scope.some(value => !text(value)))) {
      throw new Error('agents[].scope must be a string list');
    }
  }
  if (request.thresholds != null && !record(request.thresholds)) throw new Error('request.thresholds must be a JSON object');
  const thresholds = { idleMinutes: 20, churnScans: 2, ...request.thresholds };
  for (const key of ['idleMinutes', 'churnScans']) {
    if (!Number.isFinite(thresholds[key]) || thresholds[key] <= 0) throw new Error(`thresholds.${key} must be positive`);
  }
  const wanted = request.signals ?? kinds;
  if (!Array.isArray(wanted) || wanted.some(kind => !kinds.includes(kind))) throw new Error(`signals must be a subset of ${kinds.join(', ')}`);
  if (request.stateFile != null && !isAbsolute(request.stateFile)) throw new Error('Absolute stateFile required');
  let prior = {};
  if (request.stateFile) {
    try { prior = readJson(request.stateFile); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error(`stateFile unreadable: ${error.message}`); }
    if (!record(prior)) throw new Error('stateFile must be a JSON object');
  }
  const states = readAgentStates(home);
  const observedAt = new Date().toISOString();
  const now = Date.now();
  const signals = [], gaps = [], next = {};
  for (const entry of request.agents) {
    const id = entry.id;
    const prev = record(prior[id]) ? prior[id] : {};
    const emitted = new Set(Array.isArray(prev.emitted) ? prev.emitted.filter(text) : []);
    const emit = (kind, evidence, key) => {
      const fingerprint = `${id}|${kind}|${key}`;
      if (!wanted.includes(kind) || emitted.has(fingerprint)) return;
      signals.push({ agentId: id, kind, evidence, observedAt });
      emitted.add(fingerprint);
    };
    const state = states.get(id);
    if (!state) gaps.push({ agentId: id, gap: 'no agent state under paseoHome' });
    const cwd = entry.cwd ?? text(state?.cwd);
    const git = cwd ? probeGit(cwd) : { gap: 'no cwd declared' };
    if (git.gap) gaps.push({ agentId: id, gap: git.gap, cwd: cwd ?? null });
    const status = text(state?.lastStatus) ?? text(state?.status);
    const lastActivityAt = state?.lastActivityAt ?? null;
    const lastUserMessageAt = state?.lastUserMessageAt ?? null;
    const head = git.head ?? null;
    // A user message without an intervening commit is a correction round; a
    // HEAD change breaks the streak.
    let followUpCount = Number.isInteger(prev.followUpCount) ? prev.followUpCount : 0;
    const bumped = lastUserMessageAt != null && prev.lastUserMessageAt != null && lastUserMessageAt > prev.lastUserMessageAt;
    if (bumped) followUpCount = head === (prev.head ?? null) ? followUpCount + 1 : 1;
    else if (head !== (prev.head ?? null)) followUpCount = 0;
    // Churn counts repeated edits while dirty, not a path merely staying
    // dirty: the count rises only when the file's mtime changed between scans.
    const churn = {};
    for (const path of git.dirty ?? []) {
      let mtime = null;
      try { mtime = lstatSync(join(cwd, path)).mtimeMs; } catch { /* deleted or staged-only path */ }
      const before = record(prev.churn?.[path]) ? prev.churn[path] : null;
      const prior = Number.isInteger(before?.count) ? before.count : 0;
      churn[path] = { mtime, count: before == null ? 1 : mtime !== before.mtime ? prior + 1 : prior };
    }
    // A path that left the dirty set ended its churn episode; dropping its
    // fingerprint lets a later episode signal once again.
    for (const path of Object.keys(record(prev.churn) ? prev.churn : {})) {
      if (!Object.hasOwn(churn, path)) emitted.delete(`${id}|file-churn|${path}`);
    }
    const reason = text(state?.attentionReason);
    // requiresAttention alone decides; a stale reason left by the daemon is
    // evidence, not a trigger.
    if (state?.requiresAttention === true) {
      emit('attention', { status, requiresAttention: true, reason }, reason ?? 'flag');
    }
    if (followUpCount >= 2) emit('follow-up-round', { lastUserMessageAt, followUpCount, head }, `at:${lastUserMessageAt}`);
    const idleFor = millis(lastActivityAt) != null ? now - millis(lastActivityAt) : null;
    if ((status === 'idle' || status === 'finished') && git.dirty?.length && idleFor > thresholds.idleMinutes * 60000) {
      emit('idle-dirty', { status, lastActivityAt, dirty: git.dirty, idleMinutes: Math.floor(idleFor / 60000) }, `at:${lastActivityAt}`);
    }
    if (entry.scope?.length && git.dirty) {
      const offending = git.dirty.filter(path => !inScope(path, entry.scope));
      if (offending.length) emit('scope-drift', { scope: entry.scope, offending }, [...offending].sort().join(','));
    }
    if (git.dirty?.length) {
      const stems = new Map(git.dirty.filter(path => !isTestPath(path)).map(path => [stemOf(path), path]));
      const pairs = git.dirty.filter(isTestPath)
        .map(path => ({ test: path, implementation: stems.get(stemOf(path)) }))
        .filter(pair => pair.implementation);
      if (pairs.length) emit('test-mirror', { pairs }, pairs.map(pair => `${pair.test}>${pair.implementation}`).sort().join(','));
      for (const [path, entry] of Object.entries(churn)) {
        if (entry.count >= thresholds.churnScans) emit('file-churn', { path, scans: entry.count }, path);
      }
    }
    next[id] = { lastUserMessageAt, lastActivityAt, lastStatus: status, head, followUpCount, churn, emitted: [...emitted].sort() };
  }
  const result = { signals, scanned: request.agents.length, stateFile: request.stateFile ?? null };
  if (!request.stateFile) result.stateless = true;
  if (gaps.length) result.gaps = gaps;
  if (request.stateFile) {
    mkdirSync(resolve(request.stateFile, '..'), { recursive: true });
    const tmp = `${request.stateFile}.${process.pid}.tmp`;
    writeFileSync(tmp, json(next));
    renameSync(tmp, request.stateFile);
  }
  return result;
}
