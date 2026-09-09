import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { identity, install, verifyInstall, uninstall, snapshot, json } from '../src/package.mjs';
import { prompt, launchPlan } from '../src/launch.mjs';
import { resolveProfile } from '../src/profiles.mjs';
import { descendants, observationEnd, report, instructionEvidence } from '../src/observation.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const binding = { provider: 'codex', model: 'gpt-5.6-luna', modeId: 'auto', thinkingOptionId: 'medium' };
test('profile resolution preserves user preferences and rejects missing or wrong family', () => {
  const profiles = ['supervisor', 'lead'].map(role => ({ id: `slp-${role}`,
    ...binding, provider: `slp-codex-${role}`, modeId: 'full-access',
    featureValues: { fast_mode: true }, command: 'legacy-wrapper' }));
  const providers = profiles.map(p => ({ id: p.provider, extends: 'codex' }));
  const resolved = resolveProfile('supervisor', profiles, providers);
  assert.equal(resolved.modeId, 'full-access');
  assert.deepEqual(resolved.features, { fast_mode: true });
  assert.ok(!JSON.stringify(resolved).includes('legacy-wrapper'));
  assert.throws(() => resolveProfile('peer', profiles, providers), /Missing/);
  assert.throws(() => resolveProfile('lead', profiles, []), /Unverified/);
});

