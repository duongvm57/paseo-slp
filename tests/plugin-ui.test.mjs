// Coverage for the pure view-state helpers in plugin/client/manager-state.ts
// (imported directly — no react), plus an esbuild check that the client entry
// bundles cleanly against host externals with no server-only or node code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { buildSync } from 'esbuild';
import {
  DISABLE_REMOVE_NOTICE,
  EXCLUSIVE_WINDOW_NOTICE,
  RESTORATION_NOTICE,
  RETAINED_RUNTIME_NOTICE,
  STATUS_POLL_MS,
  activationKind,
  activationLabel,
  applyPatch,
  conflictLine,
  conflictLines,
  createTargetViews,
  emptyTargetView,
  errorMessage,
  familyHint,
  isDaemonHome,
  isOperationId,
  liveAcceptanceLabel,
  newOperationId,
  operationPending,
  operationRows,
  pollDelayAfterStart,
  pollDelayAfterStatus,
  reconcileProblem,
  recoverPendingStart,
  startPatch,
  shortenSha,
  visibleConflicts,
  stateHint,
  statusRows,
  targetKey,
} from '../plugin/client/manager-state.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

const SHA = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const OP_ID = '11111111-1111-4111-8111-111111111111';

const operation = (over = {}) => ({
  operationId: OP_ID,
  kind: 'activate',
  phase: 'verifying-runtime',
  outcome: 'pending',
  startedAt: '2026-09-18T00:00:00Z',
  updatedAt: '2026-09-18T00:00:05Z',
  completedAt: null,
  ...over,
});

const family = (name, over = {}) => ({
  family: name,
  availability: 'available',
  binaryPath: `/usr/bin/${name}`,
  observedVersion: '1.0.0',
  ...over,
});

const statusView = (over = {}) => ({
  schemaVersion: 1,
  target: { hostId: 'h1', daemonHome: '/h' },
  state: 'ACTIVE',
  embeddedCandidateSha256: SHA,
  binding: {
    bindingSha256: SHA_B,
    candidateSha256: SHA,
    payloadSha256: SHA,
    launchSetSha256: SHA,
    runtimePath: '/rt/x',
    nodePath: '/usr/bin/node',
    baseline: 'fresh',
  },
  families: ['codex', 'pi', 'devin', 'claude'].map(name => family(name)),
  operation: null,
  conflicts: [],
  verifiedAt: '2026-09-18T00:00:10Z',
  retainedRuntimeCount: 2,
  liveAcceptance: 'not-established-by-this-rpc',
  ...over,
});

const startResult = (over = {}) => ({
  schemaVersion: 1,
  accepted: true,
  operation: operation(),
  conflicts: [],
  pollAfterMs: 1000,
  ...over,
});

// --- inputs -----------------------------------------------------------------

test('isDaemonHome enforces the AbsolutePath contract', () => {
  assert.equal(isDaemonHome('/home/u/.paseo'), true);
  assert.equal(isDaemonHome('C:\\daemons\\paseo'), true);
  assert.equal(isDaemonHome('\\\\srv\\share'), true);
  assert.equal(isDaemonHome('relative/path'), false);
  assert.equal(isDaemonHome(''), false);
  assert.equal(isDaemonHome('/bad\0path'), false);
  assert.equal(isOperationId(OP_ID), true);
  assert.equal(isOperationId('not-a-uuid'), false);
  assert.equal(isOperationId(newOperationId()), true);
});

// --- per-target isolation ---------------------------------------------------

test('view state is isolated per (hostId, daemonHome) pair', () => {
  const store = createTargetViews();
  const a = { hostId: 'h1', daemonHome: '/a' };
  const b = { hostId: 'h1', daemonHome: '/b' };
  const c = { hostId: 'h2', daemonHome: '/a' };
  assert.notEqual(targetKey(a), targetKey(b));
  assert.notEqual(targetKey(a), targetKey(c));
  const viewA = { ...emptyTargetView(), notice: 'a-only' };
  store.set(a, viewA);
  assert.equal(store.get(a).notice, 'a-only');
  assert.equal(store.get(b), undefined);
  assert.equal(store.get(c), undefined);
});

