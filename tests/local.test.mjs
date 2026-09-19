import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { identity, install, verifyInstall, uninstall, snapshot, json } from '../src/package.mjs';
import { prompt, launchPlan } from '../src/launch.mjs';
import { roleBundle } from '../src/role-bundle.mjs';
import { resolveProfile } from '../src/profiles.mjs';

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
  assert.deepEqual(roleBundle(installed, 'peer').parts, ['common.md', 'roles/peer.md']);
  assert.ok(peer.includes(readFileSync(join(installed, 'src/roles/peer.md'), 'utf8')));
  for (const role of ['supervisor', 'lead']) {
    const child = launchPlan(installed, { ...request, role });
    assert.ok(child.create.initialPrompt.includes(readFileSync(join(installed, `src/roles/${role}.md`), 'utf8')));
    assert.equal(child.create.notifyOnFinish, true);
    for (const family of ['pi', 'codex', 'devin', 'claude']) {
      const model = family === 'devin' ? 'swe-2-medium' : family === 'claude' ? 'claude-synthetic-1' : binding.model;
      const wrapped = launchPlan(installed, { ...request, role, binding: { ...binding, model, provider: `slp-${family}-${role}` } });
      assert.ok(wrapped.create.initialPrompt.includes(request.assignment));
      assert.ok(!wrapped.create.initialPrompt.includes(readFileSync(join(installed, `src/roles/${role}.md`), 'utf8')), 'Wrapper policy must not be broadcast again as task input');
      assert.ok(!wrapped.create.initialPrompt.includes(readFileSync(join(installed, 'src/common.md'), 'utf8')));
    }
  }
  const routed = launchPlan(installed, { ...request, binding: undefined, profiles: [{ id: 'slp-supervisor',
    ...binding, provider: 'slp-codex-supervisor', modeId: 'full-access', featureValues: { fast_mode: false } }],
    providers: [{ id: 'slp-codex-supervisor', status: 'available' }] });
  assert.equal(routed.create.provider, 'slp-codex-supervisor/gpt-5.6-luna');
  assert.equal(routed.profileId, 'slp-supervisor');
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

test('CLI reports a missing target instead of a raw path error', () => {
  const cli = join(root, 'bin/slp.mjs');
  for (const command of ['prepare', 'prepare-handoff', 'snapshot', 'verify', 'routes', 'init']) {
    const result = spawnSync(process.execPath, [cli, command], { encoding: 'utf8' });
    assert.equal(result.status, 1, command);
    assert.match(result.stderr, new RegExp(`${command} requires`), command);
  }
});

