import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { initialize, begin, fixture, collect, collectCoordinator, collectResources, seal, review, reviewAddendum, defer, summary, sourceRoot } from '../e2e/collector.mjs';
import { scenarios } from '../e2e/scenarios.mjs';
import { evidenceKinds } from '../e2e/evidence.mjs';
import { criterionIds as criteria, criterionEvidence } from '../e2e/criteria.mjs';
import { createFixture } from '../e2e/fixture.mjs';
import { hash } from '../src/package.mjs';

const config = {
  operatorId: 'local-test-operator', authority: { source: 'local collector tests only; no live grant' },
  budget: { maxAgents: 4, maxWallTimeSeconds: 60 }, host: { id: 'test-only', version: 'fixture' },
  settings: { source: 'profiles',
    profiles: ['supervisor', 'lead', 'peer'].map(role => ({ id: `slp-${role}`, provider: `slp-codex-${role}`, model: `test-${role}` })),
    providers: ['supervisor', 'lead', 'peer'].map(role => ({ id: `slp-codex-${role}`, status: 'available' })),
  }, confirmer: { id: 'test-confirmer', evidence: 'synthetic test data, no live acceptance' },
};
function temporary(t) {
  mkdirSync(join(sourceRoot, '.local-checks'), { recursive: true });
  const dir = mkdtempSync(join(sourceRoot, '.local-checks/e2e-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function setup(t, id = 'basic-codex') {
  const dir = temporary(t), run = join(dir, 'nested', 'run');
  initialize(run);
  const { attempt } = begin(run, id, config);
  return { dir, run, attempt, id };
}
function coordinatorTranscript(data, sessionId = 'synthetic-session') {
  const native = join(data.dir, 'native');
  mkdirSync(native, { recursive: true });
  const path = join(native, `rollout-${sessionId}.jsonl`);
  writeFileSync(path, `${JSON.stringify({ type: 'session_meta', payload: { id: sessionId } })}\n${JSON.stringify({ type: 'response', payload: { text: 'synthetic test event' } })}\n`);
  return path;
}
function resourceSettlement(data) {
  const path = join(data.dir, 'resources.json');
  writeFileSync(path, JSON.stringify({
    version: 1,
    capturedAt: new Date().toISOString(),
    workspace: { status: 'retained' },
    taskActors: [{ id: 'test-actor', role: 'supervisor', status: 'finished/retained', pendingPermissions: [] }],
    settlement: { observed: 'All synthetic actors finished.', actions: ['final status read'], unresolved: [] },
  }));
  return path;
}
function fakeReview(data, status = 'PASS') {
  const paths = [];
  for (const kind of evidenceKinds) {
    const path = join(data.dir, `${kind}.txt`);
    writeFileSync(path, 'Synthetic collector test payload; not live evidence.\n');
    const result = kind === 'coordinator'
      ? collectCoordinator(data.attempt, coordinatorTranscript(data), 'synthetic-session')
      : kind === 'resources' ? collectResources(data.attempt, resourceSettlement(data))
        : collect(data.attempt, kind, path);
    paths.push(result.path);
  }
  const frozen = seal(data.attempt);
  const item = () => ({ status, reason: 'Synthetic collector validation only', evidence: paths });
  return {
    reviewerId: 'test-reviewer', participantIds: ['test-actor'], independenceEvidence: 'synthetic review session',
    reportSha256: frozen.reportSha256, criteria: Object.fromEntries(criteria.map(id => [id, item()])),
    assertions: scenarios.find(row => row.id === data.id).assertions.map(item),
  };
}
test('basic preflight requires Human profiles for the scenario family before creating an attempt', t => {
  const dir = temporary(t), run = join(dir, 'run');
  initialize(run);
  for (const family of ['codex', 'pi']) {
    const id = `basic-${family}`;
    const current = structuredClone(config);
    delete current.confirmer; // Basic flows launch without a paid prelaunch reviewer.
    current.settings.profiles = ['supervisor', 'lead', 'peer'].map((role, i) => ({
      id: `slp-${role}`, provider: `slp-${family}-${role}`, model: `endpoint/model-${i}`,
      thinkingOptionId: i ? 'high' : 'medium', featureValues: { custom: i === 2 },
    }));
    current.settings.providers = current.settings.profiles.map(profile => ({ id: profile.provider, status: 'available' }));
    assert.throws(() => begin(run, id, { ...current, settings: {} }), /Human-configured agent profiles/);
    for (const role of ['supervisor', 'lead', 'peer']) {
      const wrong = structuredClone(current);
      const profile = wrong.settings.profiles.find(p => p.id === `slp-${role}`);
      profile.provider = `slp-${family === 'pi' ? 'codex' : 'pi'}-${role}`;
      wrong.settings.providers.push({ id: profile.provider, status: 'available' });
      assert.throws(() => begin(run, id, wrong), new RegExp(`Human must configure slp-${role}`));
    }
    const missing = structuredClone(current); delete missing.settings.profiles[2].model;
    assert.throws(() => begin(run, id, missing), /configure a model.*slp-peer/);
    const absent = structuredClone(current); absent.settings.profiles.pop();
    assert.throws(() => begin(run, id, absent), /Missing Paseo profile slp-peer/);
    const unavailable = structuredClone(current); unavailable.settings.providers[0].status = 'unavailable';
    assert.throws(() => begin(run, id, unavailable), /Unverified provider/);
    assert.equal(existsSync(join(run, id)), false, 'Rejected preflight creates no attempt or fixture');
    const { attempt } = begin(run, id, current);
    const saved = JSON.parse(readFileSync(join(attempt, 'attempt.json'))).config.settings;
    for (const role of ['supervisor', 'lead', 'peer']) {
      const profile = current.settings.profiles.find(p => p.id === `slp-${role}`);
      assert.equal(saved.roles[role].provider, profile.provider);
      assert.equal(saved.roles[role].model, profile.model);
      assert.equal(saved.roles[role].thinkingOptionId, profile.thinkingOptionId);
      assert.deepEqual(saved.roles[role].features, profile.featureValues);
    }
  }
});
test('non-basic scenarios still require independent prelaunch confirmation', t => {
  const dir = temporary(t), run = join(dir, 'run');
  initialize(run);
  const current = structuredClone(config);
  delete current.confirmer;
  assert.throws(() => begin(run, 'direct-codex', current), /Independent prelaunch confirmer/);
  assert.equal(existsSync(join(run, 'direct-codex')), false);
});
test('coordinator path and hash references cannot substitute for frozen transcript bytes', t => {
  const data = setup(t), path = join(data.dir, 'receipt.json');
  for (const kind of evidenceKinds) {
    writeFileSync(path, JSON.stringify(kind === 'coordinator'
      ? { nativeTranscriptPath: '/outside/live.jsonl', sourceProvenance: { bytesSha256: 'external-hash' } }
      : { receipt: 'synthetic' }));
    collect(data.attempt, kind, path);
  }
  assert.throws(() => seal(data.attempt), /Missing required evidence: coordinator/);
  assert.equal(existsSync(join(data.attempt, 'report.json')), false);
});
test('coordinator collection rejects a run-authored transcript presented as native evidence', t => {
  const data = setup(t), sessionId = 'synthetic-session';
  const path = join(data.run, `coordinator-final-${sessionId}.jsonl`);
  writeFileSync(path, `${JSON.stringify({ type: 'session_meta', payload: { id: sessionId } })}\n`);
  assert.throws(() => collectCoordinator(data.attempt, path, sessionId), /outside the E2E run directory/);
});
test('coordinator CLI freezes transcript bytes independently of the source file', t => {
  const data = setup(t), path = join(data.dir, 'rollout-synthetic-session.jsonl');
  writeFileSync(path, 'not JSONL');
  assert.throws(() => collectCoordinator(data.attempt, path, 'synthetic-session'), /JSONL object records/);
  const transcript = '{"type":"session_meta","payload":{"id":"synthetic-session"}}\n{"type":"response","id":"synthetic"}\n';
  writeFileSync(path, transcript);
  const command = spawnSync(process.execPath, [join(sourceRoot, 'e2e/cli.mjs'), 'collect-coordinator', data.attempt, path, 'synthetic-session'], { encoding: 'utf8' });
  assert.equal(command.status, 0, command.stderr);
  const receipt = JSON.parse(command.stdout);
  rmSync(path);
  const payload = JSON.parse(Buffer.from(JSON.parse(readFileSync(join(data.attempt, receipt.path))).bytes, 'base64'));
  assert.equal(payload.transcript, transcript);
  assert.equal(payload.transcriptSha256, hash(Buffer.from(transcript)));
  assert.equal(payload.operatorId, config.operatorId);
  assert.equal(payload.sessionId, 'synthetic-session');
  const other = join(data.dir, 'other.txt');
  writeFileSync(other, 'Synthetic receipt');
  for (const kind of evidenceKinds.filter(kind => !['coordinator', 'resources'].includes(kind))) collect(data.attempt, kind, other);
  collectResources(data.attempt, resourceSettlement(data));
  for (const changed of [{ operatorId: 'wrong-operator' }, { transcriptSha256: 'wrong-hash' }, { transcript: '[]', transcriptSha256: hash(Buffer.from('[]')) }]) {
    // An invalid earlier capture stays visible and cannot satisfy the gate.
    const recordPath = join(data.attempt, receipt.path);
    const original = readFileSync(recordPath);
    const record = JSON.parse(original), bytes = Buffer.from(JSON.stringify({ ...payload, ...changed }));
    writeFileSync(recordPath, JSON.stringify({ ...record, bytes: bytes.toString('base64'), sha256: hash(bytes) }));
    assert.throws(() => seal(data.attempt), /Missing required evidence: coordinator/);
    writeFileSync(recordPath, original);
  }
  assert.doesNotThrow(() => seal(data.attempt));
});
test('seal rejects resource settlement with unresolved actor lifecycle state', t => {
  const data = setup(t), sessionId = 'synthetic-session';
  const coordinator = join(data.dir, `rollout-${sessionId}.jsonl`);
  writeFileSync(coordinator, `${JSON.stringify({ type: 'session_meta', payload: { id: sessionId } })}\n`);
  const receipt = join(data.dir, 'receipt.txt');
  writeFileSync(receipt, 'Synthetic collector test payload; not live evidence.\n');
  for (const kind of evidenceKinds.filter(kind => !['coordinator', 'resources'].includes(kind))) collect(data.attempt, kind, receipt);
  collectCoordinator(data.attempt, coordinator, sessionId);
  const resources = join(data.dir, 'resources.json');
  writeFileSync(resources, JSON.stringify({
    version: 1,
    capturedAt: new Date().toISOString(),
    workspace: { status: 'retained' },
    taskActors: [{ id: 'supervisor', role: 'supervisor', status: 'finished/retained', pendingPermissions: [] }],
    settlement: {
      observed: 'Finished notification received, but the runtime still reports running.',
      actions: ['waited for finish notification'],
      unresolved: ['Supervisor reports running and finished at the same time'],
    },
  }));
  collect(data.attempt, 'resources', resources);
  assert.throws(() => seal(data.attempt), /Missing required evidence: resources/);
  assert.equal(existsSync(join(data.attempt, 'report.json')), false);
});
test('manifest covers all requested groups with valid dependencies and unique IDs', () => {
  const ids = new Set(scenarios.map(row => row.id));
  assert.equal(ids.size, scenarios.length);
  for (const row of scenarios) {
    assert.ok(row.assertions.length && row.requirements.length);
    assert.ok(row.dependsOn.every(id => ids.has(id) && id !== row.id));
  }
  for (const group of ['installation', 'onboarding', 'basic', 'direct-lead', 'role-transport', 'mixed-provider', 'routing', 'handoff', 'quota', 'review', 'council', 'parallel', 'dependency', 'monitoring', 'stop', 'recovery']) {
    assert.ok(scenarios.some(row => row.group === group), group);
  }
});
test('new runs account for every scenario and cannot overwrite previous evidence', t => {
  const { run } = setup(t);
  const result = summary(run);
  assert.equal(result.status, 'NOT_RUN');
  assert.equal(result.counts.NOT_RUN, scenarios.length);
  assert.throws(() => initialize(run), /EEXIST/);
  assert.throws(() => begin(run, '../escape', config), /Unknown scenario/);
  assert.throws(() => begin(run, 'basic-codex', config), /Unreviewed/);
  assert.throws(() => begin(run, 'heartbeat', config), /Unmet scenario gate/);
});
test('seal rejects an empty report without freezing the attempt', t => {
  const data = setup(t);
  assert.throws(() => seal(data.attempt), /No collected evidence/);
  assert.equal(existsSync(join(data.attempt, 'report.json')), false);
  assert.equal(existsSync(join(data.attempt, 'report.sha256')), false);
  assert.doesNotThrow(() => fakeReview(data), 'Collection and sealing remain possible after rejection');
});
test('seal requires coordinator evidence even when all other evidence kinds exist', t => {
  const data = setup(t);
  const path = join(data.dir, 'receipt.txt');
  writeFileSync(path, 'Synthetic test receipt; not live evidence.\n');
  for (const kind of evidenceKinds.filter(kind => !['coordinator', 'resources'].includes(kind))) collect(data.attempt, kind, path);
  collectResources(data.attempt, resourceSettlement(data));
  assert.throws(() => seal(data.attempt), /Missing required evidence: coordinator/);
  assert.equal(existsSync(join(data.attempt, 'report.json')), false);
  writeFileSync(path, '');
  collect(data.attempt, 'coordinator', path);
  assert.throws(() => seal(data.attempt), /Missing required evidence: coordinator/);
  collectCoordinator(data.attempt, coordinatorTranscript(data), 'synthetic-session');
  assert.doesNotThrow(() => seal(data.attempt));
});
test('explicit evidence gaps preserve incomplete attempts but cannot receive PASS', t => {
  const data = setup(t);
  const path = join(data.dir, 'receipt.txt');
  writeFileSync(path, 'Synthetic failure receipt; not live evidence.\n');
  const collected = collectResources(data.attempt, resourceSettlement(data));
  const gaps = evidenceKinds.filter(kind => kind !== 'resources').map(kind => ({ kind, reason: 'Host capability unavailable in this synthetic failure branch' }));
  assert.throws(() => seal(data.attempt, { gaps: [{ kind: 'coordinator', reason: '' }] }), /concrete reason/);
  assert.throws(() => seal(data.attempt, { gaps: [...gaps, gaps[0]] }), /Duplicate/);
  assert.throws(() => seal(data.attempt, { gaps: [...gaps, { kind: 'resources', reason: 'Not missing' }] }), /must name missing/);
  const frozen = seal(data.attempt, { gaps });
  assert.deepEqual(JSON.parse(readFileSync(frozen.report)).evidenceGaps, gaps);
  const item = status => ({ status, reason: 'Synthetic collector validation only', evidence: [collected.path] });
  const input = status => ({
    reviewerId: 'test-reviewer', participantIds: ['test-actor'], independenceEvidence: 'synthetic review session',
    reportSha256: frozen.reportSha256, criteria: Object.fromEntries(criteria.map(id => [id, item(status)])),
    assertions: scenarios.find(row => row.id === data.id).assertions.map(() => item(status)),
  });
  assert.throws(() => review(data.attempt, input('PASS')), /PASS forbidden with declared evidence gaps/);
  assert.equal(review(data.attempt, input('BLOCKED')).status, 'BLOCKED');
  assert.equal(summary(data.run).counts.BLOCKED, 1);
});
test('both fixtures fail the public contract baseline and pass after correct independent repairs', t => {
  for (const variant of ['basic', 'integration']) {
    const workspace = createFixture(join(temporary(t), 'workspace'), variant);
    const check = () => spawnSync(process.execPath, [join(sourceRoot, 'e2e/check-outcome.mjs'), workspace], { encoding: 'utf8' });
    assert.notEqual(check().status, 0);
    writeFileSync(join(workspace, 'lines.mjs'), 'export const linesTotal = lines => lines.reduce((total, { unitCents, quantity }) => total + unitCents * quantity, 0);\n');
    if (variant === 'integration') {
      assert.notEqual(check().status, 0, 'Partial branch repair is insufficient for integrated outcome');
      writeFileSync(join(workspace, 'discount.mjs'), 'export const discountedTotal = (subtotal, percent) => subtotal - Math.floor(subtotal * percent / 100);\n');
    }
    assert.equal(check().status, 0);
    writeFileSync(join(workspace, 'human-note.txt'), 'overwritten');
    assert.notEqual(check().status, 0);
  }
});
test('external outcome rejects wrong rounding even when implementation-authored tests pass', t => {
  const workspace = createFixture(join(temporary(t), 'workspace'), 'basic');
  writeFileSync(join(workspace, 'lines.mjs'), 'export const linesTotal = lines => lines.reduce((total, { unitCents, quantity }) => total + unitCents * quantity, 0);\n');
  // Replay the observed Peer regression: tests encoded the same wrong premise.
  writeFileSync(join(workspace, 'discount.mjs'), 'export const discountedTotal = (subtotal, percent) => Math.floor(subtotal * (100 - percent) / 100);\n');
  writeFileSync(join(workspace, 'public.test.mjs'), "import assert from 'node:assert/strict';\nimport { discountedTotal } from './discount.mjs';\nassert.equal(discountedTotal(101, 15), 85);\n");
  const publicCheck = spawnSync(process.execPath, ['--test', 'public.test.mjs'], { cwd: workspace, encoding: 'utf8' });
  assert.equal(publicCheck.status, 0);
  const externalCheck = () => spawnSync(process.execPath, [join(sourceRoot, 'e2e/check-outcome.mjs'), workspace], { encoding: 'utf8' });
  const rejected = externalCheck();
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /380 !== 381/);
  writeFileSync(join(workspace, 'discount.mjs'), 'export const discountedTotal = (subtotal, percent) => subtotal - Math.floor(subtotal * percent / 100);\n');
  assert.equal(externalCheck().status, 0);
});
test('review requires independent identity, all criteria, assertions and real evidence references', t => {
  const data = setup(t), input = fakeReview(data);
  assert.throws(() => review(data.attempt, { ...input, reviewerId: config.operatorId }), /independent/);
  assert.throws(() => review(data.attempt, { ...input, reviewerId: 'test-actor' }), /independent/);
  assert.throws(() => review(data.attempt, { ...input, reportSha256: 'wrong' }), /frozen report hash/);
  assert.throws(() => review(data.attempt, { ...input, criteria: {} }), /exactly/);
  assert.throws(() => review(data.attempt, { ...input, assertions: [] }), /every scenario assertion/);
  const bad = structuredClone(input);
  bad.criteria.U2.evidence = ['../../invented'];
  assert.throws(() => review(data.attempt, bad), /invalid evidence reference/);
  review(data.attempt, input);
  assert.equal(summary(data.run).counts.PASS, 1);
  assert.notEqual(summary(data.run).status, 'PASS');
  assert.throws(() => review(data.attempt, input), /EEXIST/);
});
test('sealing prevents additions; changed evidence and configuration invalidate reviews', t => {
  const data = setup(t), input = fakeReview(data);
  assert.throws(() => collect(data.attempt, 'checks', join(data.dir, 'checks.txt')), /sealed/);
  review(data.attempt, input);
  const path = join(data.attempt, input.criteria.U1.evidence[0]);
  const original = readFileSync(path);
  writeFileSync(path, original.toString().replace('preflight', 'launch'));
  assert.throws(() => summary(data.run), /Sealed evidence changed/);
  writeFileSync(path, original);
  writeFileSync(join(data.attempt, 'attempt.json'), '{}');
  assert.throws(() => summary(data.run));
});
test('editing a stored review status cannot turn a failed criterion into PASS', t => {
  const data = setup(t), input = fakeReview(data, 'FAIL');
  const result = review(data.attempt, input);
  writeFileSync(join(data.attempt, 'review.json'), JSON.stringify({ ...result, status: 'PASS' }));
  assert.throws(() => summary(data.run), /inconsistent/);
});
test('review addenda supersede the original assessment without rewriting it', t => {
  const data = setup(t), input = fakeReview(data);
  const original = review(data.attempt, input);
  const originalBytes = readFileSync(join(data.attempt, 'review.json'));
  const corrected = structuredClone(input);
  corrected.criteria.U6.status = 'FAIL';
  corrected.criteria.U6.reason = 'Material limitation omitted from the final handback';
  corrected.assertions[1].status = 'FAIL';
  corrected.assertions[1].reason = 'Faithful handback assertion failed';
  const addendum = reviewAddendum(data.attempt, {
    ...corrected,
    supersedesReviewSha256: hash(originalBytes),
    basis: 'Independent correction against the same frozen report',
  });
  assert.equal(addendum.status, 'FAIL');
  assert.equal(JSON.parse(readFileSync(join(data.attempt, 'review.json'))).status, original.status);
  assert.equal(summary(data.run).scenarios.find(row => row.id === data.id).status, 'FAIL');
});
test('sealed report edits and orphan addenda fail closed', t => {
  const data = setup(t), input = fakeReview(data);
  review(data.attempt, input);
  const reportPath = join(data.attempt, 'report.json');
  const report = JSON.parse(readFileSync(reportPath));
  report.sourceUnchanged = !report.sourceUnchanged;
  writeFileSync(reportPath, JSON.stringify(report));
  assert.throws(() => summary(data.run), /Sealed report changed/);

  const orphan = setup(t);
  fakeReview(orphan);
  writeFileSync(join(orphan.attempt, 'review-addendum-001.json'), JSON.stringify({ basis: 'orphan' }));
  assert.throws(() => summary(orphan.run), /original review/);
});
test('a retry cannot erase an observed failure and blocked rows retain concrete reasons', t => {
  const data = setup(t);
  review(data.attempt, fakeReview(data, 'FAIL'));
  data.attempt = begin(data.run, data.id, config).attempt;
  review(data.attempt, fakeReview(data));
  defer(data.run, 'heartbeat', { status: 'BLOCKED', reason: 'No timed delivery proof', missing: ['heartbeat-wake'] });
  const result = summary(data.run);
  assert.equal(result.status, 'FAIL');
  assert.equal(result.scenarios.find(row => row.id === data.id).attempts.length, 2);
  assert.equal(result.scenarios.find(row => row.id === data.id).status, 'FAIL');
  assert.equal(result.scenarios.find(row => row.id === 'heartbeat').status, 'BLOCKED');
});
test('source candidate and harness drift require a new run before launch', t => {
  const dir = temporary(t), source = join(dir, 'source');
  mkdirSync(source);
  for (const path of ['package.json', 'install.sh', 'bin', 'src', 'skills', 'e2e', 'docs', 'AGENTS.md']) {
    cpSync(join(sourceRoot, path), join(source, path), { recursive: true });
  }
  const run = join(dir, 'run');
  initialize(run, source);
  const common = join(source, 'src/common.md'), original = readFileSync(common);
  writeFileSync(common, 'changed candidate');
  assert.throws(() => begin(run, 'basic-codex', config), /candidate changed/);
  writeFileSync(common, original);
  writeFileSync(join(source, 'e2e/check-outcome.mjs'), 'changed oracle');
  assert.throws(() => begin(run, 'basic-codex', config), /Harness changed/);
});
test('plain npm E2E entry cannot be mistaken for a successful live run', () => {
  const result = spawnSync(process.execPath, [join(sourceRoot, 'e2e/cli.mjs')], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).execution, 'SESSION_REQUIRED');
});

