#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { roleInstructions } from '../src/role-bundle.mjs';
import { verifyInstall } from '../src/package.mjs';
import { claudeRolePrompt } from '../src/role-transport.mjs';

const [role, ...args] = process.argv.slice(2);
const root = fileURLToPath(new URL('..', import.meta.url));
try {
  verifyInstall(root);
  const instruction = roleInstructions(root, role);
  // The Agent SDK speaks NDJSON only in stream-json mode; every other
  // invocation (--version, auth, interactive) is a plain passthrough.
  // SDK 0.3.246 emits '--flag value' pairs; the '--flag=value' form is matched
  // too. If the SDK drifts to a third arg style, detection degrades silently to
  // passthrough and the role policy is lost — update this contract when bumping.
  const flag = (name, value) => args.some((arg, index) =>
    arg === `${name}=${value}` || (arg === name && args[index + 1] === value));
  const protocol = flag('--input-format', 'stream-json') && flag('--output-format', 'stream-json');
  const child = spawn(process.env.SLP_CLAUDE_BIN || 'claude', args, {
    stdio: protocol ? ['pipe', 'pipe', 'inherit'] : 'inherit',
  });
  const fail = error => { console.error(`SLP: ${error.message}`); process.exitCode = 1; child.kill(); process.stdin.destroy(); };
  child.on('error', fail);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => child.kill(signal));
  child.on('exit', (code, signal) => {
    process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 143);
    process.stdin.destroy();
  });
  if (protocol) {
    child.stdout.pipe(process.stdout);
    child.stdin.on('error', fail);
    const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        const next = claudeRolePrompt(message, instruction);
        const output = (next === message ? line : JSON.stringify(next)) + '\n';
        if (!child.stdin.write(output)) await once(child.stdin, 'drain');
      }
      child.stdin.end();
    } catch (error) { fail(error); }
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
