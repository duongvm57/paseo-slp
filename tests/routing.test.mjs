import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { identity, install, readJson, json, hash, verifyInstall } from '../src/package.mjs';
import { installPaseo, upgradePaseo, initWorkspace } from '../src/paseo-install.mjs';
import { resolveProfile } from '../src/profiles.mjs';
import { launchPlan, roleInstructions } from '../src/launch.mjs';
import { handoffPlan } from '../src/handoff.mjs';
import { piRoleArgs } from '../src/role-transport.mjs';
import { readCatalog, emptyCatalog, validateCatalog } from '../src/routing.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
function fixture(t) {
  mkdirSync(join(root, '.local-checks'), { recursive: true });
  const dir = mkdtempSync(join(root, '.local-checks/routing-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const installed = join(dir, 'installed');
  return { dir, installed };
}
const profiles = [
  { id: 'slp-peer', provider: 'slp-codex-peer', model: 'gpt-5.6-luna' },
  { id: 'slp-lead', provider: 'slp-codex-lead', model: 'gpt-5.6-luna', modeId: 'full-access', thinkingOptionId: 'high', featureValues: { fast_mode: true } },
];
// list_providers returns availability but need not return the extends field.
const providers = ['slp-codex-peer', 'slp-pi-peer', 'slp-codex-lead', 'slp-pi-lead', 'pi'].map(id => ({ id, enabled: true, status: 'available' }));
const request = { role: 'peer', repository: root, workspaceId: 'workspace', assignment: 'Inspect cancellation ownership; no code writes.', profiles, providers };
function catalogFixture(dir) {
  mkdirSync(join(dir, '.paseo-slp'), { recursive: true });
  const path = join(dir, '.paseo-slp/slp-routing.json');
  const catalog = readJson(join(root, 'examples/slp-routing.json'));
  catalog.options.forEach(option => { option.availability = 'ready'; });
  writeFileSync(path, json(catalog));
  const route = optionId => ({ optionId, catalogSha256: readCatalog(dir).sha256 });
  return { path, catalog, route };
}

test('saved profile launches preserve each role bundle and reject runtime substitution', t => {
  const { dir, installed } = fixture(t); install(root, installed);
  const saved = ['supervisor', 'lead', 'peer'].map((role, i) => ({
    id: `slp-${role}`, provider: `slp-pi-${role}`, model: `upstream/model-${i}`,
    thinkingOptionId: i ? 'high' : 'medium', featureValues: { enabled: i === 2 },
  }));
  const inventory = saved.map(profile => ({ id: profile.provider, status: 'available' }));
  const launch = fields => launchPlan(installed, { ...request, repository: dir, profiles: saved, providers: inventory, ...fields });
  assert.equal(existsSync(join(dir, '.paseo-slp/slp-routing.json')), false);
  for (const role of ['supervisor', 'lead', 'peer']) {
    const selected = saved.find(p => p.id === `slp-${role}`);
    const plan = launch({ role });
    assert.equal(plan.profileId, selected.id);
    assert.equal(plan.create.provider, `${selected.provider}/${selected.model}`);
    assert.deepEqual(plan.create.settings, { thinkingOptionId: selected.thinkingOptionId, features: selected.featureValues });
    assert.equal(plan.create.settings.modeId, undefined);
  }
  const { route } = catalogFixture(dir);
  assert.equal(launch({}).create.provider, 'slp-pi-peer/upstream/model-2', 'Even an existing catalog cannot replace a saved profile');
  for (const override of [route('luna-code'), { provider: 'slp-codex-peer' }, { model: 'other' }, { modeId: 'full-access' }, { thinkingOptionId: 'low' }, { features: {} }]) {
    assert.throws(() => launch({ route: override }), /Saved profile settings cannot be overridden/);
  }
  assert.throws(() => launch({ binding: { provider: 'pi', model: 'other' } }), /Choose saved profiles/);
  const changed = structuredClone(saved); changed[2].model = 'different/model';
  assert.equal(launch({ profiles: changed }).create.provider, 'slp-pi-peer/different/model');
  delete changed[2].model;
  assert.throws(() => launch({ profiles: changed }), /Human must configure a model/);
});

test('Lead selects independent runtime bundles for one Peer role without a disposition mapping', t => {
  const { dir, installed } = fixture(t); install(root, installed);
  const { route } = catalogFixture(dir);
  const launch = fields => launchPlan(installed, { ...request, profiles: undefined, repository: dir, ...fields });
  const engineer = launch({ disposition: 'Engineer', route: route('luna-code') });
  const architect = launch({ disposition: 'architect', route: route('glm-design') });
  assert.equal(engineer.create.provider, 'slp-codex-peer/gpt-5.6-luna');
  assert.equal(architect.create.provider, 'slp-pi-peer/opencode/glm-5.3-flash');
  assert.deepEqual(engineer.create.settings, { thinkingOptionId: 'medium', features: {} });
  assert.deepEqual(architect.create.settings, { thinkingOptionId: 'medium', features: {} });
  for (const plan of [engineer, architect]) {
    assert.ok(plan.create.initialPrompt.includes(readFileSync(join(installed, 'src/roles/peer.md'), 'utf8')));
    assert.ok(!plan.create.initialPrompt.includes('Delegation procedure'));
  }
  assert.match(architect.create.initialPrompt, /Disposition: architect/);
  assert.equal(resolveProfile('peer', profiles, providers, { disposition: 'auditor' }).profileId, 'slp-peer');
  const secondEngineer = launch({ disposition: 'engineer', route: route('glm-design') });
  assert.equal(secondEngineer.create.provider, architect.create.provider);
  assert.equal(secondEngineer.routing.optionId, 'glm-design');
  assert.equal(launch({ disposition: 'proof-auditor', route: route('luna-reason') }).create.settings.thinkingOptionId, 'high');
  const staleProfiles = [...profiles, { id: 'slp-peer-architect', provider: 'slp-pi-peer', model: 'old' }];
  assert.equal(resolveProfile('peer', staleProfiles, providers, { disposition: 'architect' }).profileId, 'slp-peer');
});

test('explicit profile overrides disposition; missing profiles, unavailable and wrong-role providers fail', () => {
  const custom = [...profiles, { id: 'human-architecture', provider: 'slp-pi-peer', model: 'b-ai/glm-5.3-flash' }];
  assert.equal(resolveProfile('peer', custom, providers, { disposition: 'architect', profileId: 'human-architecture' }).model, 'b-ai/glm-5.3-flash');
  assert.throws(() => resolveProfile('peer', custom, providers, { profileId: 'missing' }), /Missing/);
  assert.throws(() => resolveProfile('peer', profiles, providers.map(p => ({ ...p, status: 'unavailable' }))), /Unverified/);
  assert.throws(() => resolveProfile('lead', custom, providers, { profileId: 'human-architecture' }), /matching SLP/);
});

test('provider fallback requires explicit target model and clears nonportable settings', t => {
  const { installed } = fixture(t); install(root, installed);
  assert.throws(() => resolveProfile('lead', profiles, providers, { provider: 'slp-pi-lead' }), /explicit target model/);
  const route = { provider: 'slp-pi-lead', model: 'opencode/glm-5.3-flash', thinkingOptionId: 'low' };
  const plan = launchPlan(installed, { ...request, profiles: undefined, role: 'lead', binding: resolveProfile('lead', profiles, providers, route) });
  assert.equal(plan.create.provider, 'slp-pi-lead/opencode/glm-5.3-flash');
  assert.deepEqual(plan.create.settings, { thinkingOptionId: 'low', features: {} });
  const clear = launchPlan(installed, { ...request, profiles: undefined, role: 'lead', binding: resolveProfile('lead', profiles, providers, { thinkingOptionId: null, modeId: null, features: {} }) });
  assert.deepEqual(clear.create.settings, { features: {} });
});

test('stock Pi offline preparation accepts catalog model IDs and no mode', t => {
  const { dir, installed } = fixture(t); install(root, installed);
  const path = join(dir, 'request.json');
  writeFileSync(path, json({ ...request, profiles: undefined, providers: undefined, binding: { provider: 'pi', model: 'commandcode/z-ai/glm-5.3-flash', thinkingOptionId: 'medium' } }));
  const plan = JSON.parse(execFileSync(process.execPath, [join(installed, 'bin/slp.mjs'), 'prepare', path], { env: { PATH: '' }, encoding: 'utf8' }));
  assert.equal(plan.create.provider, 'pi/commandcode/z-ai/glm-5.3-flash');
  assert.equal(plan.create.settings.modeId, undefined);
});

test('installer registers both role transports and preserves user provider switches and model edits', t => {
  const { dir, installed } = fixture(t), home = join(dir, 'home'); mkdirSync(home);
  installPaseo(root, installed, home, true);
  const path = join(home, 'config.json');
  const config = readJson(path);
  assert.equal(Object.keys(config.agents.providers).length, 6);
  assert.equal(config.daemon.agentProfiles.length, 3);
  assert.equal(config.agents.providers['slp-pi-peer'].extends, 'pi');
  assert.equal(config.agents.providers['slp-pi-lead'].command[1], join(installed, 'bin/pi-role.mjs'));
  Object.assign(config.daemon.agentProfiles.find(p => p.id === 'slp-lead'), { provider: 'slp-pi-lead', model: 'b-ai/glm-5.3-flash', thinkingOptionId: 'medium' });
  writeFileSync(path, json(config));
  const bytes = readFileSync(path, 'utf8');
  assert.equal(installPaseo(root, installed, home, true).alreadyInstalled, true);
  assert.equal(readFileSync(path, 'utf8'), bytes);
  config.daemon.agentProfiles[0].provider = 'slp-pi-peer';
  writeFileSync(path, json(config));
  assert.throws(() => installPaseo(root, installed, home, true), /rebound profile/);
});

test('Pi wrapper appends role while preserving RPC bytes, resume, model, thinking and host extensions', t => {
  const { dir, installed } = fixture(t); install(root, installed);
  const fake = join(dir, 'fake-pi');
  const receipt = join(dir, 'args.json');
  writeFileSync(fake, `#!${process.execPath}\nimport fs from 'node:fs'; fs.writeFileSync(process.env.SLP_TEST_RECEIPT, JSON.stringify(process.argv.slice(2))); process.stdin.pipe(process.stdout);\n`);
  chmodSync(fake, 0o755);
  const args = ['--mode', 'rpc', '--model', 'opencode/glm-5.3-flash', '--thinking', 'medium', '--session', '/preserved/session.jsonl', '--extension', '/host/tools.ts', '--append-system-prompt', 'Host policy'];
  const input = '{"id":"unicode","type":"prompt","message":"a\u2028b"}\n{"id":"cancel","type":"abort"}\n';
  for (const role of ['supervisor', 'lead', 'peer']) {
    const output = execFileSync(process.execPath, [join(installed, 'bin/pi-role.mjs'), role, ...args], { env: { ...process.env, SLP_PI_BIN: fake, SLP_TEST_RECEIPT: receipt }, input, encoding: 'utf8', timeout: 5000 });
    assert.equal(output, input);
    assert.deepEqual(readJson(receipt), [...args, '--append-system-prompt', roleInstructions(installed, role)]);
  }
  assert.deepEqual(piRoleArgs(['--version'], 'policy'), ['--version']);
  assert.deepEqual(piRoleArgs(['--', '--version'], 'policy'), ['--append-system-prompt', 'policy', '--', '--version']);
});

test('quota handoff preserves evidence and old parentage, emits only new-session arguments', t => {
  const { dir, installed } = fixture(t); install(root, installed);
  const replacement = { ...request, profiles: undefined, role: 'lead', binding: { provider: 'slp-pi-lead', model: 'opencode/glm-5.3-flash', thinkingOptionId: 'medium' },
    handoff: { previousAgentId: 'old-lead', reason: 'quota', authority: 'Human requests Pi replacement; existing edit scope only.', state: 'Architect report ready; Engineer paused on snapshot.', previousOwner: { settled: true, evidence: 'cancel receipt and paused writer acknowledgment' }, resources: [{ agentId: 'peer-1', parentAgentId: 'old-lead', state: 'paused' }] } };
  const plan = handoffPlan(installed, replacement);
  assert.equal(plan.create.provider, 'slp-pi-lead/opencode/glm-5.3-flash');
  assert.equal(plan.handoff.resources[0].parentAgentId, 'old-lead');
  assert.match(plan.handoff.candidate.sha256, /^[a-f0-9]{64}$/);
  assert.match(plan.create.initialPrompt, /Parentage has not changed/);
  assert.match(plan.activation, /no agent started/);
  assert.throws(() => handoffPlan(installed, { ...replacement, handoff: { ...replacement.handoff, previousOwner: { settled: false } } }), /settlement evidence/);
  const path = join(dir, 'handoff.json'); writeFileSync(path, json(replacement));
  const actual = JSON.parse(execFileSync(process.execPath, [join(installed, 'bin/slp.mjs'), 'prepare-handoff', path], { encoding: 'utf8' }));
  assert.equal(actual.create.provider, plan.create.provider);
});

test('explicit upgrade preserves old three-profile preferences, config and live-session files', t => {
  const { dir, installed } = fixture(t), home = join(dir, 'home'); mkdirSync(home);
  installPaseo(root, installed, home, true);
  // Simulate the previous three-Codex-provider binding, not a modified user provider.
  const bindingPath = join(installed, 'paseo-binding.json');
  const old = readJson(bindingPath);
  old.providers = Object.fromEntries(Object.entries(old.providers).filter(([id]) => id.startsWith('slp-codex-')));
  old.profiles = old.profiles.filter(p => ['slp-supervisor', 'slp-lead', 'slp-peer'].includes(p.id));
  writeFileSync(bindingPath, json(old));
  const manifestPath = join(installed, 'installed.json');
  const manifest = readJson(manifestPath);
  writeFileSync(manifestPath, json({ ...manifest, paseoBindingSha256: hash(json(old)) }));
  // Older installations predate the top-level installable skill directory.
  rmSync(join(installed, 'skills'), { recursive: true });
  const legacyManifest = readJson(manifestPath);
  writeFileSync(manifestPath, json({ ...legacyManifest, candidate: identity(installed) }));
  const configPath = join(home, 'config.json');
  const config = readJson(configPath);
  config.agents.providers = old.providers;
  config.daemon.agentProfiles = structuredClone(old.profiles);
  Object.assign(config.daemon.agentProfiles.find(p => p.id === 'slp-peer'), { model: 'gpt-5.6-luna', thinkingOptionId: 'high' });
  config.humanPreference = 'preserve';
  writeFileSync(configPath, json(config));
  const before = readFileSync(configPath, 'utf8');
  const oldBytes = readFileSync(join(installed, 'src/common.md'), 'utf8');
  const next = join(dir, 'next');
  assert.equal(upgradePaseo(root, next, installed).applied, false);
  assert.equal(readFileSync(configPath, 'utf8'), before);
  const receipt = upgradePaseo(root, next, installed, true);
  assert.equal(receipt.retainedInstallation, installed);
  assert.equal(readFileSync(join(installed, 'src/common.md'), 'utf8'), oldBytes);
  verifyInstall(installed); verifyInstall(next);
  const after = readJson(configPath);
  assert.equal(after.humanPreference, 'preserve');
  assert.equal(after.daemon.agentProfiles.length, 3);
  assert.equal(after.daemon.agentProfiles.find(p => p.id === 'slp-peer').thinkingOptionId, 'high');
  assert.equal(after.agents.providers['slp-pi-lead'].command[1], join(next, 'bin/pi-role.mjs'));
  assert.throws(() => upgradePaseo(root, next, installed, true), /new destination/);
});

test('upgrade refuses changed managed provider before writing a new installation', t => {
  const { dir, installed } = fixture(t), home = join(dir, 'home'); mkdirSync(home);
  installPaseo(root, installed, home, true);
  const path = join(home, 'config.json'), config = readJson(path);
  config.agents.providers['slp-codex-lead'].command = ['human-wrapper'];
  writeFileSync(path, json(config));
  const bytes = readFileSync(path, 'utf8');
  assert.throws(() => upgradePaseo(root, join(dir, 'next'), installed, true), /Modified provider/);
  assert.equal(readFileSync(path, 'utf8'), bytes);
});

test('quota edits invalidate prepared selections and fresh selection can use another provider', t => {
  const { dir, installed } = fixture(t); install(root, installed);
  const { path, catalog, route } = catalogFixture(dir);
  const launch = fields => launchPlan(installed, { ...request, profiles: undefined, repository: dir, ...fields });
  const stale = route('luna-code');
  catalog.options[0].availability = 'quota-exhausted';
  writeFileSync(path, json(catalog));
  assert.throws(() => launch({ route: stale }), /catalog changed/);
  assert.throws(() => launch({ route: route('luna-code') }), /disabled, unavailable/);
  assert.equal(launch({ route: route('glm-design') }).create.provider, 'slp-pi-peer/opencode/glm-5.3-flash');
  catalog.options[2].enabled = false;
  writeFileSync(path, json(catalog));
  assert.throws(() => launch({ route: route('glm-design') }), /disabled, unavailable/);
  assert.throws(() => launch({ route: route('missing') }), /Unknown routing option/);
  assert.throws(() => launch({ role: 'supervisor', route: route('luna-reason') }), /excluded/);
  assert.throws(() => launch({ route: { ...route('luna-reason'), thinkingOptionId: 'low' } }), /conflicting/);
  assert.throws(() => launch({ providers: [], route: route('luna-reason') }), /Unverified/);
  assert.throws(() => launch({ route: { optionId: 'luna-reason' } }), /hash missing/);
});

test('routes reads only the selected repo on every call, independent of host and installation location', t => {
  const { dir, installed } = fixture(t), home = join(dir, 'home'); mkdirSync(home);
  installPaseo(root, installed, home, true);
  assert.equal(existsSync(join(home, 'slp-routing.json')), false);
  initWorkspace(installed, dir, true);
  const path = join(dir, '.paseo-slp/slp-routing.json');
  assert.deepEqual(readJson(path), emptyCatalog());
  const { catalog } = catalogFixture(dir);
  writeFileSync(path, json(catalog));
  writeFileSync(join(home, 'slp-routing.json'), 'invalid legacy host catalog');
  const read = () => JSON.parse(execFileSync(process.execPath, [join(installed, 'bin/slp.mjs'), 'routes', dir], { cwd: home, env: { PATH: '', PASEO_HOME: home }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  const first = read();
  assert.equal(first.path, path);
  catalog.options[0].thinkingOptionId = 'high';
  writeFileSync(path, json(catalog));
  assert.notEqual(read().sha256, first.sha256);
  assert.equal(read().options[0].thinkingOptionId, 'high');
  verifyInstall(installed);
  installPaseo(root, installed, home, true);
  assert.deepEqual(readJson(path), catalog);
  writeFileSync(path, '{broken');
  assert.throws(read);
  assert.throws(() => validateCatalog({ ...catalog, options: [...catalog.options, catalog.options[0]] }), /duplicate/);
  assert.throws(() => validateCatalog({ ...catalog, options: [{ ...catalog.options[0], availability: 'typo' }] }), /availability/);
});

test('upgrade archives owned disposition settings in binding without reading or writing host routing', t => {
  const { dir, installed } = fixture(t), home = join(dir, 'home'); mkdirSync(home);
  installPaseo(root, installed, home, true);
  const configPath = join(home, 'config.json'), bindingPath = join(installed, 'paseo-binding.json');
  const binding = readJson(bindingPath), config = readJson(configPath);
  const specialized = [
    { id: 'slp-peer-engineer', provider: 'slp-codex-peer', model: 'gpt-5.6-luna', thinkingOptionId: 'high', featureValues: { fast_mode: true }, notes: 'Human edited' },
    { id: 'slp-peer-architect', provider: 'slp-pi-peer', model: 'opencode/glm-5.3-flash', thinkingOptionId: 'medium' },
    { id: 'slp-peer-reviewer', provider: 'slp-codex-peer' },
    { id: 'slp-peer-scout', provider: 'slp-codex-peer' },
  ];
  binding.profiles.push(...specialized);
  config.daemon.agentProfiles.push(...specialized, { id: 'human-custom-peer', provider: 'pi', model: 'human-model' });
  writeFileSync(bindingPath, json(binding));
  const manifestPath = join(installed, 'installed.json');
  writeFileSync(manifestPath, json({ ...readJson(manifestPath), paseoBindingSha256: hash(json(binding)) }));
  writeFileSync(configPath, json(config));
  const { catalog } = catalogFixture(dir);
  const path = join(home, 'slp-routing.json'); writeFileSync(path, json(catalog));
  const next = join(dir, 'next');
  const preview = upgradePaseo(root, next, installed);
  assert.equal(preview.retiredProfiles.length, 4);
  assert.deepEqual(readJson(path), catalog);
  upgradePaseo(root, next, installed, true);
  const after = readJson(configPath).daemon.agentProfiles;
  assert.equal(after.length, 4);
  assert.equal(after.filter(p => p.id.startsWith('slp-peer')).length, 1);
  assert.ok(after.some(p => p.id === 'human-custom-peer'));
  assert.deepEqual(readJson(path), catalog);
  assert.deepEqual(readJson(join(next, 'paseo-binding.json')).retiredProfiles, specialized);
  const final = join(dir, 'final');
  writeFileSync(path, 'invalid legacy host catalog');
  upgradePaseo(root, final, next, true);
  assert.equal(readFileSync(path, 'utf8'), 'invalid legacy host catalog');
  assert.deepEqual(readJson(join(final, 'paseo-binding.json')).retiredProfiles, specialized);
});

test('same option ID can resolve differently per repo; missing repo config cannot fall back or redirect', t => {
  const { dir, installed } = fixture(t); install(root, installed);
  const repoA = join(dir, 'repo-a'), repoB = join(dir, 'repo-b'); mkdirSync(repoA); mkdirSync(repoB);
  const a = catalogFixture(repoA), b = catalogFixture(repoB);
  b.catalog.options[0].provider = 'pi'; b.catalog.options[0].model = 'opencode/glm-5.3-flash';
  b.catalog.options[0].thinkingOptionId = 'high'; writeFileSync(b.path, json(b.catalog));
  const launch = (repository, route) => launchPlan(installed, { ...request, profiles: undefined, repository, route });
  assert.equal(launch(repoA, a.route('luna-code')).create.provider, 'slp-codex-peer/gpt-5.6-luna');
  assert.equal(launch(repoB, b.route('luna-code')).create.provider, 'slp-pi-peer/opencode/glm-5.3-flash');
  assert.throws(() => launch(repoB, a.route('luna-code')), /catalog changed/);
  assert.throws(() => launch(repoB, { ...b.route('luna-code'), catalogFile: a.path }), /repository-scoped/);
  rmSync(b.path);
  assert.throws(() => launch(repoB, { optionId: 'luna-code', catalogSha256: a.route('luna-code').catalogSha256 }), /Missing repository routing catalog/);
  assert.throws(() => readCatalog(), /Absolute repository/);
});
