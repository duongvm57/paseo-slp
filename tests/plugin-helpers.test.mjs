// Coverage for the managed-runtime additions to role-bundle and inventory:
// launch-env path rendering (SLP_NODE_BIN / SLP_RUNTIME_ROOT / SLP_DAEMON_HOME
// with POSIX quoting), explicit-home helper commands, fail-closed env
// validation, and the managed inventory contract — config-only providers
// labeled `provenance:'configured'`, never a CLI listing against a foreign
// daemon, and a hard failure when no exact home is supplied.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { install, json } from '../src/package.mjs';
import { roleBundle } from '../src/role-bundle.mjs';
import { verifyProvider } from '../src/binding.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

const fixture = t => {
  mkdirSync(join(root, '.local-checks'), { recursive: true });
  const dir = mkdtempSync(join(root, '.local-checks/plugin-helpers-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

const paseoHomeFixture = dir => {
  const home = join(dir, 'paseo');
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'config.json'), json({
    version: 1,
    agents: { providers: {
      'slp-codex-lead': { extends: 'codex', label: 'SLP codex lead', command: ['node', '/x/bin/codex-role.mjs', 'lead'] },
      'slp-devin-peer': { extends: 'acp', label: 'SLP devin peer', command: ['node', '/x/bin/devin-role.mjs', 'peer'] },
    } },
    daemon: { agentProfiles: [{ id: 'slp-supervisor', provider: 'slp-codex-lead', model: 'gpt-5.6-luna' }] },
  }));
  return home;
};

const slp = (args, env) => execFileSync(process.execPath, [join(root, 'bin/slp.mjs'), ...args], {
  env, encoding: 'utf8',
});

const managedEnv = (home, over = {}) => ({
  PATH: '',
  SLP_MANAGED_RUNTIME: '1',
  SLP_NODE_BIN: '/opt/node/bin/node',
  SLP_RUNTIME_ROOT: '/rt/candidate-1',
  SLP_DAEMON_HOME: home,
  ...over,
});

// --- role-bundle: managed rendering ----------------------------------------

test('unmanaged role bundle keeps the historical rendering and ordering', t => {
  const dir = fixture(t), installed = join(dir, 'release');
  install(root, installed);
  const bundle = roleBundle(installed, 'lead', {});
  assert.deepEqual(bundle.parts, ['common.md', 'roles/lead.md', 'delegation.md']);
  assert.ok(bundle.instructions.includes(`Snapshot command: node '${join(installed, 'bin/slp.mjs')}' snapshot <repository>`));
  assert.ok(!bundle.instructions.includes('--paseo-home'));
  assert.ok(!bundle.instructions.includes('SLP_MANAGED_RUNTIME'));
  // Part order: common policy first, then the role file, then delegation.
  const common = bundle.instructions.indexOf(readFileSync(join(root, 'src/common.md'), 'utf8'));
  const role = bundle.instructions.indexOf(readFileSync(join(root, 'src/roles/lead.md'), 'utf8'));
  const delegation = bundle.instructions.indexOf(readFileSync(join(root, 'src/delegation.md'), 'utf8'));
  assert.ok(common !== -1 && role !== -1 && delegation !== -1);
  assert.ok(common < role && role < delegation);
});

test('managed bundle renders verified Node, the stable runtime CLI and explicit home', t => {
  const dir = fixture(t), installed = join(dir, 'release');
  install(root, installed);
  const env = {
    SLP_MANAGED_RUNTIME: '1',
    // Quote-bearing and space-bearing paths exercise the POSIX escaping.
    SLP_NODE_BIN: "/opt/n'ode/bin/node",
    SLP_RUNTIME_ROOT: '/rt/cand one',
    SLP_DAEMON_HOME: '/home/daemon/.paseo',
  };
  const bundle = roleBundle(installed, 'peer', env);
  assert.deepEqual(bundle.parts, ['common.md', 'roles/peer.md']);
  const cli = `'/opt/n'\\''ode/bin/node' '/rt/cand one/bin/slp.mjs'`;
  const home = `'/home/daemon/.paseo'`;
  assert.ok(bundle.instructions.includes(`Snapshot command: ${cli} snapshot <repository>`));
  assert.ok(bundle.instructions.includes(`Installed policy directory: /rt/cand one/src`));
  // Commands that accept --paseo-home render it explicitly.
  for (const line of [
    'routes <repository>', 'inventory', 'agents', 'notebook <repository>',
    'install <dir>',
  ]) {
    assert.ok(bundle.instructions.includes(`${cli} ${line} --paseo-home ${home}`), line);
  }
  // monitor takes no flag — the home goes inside the request payload.
  assert.ok(bundle.instructions.includes(`${cli} monitor <request.json>`) &&
    bundle.instructions.includes(`"paseoHome": "/home/daemon/.paseo"`));
  // upgrade/uninstall resolve the home from the target's paseo-binding.json.
  assert.ok(bundle.instructions.includes(`paseo-binding.json must record ${home}`));
  // init/materialize are repo-scoped and never touch a daemon home.
  assert.ok(bundle.instructions.includes('init/materialize/snapshot/prepare/prepare-handoff/verify are repo-scoped'));
  // Policy text must not embed this checkout's path or RPC calls.
  assert.ok(!bundle.instructions.includes(installed));
  assert.ok(!/callPluginRpc|plugin\/rpc/.test(bundle.instructions));
});

test('managed bundle fails closed on a missing or relative launch env var', t => {
  const dir = fixture(t), installed = join(dir, 'release');
  install(root, installed);
  const base = { SLP_MANAGED_RUNTIME: '1', SLP_NODE_BIN: '/n/bin/node', SLP_RUNTIME_ROOT: '/rt/x', SLP_DAEMON_HOME: '/h' };
  for (const [over, pattern] of [
    [{ SLP_NODE_BIN: undefined }, /absolute SLP_NODE_BIN/],
    [{ SLP_RUNTIME_ROOT: undefined }, /absolute SLP_RUNTIME_ROOT/],
    [{ SLP_DAEMON_HOME: undefined }, /absolute SLP_DAEMON_HOME/],
    [{ SLP_NODE_BIN: 'node' }, /absolute SLP_NODE_BIN/],
    [{ SLP_RUNTIME_ROOT: 'relative/path' }, /absolute SLP_RUNTIME_ROOT/],
    [{ SLP_DAEMON_HOME: '~/.paseo' }, /absolute SLP_DAEMON_HOME/],
  ]) {
    assert.throws(() => roleBundle(installed, 'lead', { ...base, ...over }), pattern);
  }
  // Any value other than '1' leaves the bundle fully unmanaged.
  const off = roleBundle(installed, 'lead', { ...base, SLP_MANAGED_RUNTIME: '0' });
  assert.ok(!off.instructions.includes('--paseo-home'));
  assert.ok(off.instructions.includes(`node '${join(installed, 'bin/slp.mjs')}'`));
});

// --- inventory: managed vs unmanaged ---------------------------------------

test('managed inventory reads the exact home, never the CLI, and labels providers configured', t => {
  const dir = fixture(t), home = paseoHomeFixture(dir);
  // A live-looking pid file must not matter under managed mode.
  writeFileSync(join(home, 'paseo.pid'), json({ pid: process.pid, listen: '127.0.0.1:1' }));
  // A fake `paseo` CLI on PATH that would return a marker provider if invoked.
  const fakeBin = join(dir, 'bin');
  mkdirSync(fakeBin);
  writeFileSync(join(fakeBin, 'paseo'), '#!/bin/sh\nprintf \'%s\n\' \'[{"provider":"LIVE-MARKER","enabled":"Enabled","status":"available"}]\'\n');
  chmodSync(join(fakeBin, 'paseo'), 0o755);
  const env = managedEnv(home, { PATH: fakeBin });

  const out = JSON.parse(slp(['inventory', '--paseo-home', home], env));
  assert.equal(out.source.providers, join(home, 'config.json'));
  assert.equal(out.providersProvenance, 'configured, not live');
  assert.ok(out.providers.length >= 2);
  assert.ok(out.providers.every(p => p.provenance === 'configured'));
  // The fake CLI listing was never invoked.
  assert.ok(!out.providers.some(p => p.id === 'LIVE-MARKER'));
  // Static config entries are rejected as launch evidence (src/binding.mjs).
  assert.throws(
    () => verifyProvider(out.providers, 'slp-codex-lead', () => 'codex'),
    /configured inventory is not live evidence/,
  );
  // Profiles still come from the same exact-home config.
  assert.ok(out.profiles.some(p => p.id === 'slp-supervisor'));
  // With no flag, the managed env home is used — not the process default.
  const implicit = JSON.parse(slp(['inventory'], env));
  assert.equal(implicit.source.providers, join(home, 'config.json'));
  assert.equal(implicit.providersProvenance, 'configured, not live');
});

test('managed inventory fails rather than infer a home when none is bound', () => {
  const result = spawnSync(process.execPath, [join(root, 'bin/slp.mjs'), 'inventory'], {
    env: { PATH: '', SLP_MANAGED_RUNTIME: '1', HOME: '' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SLP_DAEMON_HOME|refusing to infer/);
});

test('a relative --paseo-home is rejected before any read', () => {
  const result = spawnSync(process.execPath, [join(root, 'bin/slp.mjs'), 'inventory', '--paseo-home', 'rel/path'], {
    env: { PATH: '' }, encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Absolute path required/);
});

// --- managed fail-closed home guards (spec §10 — the guard must stand even
// when the session env is stripped of PASEO_HOME) -----------------------------

const managedFail = (args, extraEnv = {}) =>
  spawnSync(process.execPath, [join(root, 'bin/slp.mjs'), ...args], {
    env: { PATH: '', SLP_MANAGED_RUNTIME: '1', HOME: '/nonexistent', ...extraEnv },
    encoding: 'utf8',
  });

const agentHomeFixture = dir => {
  const home = paseoHomeFixture(dir);
  mkdirSync(join(home, 'agents', 'grp'), { recursive: true });
  writeFileSync(join(home, 'agents', 'grp', 'one.json'),
    json({ id: 'agent-1', title: 'managed agent', provider: 'slp-devin-peer', cwd: dir }));
  return home;
};

test('managed agents/notebook/monitor fail when no home is bound', t => {
  const dir = fixture(t);
  writeFileSync(join(dir, 'req.json'), json({ agents: [{ id: 'x' }] }));
  for (const [args, pattern] of [
    [['agents'], /SLP_DAEMON_HOME|refusing to infer/],
    [['notebook', root], /SLP_DAEMON_HOME|refusing to infer/],
    [['monitor', join(dir, 'req.json')], /SLP_DAEMON_HOME|refusing to infer/],
    // A bare --paseo-home must resolve the managed home or fail at parse time —
    // never the process default ~/.paseo.
    [['inventory', '--paseo-home'], /SLP_DAEMON_HOME|refusing to infer/],
    [['agents', '--paseo-home'], /SLP_DAEMON_HOME|refusing to infer/],
  ]) {
    const result = managedFail(args);
    assert.equal(result.status, 1, `${args.join(' ')}: ${result.stderr}`);
    assert.match(result.stderr, pattern);
  }
  const rel = managedFail(['agents'], { SLP_DAEMON_HOME: 'rel/path' });
  assert.equal(rel.status, 1);
  assert.match(rel.stderr, /SLP_DAEMON_HOME|refusing to infer/);
});

test('managed agents/notebook/monitor resolve SLP_DAEMON_HOME or PASEO_HOME', t => {
  const dir = fixture(t), home = agentHomeFixture(dir);
  writeFileSync(join(dir, 'req.json'), json({ agents: [{ id: 'agent-1' }] }));
  // SLP_DAEMON_HOME binds the home for every helper.
  const env = { PATH: '', SLP_MANAGED_RUNTIME: '1', SLP_DAEMON_HOME: home, HOME: '/nonexistent' };
  const agentsOut = JSON.parse(slp(['agents'], env));
  assert.deepEqual(agentsOut.map(a => a.id), ['agent-1']);
  // A bare --paseo-home under managed resolves the bound home, not ~/.paseo.
  const bareOut = JSON.parse(slp(['agents', '--paseo-home'], env));
  assert.deepEqual(bareOut.map(a => a.id), ['agent-1']);
  // notebook probes git — give it a real PATH (the managed home stays bound).
  const gitEnv = { ...env, PATH: process.env.PATH };
  const notebookOut = JSON.parse(slp(['notebook', root], gitEnv));
  assert.equal(notebookOut.gitCommonDir.length > 0, true);
  const monitorOut = JSON.parse(slp(['monitor', join(dir, 'req.json')], env));
  assert.equal(monitorOut.scanned, 1);
  // PASEO_HOME alone carries the same value when SLP_DAEMON_HOME is absent.
  const paseoEnv = { PATH: '', SLP_MANAGED_RUNTIME: '1', PASEO_HOME: home, HOME: '/nonexistent' };
  assert.deepEqual(JSON.parse(slp(['agents'], paseoEnv)).map(a => a.id), ['agent-1']);
  // An explicit absolute home still wins under managed mode.
  const other = paseoHomeFixture(join(dir, 'other'));
  mkdirSync(join(other, 'agents', 'grp'), { recursive: true });
  writeFileSync(join(other, 'agents', 'grp', 'two.json'), json({ id: 'agent-2', title: 'explicit', provider: 'pi' }));
  const explicit = JSON.parse(slp(['agents', '--paseo-home', other], env));
  assert.deepEqual(explicit.map(a => a.id), ['agent-2']);
  // monitor honors an explicit request.paseoHome the same way.
  writeFileSync(join(dir, 'req2.json'), json({ paseoHome: other, agents: [{ id: 'agent-2' }] }));
  const monitorExplicit = JSON.parse(slp(['monitor', join(dir, 'req2.json')], env));
  assert.equal(monitorExplicit.scanned, 1);
});

test('unmanaged home resolution is unchanged — default and bare flag still work', t => {
  const dir = fixture(t), home = agentHomeFixture(dir);
  const env = { PATH: '', PASEO_HOME: home, HOME: '/nonexistent' };
  assert.deepEqual(JSON.parse(slp(['agents'], env)).map(a => a.id), ['agent-1']);
  assert.deepEqual(JSON.parse(slp(['agents', '--paseo-home'], env)).map(a => a.id), ['agent-1']);
  // Unmanaged with a nonexistent home returns empty state, not a throw.
  assert.deepEqual(JSON.parse(slp(['agents'], { PATH: '', HOME: dir })), []);
});

// --- S1: install --paseo-home on a never-installed dir ----------------------

test('install --paseo-home on a pre-existing never-installed dir fails with a business error', t => {
  const dir = fixture(t);
  const dest = join(dir, 'dest'), home = join(dir, 'home');
  mkdirSync(dest); // exists but was never installed — no installed.json
  const result = spawnSync(process.execPath,
    [join(root, 'bin/slp.mjs'), 'install', dest, '--paseo-home', home, '--apply'],
    { env: { PATH: '' }, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not an installed SLP directory|missing installed\.json/i);
  assert.ok(!/ENOENT/.test(result.stderr), `raw ENOENT leaked: ${result.stderr}`);
  // A non-existent destination still takes the normal install path (no --apply
  // here: the proposal output proves the guard did not block it).
  const fresh = spawnSync(process.execPath,
    [join(root, 'bin/slp.mjs'), 'install', join(dir, 'fresh'), '--paseo-home', home],
    { env: { PATH: '' }, encoding: 'utf8' });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.match(fresh.stdout, /"applied": false|"providers"/);
});

test('unmanaged inventory keeps its existing shape — no provenance markers', t => {
  const dir = fixture(t), home = paseoHomeFixture(dir);
  const out = JSON.parse(slp(['inventory', '--paseo-home', home], { PATH: '' }));
  assert.equal(out.providersProvenance, undefined);
  assert.ok(out.providers.every(p => !('provenance' in p)));
  // Unmanaged config fallback entries still pass launch-time verification.
  const { observed } = verifyProvider(out.providers, 'slp-codex-lead', () => 'codex');
  assert.equal(observed.id, 'slp-codex-lead');
  assert.equal(out.profiles[0].id, 'slp-supervisor');
});
