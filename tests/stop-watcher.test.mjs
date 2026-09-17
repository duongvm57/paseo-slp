import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { watchStop } from '../e2e/stop-watcher.mjs';

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'slp-stop-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const workspace = join(dir, 'workspace'); mkdirSync(workspace);
  for (const name of ['lines.mjs', 'discount.mjs', 'checkout.mjs', 'human-note.txt']) writeFileSync(join(workspace, name), 'fixture');
  const config = { directory: dir, workspace, token: 'test-stop',
    supervisorId: 'supervisor', deadline: new Date(Date.now() + 5000).toISOString(),
    prompt: 'HUMAN STOP: stop work and settle; no restart.', minRemainingMs: 1000 };
  const save = (name, value) => writeFileSync(join(dir, name), JSON.stringify(value));
  const calls = [];
  const invoke = async args => {
    calls.push(args);
    if (args[0] === 'send') return { accepted: true };
    const id = args[1];
    return { Id: id, Status: 'running', Cwd: workspace,
      ParentAgentId: id === 'engineer' ? 'lead' : 'supervisor', PendingPermissions: [] };
  };
  const ready = overrides => {
    save('actor-binding.json', { engineerId: 'engineer', leadId: 'lead' });
    save('readiness.json', { token: config.token, readyAt: new Date().toISOString(),
      expiresAfterSeconds: 60, ...overrides });
  };
  return { dir, config, save, calls, invoke, ready };
}

test('running watcher dispatches once at readiness, without an agent continuation', async t => {
  const f = setup(t);
  const pending = watchStop(f.config, { invoke: f.invoke, verifyWait: () => {} });
  assert.equal(JSON.parse(readFileSync(join(f.dir, 'watcher-started.json'))).status, 'watching');
  setTimeout(() => f.ready(), 100);
  const result = await pending;
  assert.equal(result.status, 'sent');
  assert.equal(f.calls.filter(x => x[0] === 'send').length, 1);
  assert.ok(Date.parse(result.sentAt) - Date.parse(result.readiness.readyAt) < 10000);
  await assert.rejects(watchStop(f.config, { invoke: f.invoke, verifyWait: () => {} }), /EEXIST/);
  assert.equal(f.calls.filter(x => x[0] === 'send').length, 1);
});

test('expired, wrong-token and idle-writer boundaries never dispatch stop', async t => {
  for (const kind of ['expired', 'token', 'idle', 'parent']) {
    const f = setup(t);
    f.ready(kind === 'expired' ? { readyAt: new Date(Date.now() - 120000).toISOString() }
      : kind === 'token' ? { token: 'other-trial' } : {});
    const invoke = async args => {
      const result = await f.invoke(args);
      if (args[0] === 'inspect' && args[1] === 'engineer') {
        if (kind === 'idle') result.Status = 'closed';
        if (kind === 'parent') result.ParentAgentId = 'other-lead';
      }
      return result;
    };
    await assert.rejects(watchStop(f.config, { invoke, verifyWait: () => {} }));
    assert.equal(f.calls.filter(x => x[0] === 'send').length, 0);
    assert.equal(JSON.parse(readFileSync(join(f.dir, 'watcher-result.json'))).status, 'not-sent');
  }
});

test('timeout after dispatch is recorded as ambiguous and is never retried', async t => {
  const f = setup(t); f.ready();
  const invoke = async args => {
    if (args[0] === 'send') { f.calls.push(args); throw new Error('transport timeout'); }
    return f.invoke(args);
  };
  await assert.rejects(watchStop(f.config, { invoke, verifyWait: () => {} }), /transport timeout/);
  assert.equal(JSON.parse(readFileSync(join(f.dir, 'watcher-result.json'))).status, 'dispatch-unknown');
  await assert.rejects(watchStop(f.config, { invoke }), /EEXIST/);
  assert.equal(f.calls.filter(x => x[0] === 'send').length, 1);
});

test('standalone watcher checks the real foreground wait PID and calls CLI before expiry', async t => {
  const f = setup(t);
  const bin = join(f.dir, 'bin'); mkdirSync(bin);
  const cli = join(bin, 'paseo');
  writeFileSync(cli, `#!${process.execPath}\nconst a=process.argv.slice(2);\n` +
    `console.log(JSON.stringify(a[0]==='send'?{accepted:true}:{Id:a[1],Status:'running',Cwd:process.env.TEST_WORKSPACE,ParentAgentId:a[1]==='engineer'?'lead':'supervisor',PendingPermissions:[]}));\n`);
  chmodSync(cli, 0o755);
  f.save('config.json', f.config);
  f.save('actor-binding.json', { engineerId: 'engineer', leadId: 'lead' });
  const watcher = fileURLToPath(new URL('../e2e/stop-watcher.mjs', import.meta.url));
  const helper = fileURLToPath(new URL('../e2e/wait-for-stop.mjs', import.meta.url));
  const pending = promisify(execFile)(process.execPath, [watcher, join(f.dir, 'config.json')], {
    env: { ...process.env, PATH: bin, TEST_WORKSPACE: f.config.workspace }, timeout: 15000,
  });
  // Handle an early subprocess failure while checking its startup receipt.
  pending.catch(() => {});
  for (let n = 0; n < 200 && !existsSync(join(f.dir, 'watcher-started.json')); n++) await delay(25);
  assert.ok(existsSync(join(f.dir, 'watcher-started.json')));
  const wait = spawn(process.execPath, [helper, join(f.dir, 'readiness.json'), f.config.token, '10'],
    { cwd: f.config.workspace, stdio: 'ignore' });
  t.after(() => wait.kill());
  const { stdout } = await pending;
  const result = JSON.parse(stdout);
  assert.equal(result.status, 'sent');
  assert.ok(Date.parse(result.sentAt) - Date.parse(result.readiness.readyAt) < 10000);
  assert.equal(result.readiness.pid, wait.pid);
  assert.equal(wait.exitCode, null);
});