test('applyPatch stores under the request target and repaints only when displayed', () => {
  const store = createTargetViews();
  const a = { hostId: 'h1', daemonHome: '/a' };
  const b = { hostId: 'h1', daemonHome: '/b' };
  // Patch for A while A is displayed: stored and repainted.
  const shown = applyPatch(store, a, { notice: 'for-a' }, targetKey(a));
  assert.equal(shown.repaint, true);
  assert.equal(shown.view.notice, 'for-a');
  assert.equal(store.get(a).notice, 'for-a');
  // A stale RPC for A landing after the administrator moved to B: the store
  // still updates under A, but nothing repaints and the merge never touches
  // B's view or mixes B's fields into A's entry.
  const stale = applyPatch(store, a, { lastError: 'late' }, targetKey(b));
  assert.equal(stale.repaint, false);
  assert.equal(stale.view.notice, 'for-a'); // merged onto A's stored view, not the screen's
  assert.equal(stale.view.lastError, 'late');
  assert.equal(store.get(a).lastError, 'late');
  assert.equal(store.get(b), undefined);
  // And when no target is displayed at all, store still records the result.
  const none = applyPatch(store, b, { busy: true }, null);
  assert.equal(none.repaint, false);
  assert.equal(store.get(b).busy, true);
});

// --- polling ----------------------------------------------------------------

test('start response drives the first poll; terminal outcomes stop it', () => {
  assert.equal(pollDelayAfterStart(startResult()), 1000);
  assert.equal(pollDelayAfterStart(startResult({ pollAfterMs: 250 })), 250);
  for (const outcome of ['succeeded', 'failed', 'conflict']) {
    assert.equal(pollDelayAfterStart(startResult({ operation: operation({ outcome }) })), 0);
  }
  assert.equal(pollDelayAfterStart(startResult({ accepted: false, operation: null })), 0);
  assert.equal(operationPending(operation()), true);
  assert.equal(operationPending(operation({ outcome: 'succeeded' })), false);
  assert.equal(operationPending(null), false);
});

test('status responses poll every STATUS_POLL_MS and stop at terminal', () => {
  assert.equal(STATUS_POLL_MS, 1000);
  assert.equal(pollDelayAfterStatus(statusView({ operation: operation() })), 1000);
  for (const outcome of ['succeeded', 'failed', 'conflict']) {
    assert.equal(pollDelayAfterStatus(statusView({ operation: operation({ outcome }) })), 0);
  }
  assert.equal(pollDelayAfterStatus(statusView({ operation: null })), 0);
});

test('a dropped start response polls, retries only when absent, never hijacks', () => {
  // Operation absent -> the identical request may be retried.
  assert.deepEqual(recoverPendingStart(OP_ID, statusView({ operation: null })), { kind: 'retry' });
  // Same operation pending -> keep polling; the request already landed.
  assert.deepEqual(recoverPendingStart(OP_ID, statusView({ operation: operation() })), { kind: 'poll' });
  // Same operation terminal -> settled, no retry needed.
  const settled = recoverPendingStart(OP_ID, statusView({ operation: operation({ outcome: 'succeeded', completedAt: '2026-09-18T00:00:09Z' }) }));
  assert.equal(settled.kind, 'settled');
  assert.equal(settled.operation.outcome, 'succeeded');
  // A different pending operation -> unresolved; never adopt a foreign op.
  const foreign = recoverPendingStart(OP_ID, statusView({ operation: operation({ operationId: '22222222-2222-4222-8222-222222222222' }) }));
  assert.equal(foreign.kind, 'unresolved');
});