test('a criterion is only discharged by evidence of a kind that can support it', t => {
  const data = setup(t), input = fakeReview(data);
  // fakeReview collects one receipt per kind, in evidenceKinds order.
  const all = input.criteria.U1.evidence;
  const pathFor = kind => all[evidenceKinds.indexOf(kind)];
  assert.deepEqual(criterionEvidence.U7, ['resources']);
  assert.deepEqual(criterionEvidence.U1, ['checks', 'artifacts']);

  const unrelated = structuredClone(input);
  unrelated.criteria.U7 = { status: 'PASS', reason: 'Settlement claimed from an unrelated receipt', evidence: [pathFor('checks')] };
  assert.throws(() => review(data.attempt, unrelated), /U7: observed verdict needs resources evidence/);

  const wrongWayRound = structuredClone(input);
  wrongWayRound.criteria.U1 = { status: 'FAIL', reason: 'Outcome claimed from a settlement receipt', evidence: [pathFor('resources')] };
  assert.throws(() => review(data.attempt, wrongWayRound), /U1: observed verdict needs checks or artifacts evidence/);

  // BLOCKED needs no evidence at all, so the support rule does not apply to it.
  const blocked = structuredClone(input);
  blocked.criteria.U7 = { status: 'BLOCKED', reason: 'Host settlement receipts unavailable', evidence: [] };
  assert.equal(review(data.attempt, blocked).status, 'BLOCKED');
});
