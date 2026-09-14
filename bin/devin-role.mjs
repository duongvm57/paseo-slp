#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { roleInstructions } from '../src/role-bundle.mjs';
import { verifyInstall } from '../src/package.mjs';
import { acpRolePrompt } from '../src/role-transport.mjs';

const [role, ...args] = process.argv.slice(2);
const root = fileURLToPath(new URL('..', import.meta.url));
try {
  verifyInstall(root);
  const instruction = roleInstructions(root, role);
  const command = args.length ? args : ['acp'];
  const protocol = command[0] === 'acp';
  const child = spawn(process.env.SLP_DEVIN_BIN || 'devin', command, {
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
    const seen = new Set();
    const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (!line.trim()) continue;
        const output = JSON.stringify(acpRolePrompt(JSON.parse(line), instruction, seen)) + '\n';
        if (!child.stdin.write(output)) await once(child.stdin, 'drain');
      }
      child.stdin.end();
    } catch (error) { fail(error); }
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
