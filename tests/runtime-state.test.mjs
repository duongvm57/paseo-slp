import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { install, json, identity, hash, readJson } from '../src/package.mjs';
import { localTarget, runtimeStatus } from '../src/runtime-state.mjs';
import { readFileSync } from 'node:fs';

const root = fileURLToPath(new URL('..', import.meta.url));
function fixture(t) {
  mkdirSync(join(root, '.local-checks'), { recursive: true });
  const dir = mkdtempSync(join(root, '.local-checks/rtstate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A fake daemon home: <home>/slp-runtime/state/* plus <home>/config.json.
function homeFixture(t, { receipt = null, config = null, language = null, routing = null } = {}) {
  const home = join(fixture(t), 'home');
  mkdirSync(join(home, 'slp-runtime/state'), { recursive: true });
  if (receipt) writeFileSync(join(home, 'slp-runtime/state/receipt.json'), json(receipt));
  if (routing) writeFileSync(join(home, 'slp-runtime/state/role-routing.json'), json(routing));
  if (language != null) writeFileSync(join(home, 'slp-runtime/state/communication-language'), language);
  if (config != null) writeFileSync(join(home, 'config.json'), json(config));
  return home;
}

test('local-target mirrors plugin detection: flag, env, then default', t => {
  const dir = fixture(t);
  assert.deepEqual(localTarget(dir), { daemonHome: dir, source: 'flag' });
  // Strip managed-session env so the unmanaged chain is exercised; a managed
  // seat legitimately resolves its bound home instead of the env/default.
  const saved = {};
  for (const key of ['PASEO_HOME', 'SLP_DAEMON_HOME', 'SLP_MANAGED_RUNTIME']) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  t.after(() => { for (const key of Object.keys(saved)) {
    if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  } });
  process.env.PASEO_HOME = dir;
  assert.deepEqual(localTarget(), { daemonHome: dir, source: 'env' });
  delete process.env.PASEO_HOME;
  const fallback = localTarget();
  assert.equal(fallback.source, 'default');
  assert.ok(fallback.daemonHome.endsWith('.paseo'));
  // Managed mode resolves the bound home and never falls through to env.
  process.env.SLP_MANAGED_RUNTIME = '1';
  process.env.SLP_DAEMON_HOME = dir;
  assert.deepEqual(localTarget(), { daemonHome: dir, source: 'managed-env' });
  assert.throws(() => localTarget('relative'), /Absolute path/);
});

test('status without a receipt distinguishes clean, orphaned and unknown homes', t => {
  // Clean config → INACTIVE.
  let home = homeFixture(t, { config: { agents: { providers: {} }, daemon: { agentProfiles: [] } } });
  let status = runtimeStatus(home);
  assert.equal(status.state, 'INACTIVE');
  assert.equal(status.receipt, null);
  // Orphaned slp-* entries → interrupted activation evidence.
  home = homeFixture(t, { config: { agents: { providers: { 'slp-devin-lead': {}, other: {} } }, daemon: { agentProfiles: [{ id: 'slp-lead' }] } } });
  status = runtimeStatus(home);
  assert.equal(status.state, 'RECOVERY_REQUIRED');
  assert.deepEqual(status.orphanedEntries, ['slp-devin-lead', 'slp-lead']);
  // No config.json at all → INACTIVE (nothing to scan, gap noted).
  home = homeFixture(t);
  status = runtimeStatus(home);
  assert.equal(status.state, 'INACTIVE');
  // Corrupt config → UNKNOWN, never a guessed clean state.
  home = homeFixture(t);
  writeFileSync(join(home, 'config.json'), '{ not json');
  status = runtimeStatus(home);
  assert.equal(status.state, 'UNKNOWN');
  assert.ok(status.gaps.some(gap => /config\.json unreadable/.test(gap)));
});

test('status fails closed on a corrupt receipt instead of guessing INACTIVE', t => {
  const home = homeFixture(t);
  writeFileSync(join(home, 'slp-runtime/state/receipt.json'), '{ not json');
  assert.throws(() => runtimeStatus(home), /Cannot read .*receipt\.json/);
});

test('status recomputes file-derivable views and marks daemon-only views as gaps', t => {
  const dir = fixture(t);
  const runtimePath = join(dir, 'runtime');
  install(root, runtimePath);
  const candidateSha256 = identity(root).sha256;
  const launcher = join(dir, 'launcher-bin');
  writeFileSync(launcher, '#!/bin/sh\n');
  const home = homeFixture(t, {
    config: { agents: { providers: { 'slp-devin-lead': {}, 'slp-codex-peer': {} } },
      daemon: { agentProfiles: [{ id: 'slp-lead' }], mcp: { injectIntoAgents: true } } },
    language: 'Vietnamese',
    routing: { schemaVersion: 1, supervisor: { family: 'devin', model: 'm1' }, lead: { family: 'devin', model: 'm2' } },
  });
  writeFileSync(join(home, 'slp-runtime/state/receipt.json'), json({
    schemaVersion: 1, pluginId: 'paseo-slp', revision: 3, state: 'ACTIVE',
    target: { hostId: 'h', daemonHome: realpathSync(home) }, stableRoot: join(home, 'slp-runtime'),
    createdAt: 't', updatedAt: 't', activeOperationId: null, retained: [],
    binding: {
      bindingSha256: 'b'.repeat(64), candidateSha256, payloadSha256: 'p'.repeat(64),
      runtimePath, launchSetSha256: 'l'.repeat(64), baseline: 'fresh',
      launcherFiles: [{ path: launcher, sha256: hash(readFileSync(launcher)), mode: 0o755 }],
      binaries: { devin: { path: launcher }, codex: { path: join(dir, 'absent-bin') } },
      owned: {
        providers: { 'slp-devin-lead': { present: true }, 'slp-pi-peer': { present: true, value: {} } },
        profiles: [{ index: 0, value: { id: 'slp-lead', provider: 'slp-devin-lead', model: 'm2', modeId: 'bypass', featureValues: { auto_accept: true } } }],
      },
    },
    operations: [{ operationId: 'op-1', kind: 'activate', phase: 'terminal', outcome: 'succeeded', conflicts: [], acceptedAt: 't1', completedAt: 't2' }],
  }));
  const status = runtimeStatus(home);
  assert.equal(status.state, 'ACTIVE');
  assert.equal(status.derivedFrom, 'local-files');
  assert.equal(status.checks.targetMatch, true);
  assert.equal(status.checks.runtime.ok, true);
  assert.deepEqual(status.checks.launchers, [{ path: launcher, ok: true }]);
  // slp-pi-peer was injected per the receipt but is absent from config.json.
  assert.deepEqual(status.checks.configDrift.missingProviders, ['slp-pi-peer']);
  assert.deepEqual(status.checks.configDrift.missingProfiles, []);
  assert.deepEqual(status.receipt.binding.binaries.codex.exists, false);
  assert.deepEqual(status.receipt.binding.managedProfiles,
    [{ id: 'slp-lead', provider: 'slp-devin-lead', model: 'm2', modeId: 'bypass', thinkingOptionId: null, featureValues: { auto_accept: true } }]);
  assert.equal(status.communicationLanguage, 'Vietnamese');
  assert.deepEqual(status.roleRouting.supervisor, { family: 'devin', model: 'm1' });
  assert.deepEqual(status.receipt.operations, [{ operationId: 'op-1', kind: 'activate', phase: 'terminal', outcome: 'succeeded', conflicts: 0, acceptedAt: 't1', completedAt: 't2' }]);
  assert.ok(status.gaps.some(gap => /family availability/.test(gap)));
});

test('status reports a target mismatch and launcher drift as local evidence', t => {
  const dir = fixture(t);
  const runtimePath = join(dir, 'runtime');
  install(root, runtimePath);
  const launcher = join(dir, 'launcher-bin');
  writeFileSync(launcher, 'v1');
  const home = homeFixture(t, {
    config: { agents: { providers: {} }, daemon: { agentProfiles: [] } },
    receipt: {
      schemaVersion: 1, pluginId: 'paseo-slp', revision: 1, state: 'ACTIVE',
      target: { hostId: 'h', daemonHome: '/some/other/home' },
      binding: {
        candidateSha256: 'f'.repeat(64), runtimePath,
        launcherFiles: [{ path: launcher, sha256: 'deadbeef'.repeat(8), mode: 0o755 }],
        binaries: {}, owned: { providers: {}, profiles: [] },
      },
      operations: [],
    },
  });
  const status = runtimeStatus(home);
  assert.equal(status.checks.targetMatch, false);
  assert.equal(status.checks.runtime.ok, false);
  assert.deepEqual(status.checks.launchers, [{ path: launcher, ok: false, detail: 'sha256 drift' }]);
});

test('CLI status and local-target are read-only and fail closed', t => {
  const home = homeFixture(t, { config: { agents: { providers: {} } } });
  const cli = join(root, 'bin/slp.mjs');
  const env = { PATH: process.env.PATH };
  const target = JSON.parse(execFileSync(process.execPath, [cli, 'local-target', '--paseo-home', home], { env, encoding: 'utf8' }));
  assert.deepEqual(target, { daemonHome: home, source: 'flag' });
  const status = JSON.parse(execFileSync(process.execPath, [cli, 'status', '--paseo-home', home], { env, encoding: 'utf8' }));
  assert.equal(status.state, 'INACTIVE');
  // Flags these commands do not own are rejected rather than ignored.
  assert.throws(() => execFileSync(process.execPath, [cli, 'status', '--apply'], { env }));
  assert.throws(() => execFileSync(process.execPath, [cli, 'status', 'extra'], { env }));
});
