// CLI surface: entry contract, plan/status/runs/summary commands, argument
// validation, and the external outcome oracle over the synthetic fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { initialize, begin, review, listRuns, sourceRoot } from '../e2e/collector.mjs';
import { scenarios } from '../e2e/scenarios.mjs';
import { createFixture } from '../e2e/fixture.mjs';
import { cli, config, temporary, setup, fakeReview } from './helpers.mjs';

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
test('summary CLI preserves historical PASS but requires verified reviews for a successful exit', t => {
  for (const legacy of [false, true]) {
    const data = setup(t, 'basic-codex', manifest => {
      manifest.scenarios = manifest.scenarios.filter(row => row.id === 'basic-codex');
      if (legacy) delete manifest.reviewIntegrityVersion;
    });
    const input = fakeReview(data);
    if (legacy) writeFileSync(join(data.attempt, 'review.json'), JSON.stringify({ ...input, status: 'PASS' }));
    else review(data.attempt, input);
    const result = spawnSync(process.execPath, [cli, 'summary', data.run], { encoding: 'utf8' });
    assert.equal(result.status, legacy ? 2 : 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, 'PASS');
    assert.equal(output.gateReady, !legacy);
  }
});
test('plain npm E2E entry cannot be mistaken for a successful live run', () => {
  const result = spawnSync(process.execPath, [cli], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).execution, 'SESSION_REQUIRED');
});
test('plan CLI lists the manifest or one row and rejects unknown scenarios', () => {
  const all = spawnSync(process.execPath, [cli, 'plan'], { encoding: 'utf8' });
  assert.equal(all.status, 0, all.stderr);
  assert.equal(JSON.parse(all.stdout).length, scenarios.length);
  const one = spawnSync(process.execPath, [cli, 'plan', 'basic-codex'], { encoding: 'utf8' });
  assert.equal(one.status, 0, one.stderr);
  assert.equal(JSON.parse(one.stdout).id, 'basic-codex');
  const bad = spawnSync(process.execPath, [cli, 'plan', 'bogus'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Unknown scenario/);
});
test('init CLI accepts a run config carrying the declared bound', t => {
  const dir = temporary(t), run = join(dir, 'run'), path = join(dir, 'run-config.json');
  writeFileSync(path, JSON.stringify({
    scope: ['basic-codex'], budget: { maxAgents: 1, maxWallTimeSeconds: 600 },
    deadline: new Date(Date.now() + 3600e3).toISOString(),
  }));
  const result = spawnSync(process.execPath, [cli, 'init', run, path], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.scope, ['basic-codex']);
  const metadata = JSON.parse(readFileSync(join(run, 'run.json')));
  assert.equal(metadata.budget.maxWallTimeSeconds, 600);
  assert.ok(metadata.deadline > metadata.createdAt);
});
test('runs indexes every initialized run with its summary or error', t => {
  const dir = temporary(t);
  const passed = join(dir, 'run-passed'), fresh = join(dir, 'run-fresh');
  initialize(passed);
  initialize(fresh);
  const { attempt } = begin(passed, 'basic-codex', config);
  review(attempt, fakeReview({ dir, attempt, id: 'basic-codex' }));
  mkdirSync(join(dir, 'broken-run'));
  writeFileSync(join(dir, 'broken-run', 'run.json'), 'not json');
  mkdirSync(join(dir, 'plain-directory'));

  const result = listRuns(dir);
  const byRun = Object.fromEntries(result.runs.map(item => [item.run, item]));
  assert.equal(Object.keys(byRun).length, 3, 'plain-directory is not a run');
  assert.equal(byRun[passed].status, 'NOT_RUN', 'A run with one passed row is not a passed suite');
  assert.equal(byRun[passed].counts.PASS, 1);
  assert.equal(byRun[passed].gateReady, false);
  assert.equal(byRun[passed].scopeReady, false);
  assert.equal(byRun[fresh].status, 'NOT_RUN');
  assert.equal(byRun[fresh].counts.PASS, 0);
  assert.match(byRun[join(dir, 'broken-run')].error, /./);

  const command = spawnSync(process.execPath, [cli, 'runs', dir], { encoding: 'utf8' });
  assert.equal(command.status, 0, command.stderr);
  assert.equal(JSON.parse(command.stdout).runs.length, 3);
});
test('CLI reports missing arguments instead of a path error', () => {
  for (const [command, count] of [['init', 1], ['begin', 3], ['collect', 3], ['status', 1], ['review', 2], ['summary', 1], ['runs', 1]]) {
    const args = Array.from({ length: count - 1 }, (_, i) => `arg-${i}`);
    const result = spawnSync(process.execPath, [cli, command, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1, command);
    assert.match(result.stderr, new RegExp(`${command} requires ${count} argument`), command);
  }
});
