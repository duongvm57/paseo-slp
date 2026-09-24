// Creation and launch gates: run init (including the recorded run bound),
// begin preflight/dependency/deadline gates, deferrals and retry rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { initialize, begin, collect, defer, review, seal, summary, sourceRoot } from '../e2e/collector.mjs';
import { scenarios } from '../e2e/scenarios.mjs';
import { config, temporary, setup, fakeReview } from './helpers.mjs';

test('basic preflight requires Human profiles for the scenario family before creating an attempt', t => {
  const dir = temporary(t), run = join(dir, 'run');
  initialize(run);
  for (const family of ['codex', 'pi', 'devin', 'claude']) {
    const id = `basic-${family}`;
    const current = structuredClone(config);
    delete current.confirmer; // Basic flows launch without a paid prelaunch reviewer.
    current.settings.peerPool.options[0].provider = family;
    if (family === 'devin') current.settings.peerPool.options[0].model = 'swe-2-peer';
    current.settings.profiles = ['supervisor', 'lead'].map((role, i) => ({
      id: `slp-${role}`, provider: `slp-${family}-${role}`,
      model: family === 'devin' ? `swe-2-role-${i}` : `endpoint/model-${i}`,
      thinkingOptionId: i ? 'high' : 'medium', featureValues: { custom: i === 2 },
    }));
    current.settings.providers = [...current.settings.profiles.map(profile => ({ id: profile.provider, enabled: true, status: 'available' })), { id: `slp-${family}-peer`, enabled: true, status: 'available' }];
    assert.throws(() => begin(run, id, { ...current, settings: {} }), /profiles-and-peer-pool/);
    for (const role of ['supervisor', 'lead']) {
      const wrong = structuredClone(current);
      const profile = wrong.settings.profiles.find(p => p.id === `slp-${role}`);
      profile.provider = `slp-${family === 'pi' ? 'codex' : 'pi'}-${role}`;
      wrong.settings.providers.push({ id: profile.provider, enabled: true, status: 'available' });
      assert.throws(() => begin(run, id, wrong), new RegExp(`Human must configure slp-${role}`));
    }
    const missing = structuredClone(current); delete missing.settings.profiles[1].model;
    assert.throws(() => begin(run, id, missing), /configure a model.*slp-lead/);
    const absent = structuredClone(current); absent.settings.profiles.pop();
    assert.throws(() => begin(run, id, absent), /Missing Paseo profile slp-lead/);
    const unavailable = structuredClone(current); unavailable.settings.providers[0].status = 'unavailable';
    assert.throws(() => begin(run, id, unavailable), /Unverified provider/);
    const noPeerProvider = structuredClone(current); noPeerProvider.settings.providers.pop();
    assert.throws(() => begin(run, id, noPeerProvider), /Unverified provider Peer pool provider/);
    const empty = structuredClone(current); empty.settings.peerPool.options = [];
    assert.throws(() => begin(run, id, empty), /Peer pool needs an eligible/);
    const wrongFamily = structuredClone(current); wrongFamily.settings.peerPool.options[0].provider = family === 'pi' ? 'codex' : 'pi';
    assert.throws(() => begin(run, id, wrongFamily), /Peer pool needs an eligible/);
    assert.equal(existsSync(join(run, id)), false, 'Rejected preflight creates no attempt or fixture');
    const { attempt } = begin(run, id, current);
    const saved = JSON.parse(readFileSync(join(attempt, 'attempt.json'))).config.settings;
    assert.equal(saved.roles.peer, undefined, 'Coordinator does not preselect the Peer runtime');
    assert.deepEqual(saved.peerPool, current.settings.peerPool);
    for (const role of ['supervisor', 'lead']) {
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
test('a run frozen under another evidence version refuses new evaluation', t => {
  const data = setup(t, 'basic-codex', manifest => { manifest.evidenceVersion = 3; });
  const path = join(data.dir, 'checks.txt');
  writeFileSync(path, 'Synthetic collector test payload; not live evidence.\n');
  // Collecting, sealing and reviewing would silently apply current validators
  // to records captured under a different era.
  for (const op of [() => collect(data.attempt, 'checks', path), () => seal(data.attempt)]) {
    assert.throws(op, /Unsupported evidence version/);
  }
  // The frozen history itself stays readable.
  assert.doesNotThrow(() => summary(data.run));
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
  initialize(run, { root: source });
  const common = join(source, 'src/common.md'), original = readFileSync(common);
  writeFileSync(common, 'changed candidate');
  assert.throws(() => begin(run, 'basic-codex', config), /candidate changed/);
  writeFileSync(common, original);
  writeFileSync(join(source, 'e2e/check-outcome.mjs'), 'changed oracle');
  assert.throws(() => begin(run, 'basic-codex', config), /Harness changed/);
});

test('run options validate scope, budget and deadline at init', t => {
  const dir = temporary(t);
  for (const [name, options, pattern] of [
    ['unknown-scope', { scope: ['no-such-scenario'] }, /Scope must list/],
    ['duplicate-scope', { scope: ['basic-codex', 'basic-codex'] }, /Scope must list/],
    ['empty-scope', { scope: [] }, /Scope must list/],
    ['bad-budget', { budget: { maxAgents: 0, maxWallTimeSeconds: 60 } }, /budget\.maxAgents/],
    ['past-deadline', { deadline: '2000-01-01T00:00:00.000Z' }, /future ISO/],
  ]) assert.throws(() => initialize(join(dir, name), options), pattern);
});
test('a declared scope completes via scopeReady without implying the full suite passed', t => {
  const dir = temporary(t), run = join(dir, 'run');
  const init = initialize(run, {
    scope: ['basic-codex'], budget: { maxAgents: 1, maxWallTimeSeconds: 600 },
    deadline: new Date(Date.now() + 3600e3).toISOString(),
  });
  assert.deepEqual(init.scope, ['basic-codex']);
  const { attempt } = begin(run, 'basic-codex', config);
  review(attempt, fakeReview({ dir, attempt, id: 'basic-codex' }));
  const result = summary(run);
  const row = result.scenarios.find(row => row.id === 'basic-codex');
  assert.equal(row.inScope, true);
  assert.equal(result.scenarios.find(row => row.id === 'heartbeat').inScope, false);
  assert.equal(result.scopeReady, true, 'Every in-scope row is gate-ready');
  assert.equal(result.gateReady, false, 'The full manifest is not gate-ready');
  assert.equal(result.status, 'NOT_RUN');
});
test('a recorded run deadline closes launches but not read-only reporting', t => {
  const dir = temporary(t), run = join(dir, 'run');
  initialize(run, { deadline: new Date(Date.now() + 3600e3).toISOString() });
  const metadata = JSON.parse(readFileSync(join(run, 'run.json')));
  metadata.deadline = '2000-01-01T00:00:00.000Z';
  writeFileSync(join(run, 'run.json'), JSON.stringify(metadata));
  assert.throws(() => begin(run, 'basic-codex', config), /deadline expired/i);
  assert.equal(summary(run).status, 'NOT_RUN');
});
