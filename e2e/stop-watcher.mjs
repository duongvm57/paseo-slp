// Development-only stimulus runner. No model reasoning sits between readiness
// and dispatch. This checks a tool-wait boundary, not a mid-write interruption.
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';

const execute = promisify(execFile);
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const timestamp = () => new Date().toISOString();
const check = (ok, message) => { if (!ok) throw new Error(message); };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function verifyWait(ready, config) {
  check(Number.isSafeInteger(ready.pid) && ready.pid > 0, 'Invalid wait PID');
  const args = readFileSync(`/proc/${ready.pid}/cmdline`, 'utf8').split('\0');
  check(args.includes(join(config.directory, 'readiness.json')) && args.includes(config.token), 'Wait process does not match this trial');
  check(realpathSync(`/proc/${ready.pid}/cwd`) === realpathSync(config.workspace), 'Wait process belongs to another workspace');
}

export async function watchStop(config, options = {}) {
  check(isAbsolute(config.directory ?? '') && isAbsolute(config.workspace ?? ''), 'Absolute control directory and workspace required');
  check(typeof config.token === 'string' && config.token.length > 0, 'Trial token required');
  check(typeof config.supervisorId === 'string' && config.supervisorId.length > 0, 'Supervisor ID required');
  check(typeof config.prompt === 'string' && config.prompt.trim().length > 0, 'Authorized stop prompt required');
  const deadline = Date.parse(config.deadline);
  check(deadline > Date.now() && deadline - Date.now() <= 3600000, 'Deadline must be within one hour');
  const margin = config.minRemainingMs ?? 30000;
  check(Number.isInteger(margin) && margin >= 1000, 'At least one second of remaining time required');
  const control = name => join(config.directory, name);
  // Exclusive start receipt prevents accidental restart/repeated stop delivery.
  save(control('watcher-started.json'), { status: 'watching', pid: process.pid, startedAt: timestamp(), deadline: config.deadline });
  const invoke = options.invoke ?? (async args => {
    const remaining = deadline - Date.now();
    check(remaining > 0, 'Trial deadline expired');
    const { stdout } = await execute('paseo', [...args, ...(config.host ? ['--host', config.host] : [])],
      { timeout: Math.min(20000, remaining), maxBuffer: 1024 * 1024 });
    return JSON.parse(stdout);
  });
  let dispatched = false;
  let readiness;
  const fresh = () => {
    const start = Date.parse(readiness.readyAt);
    check(readiness.token === config.token, 'Readiness token mismatch');
    check(Number.isInteger(readiness.expiresAfterSeconds) && readiness.expiresAfterSeconds > 0 && readiness.expiresAfterSeconds <= 600, 'Invalid readiness lifetime');
    check(Number.isFinite(start) && start <= Date.now(), 'Invalid readiness timestamp');
    check(Math.min(deadline, start + readiness.expiresAfterSeconds * 1000) - Date.now() >= margin, 'Readiness expired or insufficient delivery window');
  };
  try {
    let binding;
    while (Date.now() < deadline) {
      try {
        binding = read(control('actor-binding.json'));
        readiness = read(control('readiness.json'));
        break;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      await delay(100);
    }
    check(readiness && binding, 'Readiness deadline expired');
    fresh();
    check(typeof binding.engineerId === 'string' && typeof binding.leadId === 'string', 'Exact Engineer/Lead IDs required');
    check(new Set([binding.engineerId, binding.leadId, config.supervisorId]).size === 3, 'Actor IDs must be distinct');
    const inspect = async id => {
      const s = await invoke(['inspect', id, '--json']);
      check(s.Id === id && realpathSync(s.Cwd) === realpathSync(config.workspace), 'Actor/workspace mismatch');
      check(s.Archived !== true && Array.isArray(s.PendingPermissions) && s.PendingPermissions.length === 0, 'Actor unavailable or pending permission');
      return { id: s.Id, status: s.Status, parentAgentId: s.ParentAgentId, cwd: s.Cwd };
    };
    const supervisor = await inspect(config.supervisorId);
    const lead = await inspect(binding.leadId);
    const engineer = await inspect(binding.engineerId);
    check(lead.parentAgentId === supervisor.id && engineer.parentAgentId === lead.id, 'Actor parentage mismatch');
    check(engineer.status === 'running', 'Engineer is no longer running');
    (options.verifyWait ?? verifyWait)(readiness, config);
    const files = {};
    for (const name of ['lines.mjs', 'discount.mjs', 'checkout.mjs', 'human-note.txt']) {
      files[name] = sha256(readFileSync(join(config.workspace, name)));
    }
    fresh();
    const promptFile = control('stop-prompt.txt');
    writeFileSync(promptFile, config.prompt, { flag: 'wx' });
    save(control('dispatch-intent.json'), { at: timestamp(), readiness, supervisor, lead, engineer, files,
      promptSha256: sha256(config.prompt), source: 'paseo inspect plus live wait PID; host receipt/ack still required' });
    fresh();
    dispatched = true;
    const sentAt = timestamp();
    const response = await invoke(['send', supervisor.id, '--prompt-file', promptFile, '--no-wait', '--json']);
    const result = { status: 'sent', sentAt, returnedAt: timestamp(), readiness, response,
      scope: 'CLI returned successfully; owner receipt/propagation and stop outcome require native evidence' };
    save(control('watcher-result.json'), result);
    return result;
  } catch (error) {
    save(control('watcher-result.json'), { status: dispatched ? 'dispatch-unknown' : 'not-sent', at: timestamp(), error: error.message });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await watchStop(read(process.argv[2]));
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  }
}
