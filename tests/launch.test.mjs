import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { install, json, hash } from '../src/package.mjs';
import { launchPlan, handoffPlan } from '../src/launch.mjs';
import { readCatalog } from '../src/routing.mjs';
import { spawnKit } from '../src/spawn-kit.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
function fixture(t) {
  mkdirSync(join(root, '.local-checks'), { recursive: true });
  const dir = mkdtempSync(join(root, '.local-checks/launch-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const installed = join(dir, 'installed');
  install(root, installed);
  return { dir, installed };
}
const request = { repository: root, workspaceId: 'wks-launch', assignment: 'Bounded task; no external effects.' };
const piBinding = { provider: 'pi', model: 'opencode/glm-5.3-flash' };
const providers = [{ id: 'slp-devin-peer', enabled: true, status: 'available' }];
function catalogFixture(dir) {
  mkdirSync(join(dir, '.paseo-slp'), { recursive: true });
  writeFileSync(join(dir, '.paseo-slp/slp-routing.json'), json({
    version: 1, policy: 'Test pool.', quotaFallback: { enabled: false, optionIds: [] },
    options: [{ id: 'devin-peer', provider: 'devin', roles: ['peer'], model: 'swe-2-high',
      modeId: 'bypass', features: { auto_accept: true }, enabled: true, availability: 'ready',
      priority: 10, suitableFor: ['coding'], avoidFor: [], notes: 'test seat' }],
  }));
  return { optionId: 'devin-peer', catalogSha256: readCatalog(dir).sha256 };
}

test('plan surfaces the intended modeId and warns when the binding lacks one', t => {
  const { dir, installed } = fixture(t);
  const base = { ...request, repository: dir, role: 'lead' };
  const withMode = launchPlan(installed, { ...base, binding: { ...piBinding, modeId: 'bypass' } });
  assert.equal(withMode.modeId, 'bypass');
  assert.equal(withMode.warnings, undefined);
  assert.deepEqual(withMode.create.settings, { modeId: 'bypass', features: {} });
  const noMode = launchPlan(installed, { ...base, binding: piBinding });
  assert.equal(noMode.modeId, null);
  assert.deepEqual(noMode.warnings, ['no modeId in binding — spawn inherits caller default']);
  assert.deepEqual(noMode.create.settings, { features: {} });
  // The create.* argument record is unchanged: only additive top-level fields.
  assert.deepEqual(Object.keys(noMode.create).sort(),
    ['initialPrompt', 'notifyOnFinish', 'provider', 'settings', 'title', 'workspaceId']);
});

test('prepare on a non-installed root names the root and the installed CLI, never raw ENOENT', t => {
  const { dir, installed } = fixture(t);
  // dir itself has no installed.json — the same failure a source checkout hits.
  let error;
  try { launchPlan(dir, request); } catch (e) { error = e; }
  assert.match(error.message, /No installed runtime at .*missing installed\.json receipt/);
  assert.match(error.message, /bin\/slp\.mjs/);
  assert.ok(!/ENOENT/.test(error.message), `raw ENOENT leaked: ${error.message}`);
  // The tail is caller-neutral: verify/uninstall hit the same path.
  assert.ok(!/prepare/.test(error.message), `prepare-flavored tail leaked: ${error.message}`);
  // A corrupt receipt is tampering evidence, not a missing install.
  writeFileSync(join(dir, 'installed.json'), 'not json');
  assert.throws(() => launchPlan(dir, request), /not valid JSON/);
  assert.throws(() => launchPlan(dir, request), /^(?!.*No installed runtime)/s);
  // A receipt-present install missing a package file is tampering — the
  // candidate mismatch surfaces, never the "not installed" hint.
  rmSync(join(installed, 'src/common.md'));
  assert.throws(() => launchPlan(installed, request), /Installed candidate changed/);
  assert.throws(() => launchPlan(installed, request), /^(?!.*No installed runtime)/s);
  // Payload-level ENOTDIR (a package path is a regular file) maps to the
  // same incomplete-install class instead of surfacing unadorned.
  rmSync(join(installed, 'src'), { recursive: true });
  writeFileSync(join(installed, 'src'), 'not a directory');
  assert.throws(() => launchPlan(installed, request), /Installed runtime at .* is incomplete — a package file is missing/s);
});

test('spawnKit carries role-scoped approximate MCP tool signatures', t => {
  const { dir, installed } = fixture(t);
  const orchestrating = ['create_agent', 'send_agent_prompt', 'create_workspace', 'list_workspaces',
    'list_providers', 'list_profiles', 'list_agents', 'get_agent_status', 'get_agent_activity',
    'create_heartbeat', 'delete_heartbeat', 'cancel_agent'];
  for (const role of ['supervisor', 'lead']) {
    const plan = launchPlan(installed, { ...request, repository: dir, role, binding: piBinding });
    assert.match(plan.spawnKit.note, /approximate; verify against live mcp_list_tools/);
    assert.deepEqual(plan.spawnKit.tools.map(tool => tool.split('(')[0]), orchestrating);
    assert.match(plan.spawnKit.tools[0], /labels\?: object/);
    for (const tool of plan.spawnKit.tools) assert.match(tool, /^[a-z_]+\([^)]*\)$/);
    // The carrier: create_agent transmits only initialPrompt, so the kit must
    // reach the child there, not just at plan level.
    for (const tool of plan.spawnKit.tools) assert.ok(plan.create.initialPrompt.includes(`- ${tool}`));
    assert.match(plan.create.initialPrompt, /approximate; verify against live mcp_list_tools/);
  }
  const peer = launchPlan(installed, { ...request, repository: dir, role: 'peer', providers, route: catalogFixture(dir) });
  assert.deepEqual(peer.spawnKit.tools.map(tool => tool.split('(')[0]), ['send_agent_prompt', 'get_agent_status']);
  // The Peer route resolves a verified slp-*-peer wrapper, which injects the
  // carrier at session entry — the prompt omits it, the plan fields stay.
  assert.ok(!peer.create.initialPrompt.includes('Policy locators —'));
  assert.equal(peer.spawnKit.tools.length, 2);
  assert.throws(() => spawnKit('human'), /Unknown role/);
});

test('the carrier appears exactly once in a stock-provider prompt', t => {
  const { dir, installed } = fixture(t);
  // Stock providers inline role instructions into the prompt AND plan()
  // appends the carrier block — the inline copy must not repeat it.
  const plan = launchPlan(installed, { ...request, repository: dir, role: 'lead', binding: piBinding });
  assert.equal(plan.create.initialPrompt.split('Spawn kit — role-scoped').length - 1, 1);
  assert.equal(plan.create.initialPrompt.split('Policy locators —').length - 1, 1);
  // The inline instructions keep their policy bytes; only the carrier opts out.
  assert.ok(plan.create.initialPrompt.includes(readFileSync(join(installed, 'src/roles/lead.md'), 'utf8')));
});

test('the prompt carrier is dropped only when the target wrapper provably injects it', t => {
  const { dir, installed } = fixture(t);
  const leadProviders = [{ id: 'slp-codex-lead', enabled: true, status: 'available' }];
  const wrapped = { ...piBinding, provider: 'slp-codex-lead' };
  // Canonical wrapper observed live → the session-entry injection carries it.
  const live = launchPlan(installed, { ...request, repository: dir, role: 'lead', binding: wrapped, providers: leadProviders });
  assert.ok(!live.create.initialPrompt.includes('Policy locators —'));
  assert.ok(!live.create.initialPrompt.includes('Spawn kit —'));
  assert.equal(live.spawnKit.tools.length, 12);
  assert.ok(live.orientation.policyBytes.length > 0);
  // The same wrapper without a live inventory observation keeps the fallback.
  const blind = launchPlan(installed, { ...request, repository: dir, role: 'lead', binding: wrapped });
  assert.equal(blind.create.initialPrompt.split('Policy locators —').length - 1, 1);
  // Configured-provenance inventory is not live evidence — carrier stays.
  const configured = launchPlan(installed, { ...request, repository: dir, role: 'lead', binding: wrapped,
    providers: [{ id: 'slp-codex-lead', enabled: true, provenance: 'configured' }] });
  assert.equal(configured.create.initialPrompt.split('Policy locators —').length - 1, 1);
  // An unavailable observation is equally unproven.
  const down = launchPlan(installed, { ...request, repository: dir, role: 'lead', binding: wrapped,
    providers: [{ id: 'slp-codex-lead', enabled: true, status: 'unavailable' }] });
  assert.equal(down.create.initialPrompt.split('Policy locators —').length - 1, 1);
  // A mismatched extends cannot be this package's wrapper.
  const alien = launchPlan(installed, { ...request, repository: dir, role: 'lead', binding: wrapped,
    providers: [{ id: 'slp-codex-lead', enabled: true, extends: 'pi' }] });
  assert.equal(alien.create.initialPrompt.split('Policy locators —').length - 1, 1);
});

test('orientation carries mechanical locators only', t => {
  const { dir, installed } = fixture(t);
  const lead = launchPlan(installed, { ...request, repository: dir, role: 'lead', binding: piBinding });
  assert.equal(lead.orientation.installedRoot, installed);
  assert.equal(lead.orientation.catalogSha256, null);
  const byPath = Object.fromEntries(lead.orientation.policyBytes.map(entry => [entry.path, entry]));
  const paths = lead.orientation.policyBytes.map(entry => entry.path);
  assert.deepEqual(paths, [...paths].sort(), 'policyBytes sorts by path; no bundle-order hint');
  for (const entry of lead.orientation.policyBytes) {
    assert.ok(entry.path.startsWith(`${installed}/`), 'policyBytes paths are absolute under installedRoot');
  }
  // docs/contract.md is a source-checkout document outside the install unit;
  // the locator set derives from the install receipt and never declares it.
  assert.equal(byPath[join(installed, 'docs/contract.md')], undefined);
  for (const rel of ['src/common.md', 'src/roles/lead.md', 'src/delegation.md',
    'src/references/anti-patterns.md', 'src/references/governance.md', 'src/references/monitoring.md',
    'src/references/orchestration.md', 'src/references/provider-routing.md', 'src/references/review-gates.md']) {
    const entry = byPath[join(installed, rel)];
    const bytes = readFileSync(join(installed, rel));
    assert.deepEqual(entry, { path: join(installed, rel), bytes: bytes.length, sha256: hash(bytes) });
  }
  assert.equal(lead.orientation.policyBytes.length, 9);
  // Carrier: locators must survive into initialPrompt on the fallback path
  // (stock piBinding is not an injecting wrapper, so the carrier stays).
  assert.ok(lead.create.initialPrompt.includes(`- ${join(installed, 'src/common.md')} — `));
  assert.ok(lead.create.initialPrompt.includes(`${join(installed, 'src/common.md')} — ${readFileSync(join(installed, 'src/common.md')).length} bytes, sha256 ${hash(readFileSync(join(installed, 'src/common.md')))}`));
  assert.ok(!lead.create.initialPrompt.includes('docs/contract.md'));
  // A Peer bundle omits delegation.md and passes the routed catalog hash through.
  const route = catalogFixture(dir);
  const peer = launchPlan(installed, { ...request, repository: dir, role: 'peer', providers, route });
  assert.equal(peer.orientation.catalogSha256, route.catalogSha256);
  const peerPaths = peer.orientation.policyBytes.map(entry => entry.path);
  assert.ok(peerPaths.includes(join(installed, 'src/roles/peer.md')));
  assert.ok(!peerPaths.includes(join(installed, 'src/delegation.md')));
  assert.equal(peer.orientation.policyBytes.length, 8);
});

test('handoff plans carry modeId, spawnKit and orientation alongside the packet', t => {
  const { dir, installed } = fixture(t);
  const handoff = { previousAgentId: 'old-lead', reason: 'quota', authority: 'Human requests replacement',
    state: 'paused on snapshot', previousOwner: { settled: true, evidence: 'cancel receipt' }, resources: [] };
  const plan = handoffPlan(installed, { ...request, role: 'lead', binding: piBinding, handoff });
  assert.equal(plan.modeId, null);
  assert.deepEqual(plan.warnings, ['no modeId in binding — spawn inherits caller default']);
  assert.equal(plan.spawnKit.tools.length, 12);
  assert.equal(plan.orientation.installedRoot, installed);
  assert.equal(plan.handoff.previousAgentId, 'old-lead');
  // Handed-off seats receive the carrier inside the prompt too.
  assert.ok(plan.create.initialPrompt.includes('- create_agent(title: string'));
  assert.match(plan.create.initialPrompt, /Provider handoff evidence:/);
});
