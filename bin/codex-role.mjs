#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { roleInstructions } from '../src/launch.mjs';
import { verifyInstall } from '../src/package.mjs';
import { injectRole } from '../src/role-transport.mjs';

const [role, ...args] = process.argv.slice(2);
const root = fileURLToPath(new URL('..', import.meta.url));
try {
  verifyInstall(root);
  const instruction = roleInstructions(root, role);
  const protocol = args.includes('app-server') && !args.includes('--help') && !args.includes('--version');
  const child = spawn(process.env.SLP_CODEX_BIN || 'codex', args, {
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
        const output = JSON.stringify(injectRole(JSON.parse(line), instruction)) + '\n';
        if (!child.stdin.write(output)) await once(child.stdin, 'drain');
      }
      child.stdin.end();
    } catch (error) { fail(error); }
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
