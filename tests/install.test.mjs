import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync, lstatSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { install, verifyInstall, json, readJson } from '../src/package.mjs';
import { installPaseo, uninstallPaseo, initWorkspace } from '../src/paseo-install.mjs';
import { configFile, writeConfig } from '../src/host-config.mjs';
import { emptyCatalog } from '../src/routing.mjs';
import { roleInstructions, roleBundle } from '../src/role-bundle.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
function fixture(t) {
  mkdirSync(join(root, '.local-checks'), { recursive: true });
  const dir = mkdtempSync(join(root, '.local-checks/installer-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = join(dir, 'paseo home'), destination = join(dir, 'installed role');
  mkdirSync(home);
  return { dir, home, destination };
}
// Tests cross the same host-config seam as production instead of forging config.json.
function config(home, value) { writeConfig(configFile(home), value); }

test('integrated install previews, preserves preferences and unrelated config, and rolls back only owned entries', t => {
  const { home, destination } = fixture(t);
  const before = { version: 1, privateSetting: 'not-in-receipt', agents: { providers: {
    legacy: { extends: 'codex', label: 'Legacy', command: ['old-runtime'] },
  } }, daemon: { mcp: { enabled: false, injectIntoAgents: false }, agentProfiles: [
    { id: 'personal-lead', name: 'My Lead', provider: 'legacy', model: 'human-model', modeId: 'full-access', thinkingOptionId: 'high', featureValues: { fast_mode: true } },
  ] } };
  config(home, before);
  const originalBytes = readFileSync(join(home, 'config.json'), 'utf8');
  const preview = installPaseo(root, destination, home);
  assert.equal(preview.applied, false);
  assert.equal(existsSync(destination), false);
  assert.equal(readFileSync(join(home, 'config.json'), 'utf8'), originalBytes);
  installPaseo(root, destination, home, true);
  verifyInstall(destination);
  const current = readJson(join(home, 'config.json'));
  assert.deepEqual(current.agents.providers.legacy, before.agents.providers.legacy);
  const lead = current.daemon.agentProfiles.find(p => p.id === 'slp-lead');
  assert.equal(lead.provider, 'slp-codex-lead');
  assert.deepEqual(current.daemon.agentProfiles[0], before.daemon.agentProfiles[0]);
  assert.ok(!readFileSync(join(destination, 'paseo-binding.json'), 'utf8').includes('not-in-receipt'));
  assert.equal(lstatSync(join(home, 'config.json')).mode & 0o777, 0o600);
  current.newHumanSetting = 'keep'; config(home, current);
  assert.equal(uninstallPaseo(destination).applied, false);
  assert.equal(existsSync(destination), true);
  uninstallPaseo(destination, true);
  assert.deepEqual(readJson(join(home, 'config.json')), { ...before, newHumanSetting: 'keep' });
  assert.equal(existsSync(destination), false);
});

test('collisions and modified profiles preserve both installation and host configuration', t => {
  const { home, destination, dir } = fixture(t);
  installPaseo(root, destination, home, true);
  const current = readJson(join(home, 'config.json'));
  current.daemon.agentProfiles[0].model = 'human-updated'; config(home, current);
  assert.throws(() => installPaseo(root, join(dir, 'another'), home, true), /already exists/);
  assert.throws(() => uninstallPaseo(destination, true), /Modified profile/);
  assert.deepEqual(readJson(join(home, 'config.json')), current);
  assert.equal(existsSync(destination), true);
});

test('extra files or changed binding block removal before detaching Paseo', t => {
  const { home, destination } = fixture(t);
  installPaseo(root, destination, home, true);
  const current = readFileSync(join(home, 'config.json'), 'utf8');
  writeFileSync(join(destination, 'human.md'), 'preserve');
  assert.throws(() => uninstallPaseo(destination, true), /Extra files/);
  rmSync(join(destination, 'human.md'));
  writeFileSync(join(destination, 'paseo-binding.json'), '{}');
  assert.throws(() => uninstallPaseo(destination, true), /binding changed/);
  assert.equal(readFileSync(join(home, 'config.json'), 'utf8'), current);
});

test('workspace init creates only protocol, routing and notebook once and preserves Human edits independently', t => {
  const { dir, destination } = fixture(t);
  install(root, destination);
  writeFileSync(join(dir, 'AGENTS.md'), 'Human instructions');
  assert.equal(initWorkspace(destination, dir).applied, false);
  assert.equal(existsSync(join(dir, '.paseo-slp')), false);
  const initialized = initWorkspace(destination, dir, true);
  assert.equal(initialized.files.length, 3);
  const protocol = join(dir, '.paseo-slp/WORKSPACE_PROTOCOL.md');
  const routing = join(dir, '.paseo-slp/slp-routing.json');
  const notebook = join(dir, '.paseo-slp/notebook.md');
  assert.match(readFileSync(protocol, 'utf8'), /Lead reads this file/);
  const seeded = readJson(routing).options;
  assert.deepEqual(seeded, readJson(join(root, 'src/templates/slp-routing.json')).options);
  assert.ok(seeded.length > 0 && seeded.every(o => o.enabled === false && o.availability === 'unknown'));
  assert.match(readFileSync(notebook, 'utf8'), /Supervisor notebook/);
  assert.equal(existsSync(join(dir, '.paseo-slp/skills')), false);
  writeFileSync(protocol, 'Human protocol');
  writeFileSync(notebook, 'Human notebook');
  assert.equal(initWorkspace(destination, dir, true).preserved, true);
  assert.equal(readFileSync(protocol, 'utf8'), 'Human protocol');
  assert.equal(readFileSync(notebook, 'utf8'), 'Human notebook');
  assert.equal(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), 'Human instructions');
  rmSync(routing);
  const repaired = initWorkspace(destination, dir, true);
  assert.equal(repaired.files.filter(file => file.applied).length, 1);
  assert.equal(readFileSync(protocol, 'utf8'), 'Human protocol');
});

test('repo init imports only an explicit catalog, preserves existing files and rejects invalid imports before writes', t => {
  const { dir, destination, home } = fixture(t); install(root, destination);
  const repository = join(dir, 'job'); mkdirSync(repository);
  const input = join(home, 'slp-routing.json');
  writeFileSync(input, 'invalid');
  assert.throws(() => initWorkspace(destination, repository, true, input));
  assert.equal(existsSync(join(repository, '.paseo-slp')), false);
  const catalog = readJson(join(root, 'src/templates/slp-routing.json'));
  writeFileSync(input, json(catalog));
  const cli = join(destination, 'bin/slp.mjs');
  const run = flags => JSON.parse(execFileSync(process.execPath, [cli, 'init', repository, '--routing-from', input, ...flags], { encoding: 'utf8' }));
  assert.equal(run([]).applied, false);
  assert.equal(existsSync(join(repository, '.paseo-slp/slp-routing.json')), false);
  assert.equal(run(['--apply']).applied, true);
  const routing = join(repository, '.paseo-slp/slp-routing.json');
  assert.deepEqual(readJson(routing), catalog);
  catalog.options[0].enabled = false; writeFileSync(routing, json(catalog));
  assert.equal(run(['--apply']).preserved, true);
  assert.equal(readJson(routing).options[0].enabled, false);
  const other = join(dir, 'another-job'); mkdirSync(other);
  symlinkSync(home, join(other, '.paseo-slp'));
  assert.throws(() => initWorkspace(destination, other, true), /Expected repo directory/);
  assert.equal(existsSync(join(other, '.paseo-slp/WORKSPACE_PROTOCOL.md')), false);
});

test('installed adapter injects every role over stdio while preserving host prompts, permissions and protocol replies', t => {
  const { dir, destination } = fixture(t);
  install(root, destination);
  const fake = join(dir, 'fake-codex');
  writeFileSync(fake, `#!${process.execPath}\nif(process.argv.includes('--version')) { console.log('probe-ok'); process.exit(0); } process.stdin.pipe(process.stdout);\n`);
  chmodSync(fake, 0o755);
  const messages = [
    { id: 1, method: 'thread/start', params: { developerInstructions: 'Paseo orchestration tools', model: 'selected', approvalPolicy: 'never', sandbox: 'danger-full-access', config: { features: { fast_mode: true } } } },
    { id: 2, method: 'thread/resume', params: { threadId: 'existing', developerInstructions: 'Resume context' } },
    { id: 3, method: 'turn/start', params: { threadId: 'existing', input: [{ type: 'text', text: 'ordinary assignment' }] } },
    { id: 4, method: 'turn/start', params: { developerInstructions: 'Host turn', collaborationMode: { mode: 'plan', settings: { model: 'selected', developer_instructions: 'Host mode' } } } },
    { id: 5, method: 'turn/interrupt', params: { threadId: 'existing', turnId: 'running' } },
    { id: 'permission', result: { decision: 'decline' } },
  ];
  for (const role of ['supervisor', 'lead', 'peer']) {
    const argv = [join(destination, 'bin/codex-role.mjs'), role, 'app-server'];
    const env = { ...process.env, SLP_CODEX_BIN: fake };
    const actual = execFileSync(process.execPath, argv, { env, input: messages.map(m => JSON.stringify(m)).join('\n') + '\n', encoding: 'utf8', timeout: 5000 }).trim().split('\n').map(JSON.parse);
    const instruction = roleInstructions(destination, role);
    assert.equal(actual[0].params.developerInstructions, `Paseo orchestration tools\n\n${instruction}`);
    assert.equal(actual[1].params.developerInstructions, `Resume context\n\n${instruction}`);
    assert.equal(actual[0].params.approvalPolicy, 'never');
    assert.equal(actual[0].params.sandbox, 'danger-full-access');
    assert.deepEqual(actual[0].params.config, messages[0].params.config);
    assert.deepEqual(actual[2], messages[2]);
    assert.ok(actual[3].params.collaborationMode.settings.developer_instructions.endsWith(instruction));
    assert.deepEqual(actual.slice(4), messages.slice(4));
    assert.equal(roleBundle(destination, role).orchestrates, role !== 'peer');
    assert.equal(execFileSync(process.execPath, [argv[0], role, '--version'], { env, encoding: 'utf8' }).trim(), 'probe-ok');
  }
});

test('one-command installer registers profiles and reloads the selected home, uninstall removes them', t => {
  const { dir, home, destination } = fixture(t);
  writeFileSync(join(home, 'paseo.pid'), json({ listen: '127.0.0.1:12345' }));
  const fakeBin = join(dir, 'bin'); mkdirSync(fakeBin);
  const paseo = join(fakeBin, 'paseo');
  writeFileSync(paseo, `#!${process.execPath}\nimport { writeFileSync } from 'node:fs'; writeFileSync(process.env.PASEO_HOME + '/reload-receipt', process.argv.slice(2).join(' ')); console.log(JSON.stringify({ appliedPaths: [], restartRequiredPaths: [], overrideControlledPaths: [] }));\n`);
  chmodSync(paseo, 0o755);
  const env = { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, SLP_HOME: destination, PASEO_HOME: home };
  const result = JSON.parse(execFileSync('bash', [join(root, 'install.sh')], { env, encoding: 'utf8', timeout: 5000 }));
  assert.equal(result.applied, true);
  assert.equal(result.reloadRequired, false);
  assert.equal(readFileSync(join(home, 'reload-receipt'), 'utf8'), 'reload --host 127.0.0.1:12345 --json');
  assert.equal(readJson(join(home, 'config.json')).daemon.agentProfiles.length, 2);
  execFileSync(process.execPath, [join(destination, 'bin/slp.mjs'), 'uninstall', destination, '--apply', '--reload'], { env, timeout: 5000 });
  assert.equal(readJson(join(home, 'config.json')).daemon.agentProfiles.length, 0);
  assert.equal(existsSync(destination), false);
});

test('repeat install preserves user-selected settings without rewriting config', t => {
  const { home, destination } = fixture(t);
  installPaseo(root, destination, home, true);
  const current = readJson(join(home, 'config.json'));
  current.daemon.agentProfiles[0].modeId = 'full-access'; config(home, current);
  const before = readFileSync(join(home, 'config.json'), 'utf8');
  assert.equal(installPaseo(root, destination, home, true).alreadyInstalled, true);
  assert.equal(readFileSync(join(home, 'config.json'), 'utf8'), before);
});

test('reload failure reports applied files and leaves a usable installation for retry', t => {
  const { dir, home, destination } = fixture(t);
  const fakeBin = join(dir, 'bin'); mkdirSync(fakeBin);
  const paseo = join(fakeBin, 'paseo');
  writeFileSync(paseo, '#!/bin/sh\nexit 23\n'); chmodSync(paseo, 0o755);
  writeFileSync(join(home, 'paseo.pid'), json({ listen: '127.0.0.1:12345' }));
  let failure;
  try {
    execFileSync(process.execPath, [join(root, 'bin/slp.mjs'), 'install', destination, '--paseo-home', home, '--apply', '--reload'], {
      env: { ...process.env, PATH: fakeBin }, encoding: 'utf8', timeout: 5000,
    });
  } catch (error) { failure = error; }
  assert.equal(failure?.status, 1);
  const report = JSON.parse(failure.stdout);
  assert.equal(report.applied, true);
  assert.equal(report.reloadRequired, true);
  assert.match(report.reloadError, /Files applied/);
  verifyInstall(destination);
  assert.equal(readJson(join(home, 'config.json')).daemon.agentProfiles.length, 2);
});

test('install scaffolds the user-scope catalog; uninstall removes only an unmodified scaffold', t => {
  const { home, destination } = fixture(t);
  installPaseo(root, destination, home, true);
  const catalog = join(home, 'slp-routing.json');
  assert.deepEqual(readJson(catalog), readJson(join(root, 'src/templates/slp-routing.json')));
  const removed = uninstallPaseo(destination, true);
  assert.equal(removed.userCatalog.preserved, false);
  assert.equal(existsSync(catalog), false);
});

test('a Human-edited user catalog survives uninstall; an existing catalog is never claimed', t => {
  const { home, destination } = fixture(t);
  installPaseo(root, destination, home, true);
  const catalog = join(home, 'slp-routing.json');
  writeFileSync(catalog, json({ ...emptyCatalog(), options: [{ id: 'mine' }] }));
  const kept = uninstallPaseo(destination, true);
  assert.equal(kept.userCatalog.preserved, true);
  assert.equal(readJson(catalog).options[0].id, 'mine');
  const { home: home2, destination: dest2 } = fixture(t);
  writeFileSync(join(home2, 'slp-routing.json'), 'Human catalog');
  installPaseo(root, dest2, home2, true);
  assert.equal(readFileSync(join(home2, 'slp-routing.json'), 'utf8'), 'Human catalog');
});

test('saved profiles default to the host\'s enabled provider family', t => {
  const { home, destination } = fixture(t);
  config(home, { version: 1, agents: { providers: { pi: { enabled: true } } }, daemon: {} });
  installPaseo(root, destination, home, true);
  const profiles = readJson(join(home, 'config.json')).daemon.agentProfiles;
  assert.equal(profiles.find(p => p.id === 'slp-lead').provider, 'slp-pi-lead');
  assert.equal(profiles.find(p => p.id === 'slp-supervisor').provider, 'slp-pi-supervisor');
  // Claude is a valid default and never outranks an earlier enabled family.
  const second = fixture(t);
  config(second.home, { version: 1, agents: { providers: { claude: { enabled: true } } }, daemon: {} });
  installPaseo(root, second.destination, second.home, true);
  assert.equal(readJson(join(second.home, 'config.json')).daemon.agentProfiles.find(p => p.id === 'slp-lead').provider, 'slp-claude-lead');
  const third = fixture(t);
  config(third.home, { version: 1, agents: { providers: { codex: { enabled: true }, claude: { enabled: true } } }, daemon: {} });
  installPaseo(root, third.destination, third.home, true);
  assert.equal(readJson(join(third.home, 'config.json')).daemon.agentProfiles.find(p => p.id === 'slp-lead').provider, 'slp-codex-lead');
});