test('startPatch surfaces conflicts whether accepted or not, and they persist across refresh', () => {
  const conflict = { code: 'OWNERSHIP_MISMATCH', message: 'drifted entry', path: '/providers/x', expectedSha256: null, actualSha256: null };
  // accepted + conflicts → reportedConflicts populated, no lastError.
  const accepted = startPatch(startResult({ accepted: true, conflicts: [conflict] }));
  assert.deepEqual(accepted.reportedConflicts, [conflict]);
  assert.equal(accepted.lastError, undefined);
  assert.equal(accepted.busy, false);
  assert.deepEqual(accepted.pending, { operationId: OP_ID, nextPollMs: 1000 });
  // not-accepted + conflicts → visible AND flagged as an error.
  const rejected = startPatch(startResult({ accepted: false, operation: null, conflicts: [conflict] }));
  assert.deepEqual(rejected.reportedConflicts, [conflict]);
  assert.match(rejected.lastError, /OWNERSHIP_MISMATCH/);
  assert.equal(rejected.pending, null);
  // accepted + no conflicts → clean.
  const clean = startPatch(startResult());
  assert.equal(clean.reportedConflicts, null);
  // terminal operation → no pending poll.
  assert.equal(startPatch(startResult({ operation: operation({ outcome: 'succeeded' }) })).pending, null);
  // A follow-up status refresh must not clear a conflict report the operator
  // has not seen — reportedConflicts survives unrelated patches.
  const store = createTargetViews();
  const target = { hostId: 'h1', daemonHome: '/h' };
  applyPatch(store, target, { reportedConflicts: [conflict] }, targetKey(target));
  const after = applyPatch(store, target, { status: statusView(), lastError: null }, targetKey(target));
  assert.deepEqual(after.view.reportedConflicts, [conflict]);
});

test('visibleConflicts merges start, operation-status, and status conflicts — deduped', () => {
  const c1 = { code: 'OWNERSHIP_DRIFT', message: 'drifted entry', path: '/p/1', expectedSha256: null, actualSha256: null };
  const c2 = { code: 'RUNTIME_INTEGRITY', message: 'hash mismatch', path: '/p/2', expectedSha256: null, actualSha256: null };
  const c3 = { code: 'RAW_LIVE_DIVERGENCE', message: 'live differs', path: null, expectedSha256: null, actualSha256: null };
  // (a) status(opId) carrying op-level conflicts → rendered.
  const withOp = { ...emptyTargetView(), status: statusView({ operation: operation({ conflicts: [c1] }) }) };
  assert.deepEqual(visibleConflicts(withOp), [c1]);
  // (b) a succeeded op carrying conflicts stays visible — not swallowed.
  const succeeded = { ...emptyTargetView(), status: statusView({ operation: operation({ outcome: 'succeeded', completedAt: '2026-09-18T00:00:09Z', conflicts: [c1] }) }) };
  assert.deepEqual(visibleConflicts(succeeded), [c1]);
  // (c) no conflicts anywhere → clean.
  const cleanView = { ...emptyTargetView(), status: statusView({ operation: operation() }) };
  assert.deepEqual(visibleConflicts(cleanView), []);
  // (d) the same conflict arriving via start AND status dedupes; distinct merge.
  const both = {
    ...emptyTargetView(),
    reportedConflicts: [c1],
    status: statusView({ operation: operation({ conflicts: [c1, c2] }), conflicts: [c2, c3] }),
  };
  assert.deepEqual(visibleConflicts(both), [c1, c2, c3]);
  // (e) conflicts live on the target's own view — another target's shows none.
  const other = { ...emptyTargetView(), status: statusView() };
  assert.deepEqual(visibleConflicts(other), []);
});

// --- bounded formatting -----------------------------------------------------