test('initialPrompt role envelope is provider-neutral and supports Pi bindings', t => {
  const installed = join(fixture(t), 'release');
  install(root, installed);
  const rendered = prompt(installed, 'supervisor', 'Run the bounded check', { provider: 'pi', model: 'pi-model', modeId: 'default' });
  assert.match(rendered, /^SLP role=supervisor/);
  assert.ok(rendered.includes('Run the bounded check'));
});
function fixture(t) {
  mkdirSync(join(root, '.local-checks'), { recursive: true });
  const dir = mkdtempSync(join(root, '.local-checks/test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('install preserves exact candidate bytes; rollback preserves unrelated siblings', t => {
  const dir = fixture(t), target = join(dir, 'release');
  writeFileSync(join(dir, 'human.txt'), 'preserve');
  install(root, target);
  assert.deepEqual(verifyInstall(target).candidate, identity(root));
  assert.equal(existsSync(join(target, 'skills/paseo-slp-onboarding/SKILL.md')), true);
  assert.throws(() => install(root, target), /EEXIST/);
  uninstall(target);
  assert.equal(existsSync(target), false);
  assert.equal(readFileSync(join(dir, 'human.txt'), 'utf8'), 'preserve');
});

test('changed install and user-added files block destructive rollback', t => {
  const target = join(fixture(t), 'release');
  install(root, target);
  writeFileSync(join(target, 'notes.txt'), 'human work');
  assert.throws(() => uninstall(target), /Extra files/);
  assert.equal(existsSync(join(target, 'notes.txt')), true);
  writeFileSync(join(target, 'src/common.md'), 'changed');
  assert.throws(() => verifyInstall(target), /changed/);
});

test('launcher loads installed role bytes, excludes private review material, preserves configured custom provider/full-access', t => {
  const installed = join(fixture(t), 'release');
  install(root, installed);
  const request = { workspaceId: 'host-workspace', repository: root,
    assignment: 'Change the greeting; edits only. No commit/push/external effects.',
    binding, outcomeCheck: 'PRIVATE_CHECK', checklist: 'PRIVATE_CHECKLIST' };
  const result = launchPlan(installed, request);
  assert.ok(result.create.initialPrompt.includes(readFileSync(join(installed, 'src/roles/supervisor.md'), 'utf8')));
  assert.ok(!result.create.initialPrompt.includes('PRIVATE_'));
  assert.equal(result.argv, undefined);
  assert.equal(result.create.provider, 'codex/gpt-5.6-luna');
  assert.throws(() => launchPlan(installed, { ...request, binding: { ...binding, provider: 'slp-codex-peer' } }), /matching SLP/);
  assert.equal(launchPlan(installed, { ...request, binding: { ...binding, provider: 'slp-codex-supervisor' } }).create.provider, 'slp-codex-supervisor/gpt-5.6-luna');
  assert.equal(launchPlan(installed, { ...request, binding: { ...binding, modeId: 'full-access' } }).create.settings.modeId, 'full-access');
  const peer = prompt(installed, 'peer', 'bounded outcome', binding);
  assert.ok(!peer.includes('Delegation procedure'));
  assert.ok(peer.includes(readFileSync(join(installed, 'src/roles/peer.md'), 'utf8')));
  for (const role of ['supervisor', 'lead', 'peer']) {
    const child = launchPlan(installed, { ...request, role });
    assert.ok(child.create.initialPrompt.includes(readFileSync(join(installed, `src/roles/${role}.md`), 'utf8')));
    assert.equal(child.create.notifyOnFinish, true);
  }
  const routed = launchPlan(installed, { ...request, profiles: [{ id: 'slp-supervisor',
    ...binding, provider: 'slp-codex-supervisor', featureValues: { fast_mode: false } }],
    providers: [{ id: 'codex' }], route: { provider: 'codex', modeId: 'full-access' } });
  assert.equal(routed.create.provider, 'codex/gpt-5.6-luna');
  assert.equal(routed.create.settings.modeId, 'full-access');
  assert.deepEqual(routed.create.settings.features, { fast_mode: false });
});

test('offline CLI prepares from a staged install with no Paseo executable or daemon', t => {
  const dir = fixture(t), installed = join(dir, 'release');
  install(root, installed);
  const request = join(dir, 'request.json');
  writeFileSync(request, json({ installed, workspaceId: 'local-check-only', repository: root, assignment: 'Local rendering check only', binding }));
  const result = JSON.parse(execFileSync(process.execPath, [join(installed, 'bin/slp.mjs'), 'prepare', request], { env: { PATH: '' }, encoding: 'utf8' }));
  assert.equal(result.create.provider, 'codex/gpt-5.6-luna');
  assert.equal(result.create.notifyOnFinish, true);
  const planned = JSON.parse(execFileSync(process.execPath, [join(root, 'bin/slp.mjs'), 'install', join(dir, 'not-created')], { env: { PATH: '' }, encoding: 'utf8' }));
  assert.equal(planned.applied, false);
  assert.equal(existsSync(join(dir, 'not-created')), false);
});

test('work snapshot detects untracked edits, deletion and executable mode without a commit', t => {
  const dir = fixture(t);
  execFileSync('git', ['init', '--quiet', dir]);
  writeFileSync(join(dir, 'owned.txt'), 'first');
  const first = snapshot(dir);
  assert.equal(first.head, null);
  assert.equal(snapshot(dir).sha256, first.sha256);
  writeFileSync(join(dir, 'owned.txt'), 'second');
  const second = snapshot(dir).sha256;
  assert.notEqual(second, first.sha256);
  chmodSync(join(dir, 'owned.txt'), 0o755);
  assert.notEqual(snapshot(dir).sha256, second);
  execFileSync('git', ['-C', dir, 'add', 'owned.txt']);
  rmSync(join(dir, 'owned.txt'));
  assert.deepEqual(snapshot(dir).files, [{ path: 'owned.txt', deleted: true }]);
});

test('observer uses host parentage, never role names or idle as acceptance', () => {
  // Fields follow the inspected stock CLI 0.7.2 serializer, not a new host API.
  const records = [
    { Id: 'root', ParentAgentId: null, Status: 'idle' },
    { Id: 'lead', ParentAgentId: 'root', Status: 'idle' },
    { Id: 'peer', ParentAgentId: 'lead', Status: 'idle' },
    { Id: 'other', ParentAgentId: null, Name: 'SLP Peer', Status: 'running' },
  ];
  const owned = descendants('root', records);
  assert.deepEqual(owned.map(a => a.Id), ['root', 'lead', 'peer']);
  assert.equal(observationEnd(owned, false), null);
  assert.equal(observationEnd(owned, true), 'DEADLINE');
  assert.equal(observationEnd([{ ...owned[2], PendingPermissions: [{ id: 'p' }] }], false), 'BLOCKED_PERMISSION');
  const result = report('DEADLINE', owned);
  assert.equal(result.review, 'NOT_RUN');
  assert.equal(result.resourceSettlement, 'UNVERIFIED');
  assert.ok(!JSON.stringify(result).includes('PASS'));
  const evidence = instructionEvidence('root', owned, { peer: 'I am the Peer' }, { peer: 'Exact installed instruction bytes' });
  assert.equal(evidence[2].configuredRole, null);
  assert.deepEqual(evidence[2].completeRoleTextSeen, []);
  assert.equal(evidence[2].verdict, 'UNVERIFIED');
});