test('prepare rejects an unknown role before binding resolution', t => {
  const installed = join(fixture(t), 'release');
  install(root, installed);
  assert.throws(() => launchPlan(installed, { role: 'bogus', workspaceId: 'w', repository: root, assignment: 'x', binding }), /Unknown role/);
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

test('role bundle load paths are the contract: Peer never receives delegation policy', t => {
  const installed = join(fixture(t), 'release');
  install(root, installed);
  const expected = {
    supervisor: ['common.md', 'roles/supervisor.md', 'delegation.md'],
    lead: ['common.md', 'roles/lead.md', 'delegation.md'],
    peer: ['common.md', 'roles/peer.md'],
  };
  for (const [role, parts] of Object.entries(expected)) {
    const bundle = roleBundle(installed, role);
    assert.deepEqual(bundle.parts, parts);
    assert.equal(bundle.orchestrates, role !== 'peer');
    for (const part of parts) {
      assert.ok(bundle.instructions.includes(readFileSync(join(installed, 'src', part), 'utf8')), `${role} must load ${part}`);
    }
    const withheld = ['common.md', 'roles/supervisor.md', 'roles/lead.md', 'roles/peer.md', 'delegation.md'].filter(p => !parts.includes(p));
    for (const part of withheld) {
      assert.ok(!bundle.instructions.includes(readFileSync(join(installed, 'src', part), 'utf8')), `${role} must not load ${part}`);
    }
  }
  assert.throws(() => roleBundle(installed, 'engineer'), /Unknown role/);
});

test('decision-doctrine lines reach the standalone bundles that need them and never reach Peer', t => {
  const installed = join(fixture(t), 'release');
  install(root, installed);
  // The review-gate invariant and the create_agent parentage rule ride
  // delegation.md (Supervisor + Lead); the re-read trigger and the
  // protocol-read timing live in the role files. Peer must receive none.
  const [supervisor, lead] = ['supervisor', 'lead'].map(role => roleBundle(installed, role, {}).instructions);
  for (const instructions of [supervisor, lead]) {
    assert.match(instructions, /does not license merging\s+the axes into one seat/, 'review-gate invariant');
    assert.match(instructions, /cannot carry a new\s+delegation/, 'agent-scoped create_agent rule');
    // C8 formation pins ride delegation.md into both orchestrating bundles:
    // the three-way decision table, the formation record, the placement pin
    // and the post-create parentage verification.
    assert.match(instructions, /New-team delegation/, 'decision table: new-team row');
    assert.match(instructions, /Continuation: same team and ownership/, 'decision table: continuation row');
    assert.match(instructions, /Observe-existing-work/, 'decision table: observe-existing row');
    assert.match(instructions, /formation record/, 'preflight formation record');
    assert.match(instructions, /not evidence of parentage/, 'post-create verification');
    assert.match(instructions, /paseo\.parent-agent-id label must match/, 'inbound-route self-check rides common.md');
    assert.match(instructions, /distinct from your\s+parent/, 'observe-existing carve-out: recipient need not equal parent');
    assert.match(instructions, /not a hard block/, 'unexposed label is a recorded gap, not a block');
    assert.match(instructions, /names no agent\s+recipient/, 'no-named-recipient case is classified, not a block');
    assert.match(instructions, /not filesystem\s+isolation/, 'workspace placement pin');
    assert.match(instructions, /send_agent_prompt to a\s+parentless or differently parented/, 'B21 formation-defect trigger');
    assert.match(instructions, /second workspace\s+for the same team with no isolation reason/, 'B22 placement-defect trigger');
  }
  assert.match(lead, /re-read\s+the review-gate rules/);
  assert.match(lead, /after resume or compaction/);
  assert.ok(!/re-read\s+the review-gate rules/.test(supervisor), 'the re-read trigger is Lead-scoped');
  assert.match(supervisor, /before replying to the Human/, 'B12 protocol-read timing');
  assert.match(lead, /before your first reply/, 'B12 protocol-read timing');
  // Role-scoped C8 cues: the observe-vs-establish distinction is Supervisor's;
  // the conditional parent-label fallback and no-adoption rule are Lead's.
  assert.match(supervisor, /standalone session never makes\s+it your child/, 'Supervisor new-team vs observe cue');
  assert.ok(!/standalone session never makes\s+it your child/.test(lead), 'Supervisor cue stays role-scoped');
  assert.match(lead, /does not adopt it/, 'Lead continuity boundary');
  assert.match(lead, /does not repair a wrong parent/, 'Lead conditional parent-label fallback');
  assert.ok(!/does not adopt it/.test(supervisor), 'Lead cue stays role-scoped');
  const peer = roleBundle(installed, 'peer', {}).instructions;
  assert.ok(!/does not license merging/.test(peer));
  assert.ok(!/re-read\s+the review-gate rules/.test(peer));
  assert.ok(!/cannot carry a new\s+delegation/.test(peer));
  assert.ok(!/New-team delegation|Observe-existing-work|formation record/.test(peer), 'Peer gets no formation doctrine');
  assert.ok(!/not evidence of parentage|not filesystem\s+isolation/.test(peer));
  // The inbound-route self-check is a Peer-visible self-check on the seat's own
  // assignment envelope (common.md), not formation doctrine — it must reach Peer.
  assert.match(peer, /paseo\.parent-agent-id label must match/, 'inbound-route self-check is Peer-visible');
  assert.match(peer, /distinct from your\s+parent/, 'Peer self-check keeps the observe-existing carve-out');
  assert.match(peer, /not a hard block/, 'Peer self-check tolerates an unexposed label');
  assert.match(peer, /names no agent\s+recipient/, 'Peer self-check classifies the no-recipient case');
  for (const ref of ['orchestration.md', 'review-gates.md']) {
    assert.ok(!peer.includes(readFileSync(join(installed, 'src/references', ref), 'utf8')), `Peer must not load ${ref} bytes`);
  }
  // The shipped protocol template carries the same doctrine: read-on-landing,
  // split-axis gate wording, idle retention, create_agent-only seats and the
  // shared-workspace placement default with the owner-map/receipt record.
  const template = readFileSync(join(installed, 'src/templates/workspace-protocol.md'), 'utf8');
  assert.match(template, /when the assignment lands/);
  assert.match(template, /split-axis seats, never one merged seat/);
  assert.match(template, /keep accepted Peers idle/);
  assert.match(template, /assignment that formed the team/, 'idle-retention referent is the team assignment');
  assert.match(template, /agent-scoped create_agent/);
  assert.match(template, /share the assignment'?s workspace by default/, 'team-workspace default');
  assert.match(template, /owner map and creation receipts/, 'formation receipts tactic');
});