test('conflict rendering truncates messages and bounds the visible list', () => {
  const conflicts = Array.from({ length: 70 }, (_, i) => ({
    code: 'OWNERSHIP_MISMATCH',
    message: `conflict ${i} ${'x'.repeat(400)}`,
    path: `/providers/${i}`,
    expectedSha256: SHA,
    actualSha256: SHA_B,
  }));
  const wide = conflictLines(conflicts);
  assert.equal(wide.length, 9); // 8 shown + overflow marker
  assert.match(wide[8], /…and 62 more conflicts$/);
  const compact = conflictLines(conflicts, 4);
  assert.equal(compact.length, 5);
  assert.match(compact[4], /…and 66 more conflicts$/);
  // code + truncated message + path/expected/actual detail stays bounded.
  assert.ok(wide.every(line => line.length < 360));
  const line = conflictLine(conflicts[0]);
  assert.match(line, /^OWNERSHIP_MISMATCH: /);
  assert.match(line, /expected a{12}…/);
});

test('error payloads are bounded regardless of input size', () => {
  const huge = 'e'.repeat(5000);
  assert.ok(errorMessage(new Error(huge)).length <= 501);
  assert.ok(errorMessage(huge).length <= 501);
  assert.equal(errorMessage(new Error('short')), 'short');
});

// --- status rows: compact vs wide -------------------------------------------

test('wide status rows expose binding detail; compact omits it', () => {
  const view = statusView();
  const wide = statusRows(view);
  const compact = statusRows(view, { compact: true });
  const labels = rows => rows.map(row => row.label);
  assert.deepEqual(labels(wide), [
    'State', 'Daemon home (canonical)', 'Embedded candidate', 'Active candidate', 'Binding',
    'Runtime', 'Node', 'Launch set', 'Payload', 'Baseline',
    'Retained runtimes', 'Last verified', 'Live acceptance',
  ]);
  assert.deepEqual(labels(compact), [
    'State', 'Daemon home (canonical)', 'Embedded candidate', 'Active candidate', 'Binding',
    'Retained runtimes', 'Last verified', 'Live acceptance',
  ]);
  const wideRow = label => wide.find(row => row.label === label).value;
  const compactRow = label => compact.find(row => row.label === label).value;
  // §4: the server-canonicalized home is shown in both layouts — an admin who
  // typed a symlinked path sees the real target before mutating.
  assert.equal(wideRow('Daemon home (canonical)'), '/h');
  assert.equal(compactRow('Daemon home (canonical)'), '/h');
  assert.equal(wideRow('Runtime'), '/rt/x');
  assert.equal(wideRow('Embedded candidate'), `${SHA.slice(0, 12)}…`);
  assert.equal(compactRow('Embedded candidate'), `${SHA.slice(0, 8)}…`);
  assert.equal(wideRow('Retained runtimes'), '2');
  assert.equal(wideRow('Last verified'), '2026-09-18T00:00:10Z');
  assert.equal(wideRow('Live acceptance'), 'not established by this RPC');
  // §10: render the literal contract value, never a stronger claim.
  assert.equal(liveAcceptanceLabel('not-established-by-this-rpc'), 'not established by this RPC');
  assert.equal(statusRows(statusView({ binding: null, verifiedAt: null })).find(r => r.label === 'Active candidate').value, 'none');
  assert.equal(statusRows(statusView({ verifiedAt: null })).find(r => r.label === 'Last verified').value, 'never');
});

test('state hints and operation rows reflect pending vs settled', () => {
  assert.match(stateHint('RECOVERY_REQUIRED'), /Reconcile/);
  assert.match(stateHint('ACTIVATING'), /in progress/);
  assert.equal(stateHint('ACTIVE'), '');
  const rows = operationRows(operation());
  assert.deepEqual(rows.map(r => r.label), ['Operation', 'Kind', 'Phase', 'Outcome', 'Started', 'Updated']);
  assert.ok(operationRows(operation({ outcome: 'succeeded', completedAt: '2026-09-18T00:00:09Z' })).some(r => r.label === 'Completed'));
});

test('family hints distinguish availability states', () => {
  assert.match(familyHint(family('codex')), /available — \/usr\/bin\/codex \(1\.0\.0\)/);
  assert.match(familyHint(family('codex'), { compact: true }), /available \(1\.0\.0\)/);
  assert.ok(!familyHint(family('codex'), { compact: true }).includes('/usr/bin'));
  assert.equal(familyHint(family('codex', { availability: 'unavailable' })), 'unavailable');
  assert.equal(familyHint(family('codex', { availability: 'unresolved' })), 'unresolved');
});

// --- action derivation --------------------------------------------------------

test('activate label distinguishes first bind, re-verify, and rebind', () => {
  assert.equal(activationKind(null), 'activate');
  assert.equal(activationLabel(null), 'Activate');
  const bound = statusView();
  assert.equal(activationKind(bound), 'reverify');
  assert.equal(activationLabel(bound), 'Re-verify binding');
  const diverged = statusView({ binding: { ...bound.binding, candidateSha256: SHA_B } });
  assert.equal(activationKind(diverged), 'rebind');
  assert.equal(activationLabel(diverged), 'Rebind');
});

test('reconcile complete/restore-before require the interrupted operation id', () => {
  assert.equal(reconcileProblem('inspect', ''), null);
  assert.match(reconcileProblem('complete', ''), /requires the interrupted operation ID/);
  assert.match(reconcileProblem('restore-before', 'not-a-uuid'), /requires the interrupted operation ID/);
  assert.equal(reconcileProblem('complete', OP_ID), null);
});

test('sha shortening and status helpers handle nulls', () => {
  assert.equal(shortenSha(null), 'none');
  assert.equal(shortenSha(SHA), `${SHA.slice(0, 12)}…`);
  assert.equal(shortenSha('short'), 'short');
});

// --- disclosures --------------------------------------------------------------

test('disclosures carry the mandated meanings verbatim', () => {
  assert.match(EXCLUSIVE_WINDOW_NOTICE, /exclusive administrative edit window/);
  assert.match(EXCLUSIVE_WINDOW_NOTICE, /no compare-and-swap/);
  assert.match(RESTORATION_NOTICE, /semantics, not original JSON bytes/);
  assert.match(RESTORATION_NOTICE, /never patches mcp\.enabled/);
  assert.match(RETAINED_RUNTIME_NOTICE, /retains every runtime/);
  assert.match(DISABLE_REMOVE_NOTICE, /not SLP deactivation/);
  assert.match(DISABLE_REMOVE_NOTICE, /Deactivate before removing/);
});

// --- client bundle check -------------------------------------------------------

test('client entry bundles against host externals with no server-only or node code', () => {
  const result = buildSync({
    entryPoints: [join(root, 'plugin/index.client.tsx')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    logLevel: 'silent',
    external: ['@getpaseo/plugin*', 'zod', 'react', 'react/jsx-runtime'],
  });
  const bundle = result.outputFiles[0].text;
  assert.ok(bundle.length > 0);
  // The screen and shared contracts were actually inlined.
  assert.ok(bundle.includes('SLP runtime manager'));
  assert.ok(bundle.includes('exclusiveAdministrativeWindow'));
  // Host externals stay external.
  assert.match(bundle, /from\s*"react"/);
  assert.match(bundle, /from\s*"zod"/);
  assert.match(bundle, /from\s*"@getpaseo\/plugin\/client"/);
  // No node builtins or server modules leaked into the client bundle.
  // ("node:" also appears as an object key in the binding schema — match imports.)
  assert.ok(!/from\s*["']node:/.test(bundle));
  assert.ok(!/import\s*["']node:/.test(bundle));
  assert.ok(!/require\(/.test(bundle));
  for (const banned of ['fs', 'path', 'os', 'child_process', 'net', 'crypto']) {
    assert.ok(
      !new RegExp(`from\\s*["'](?:node:)?${banned}["']`).test(bundle),
      `client bundle imports ${banned}`,
    );
  }
  assert.ok(!/index\.server|callPluginRpc/.test(bundle));
});
