#!/usr/bin/env node
import { runRoleProcess } from '../src/role-process.mjs';
import { fileURLToPath } from 'node:url';
import { roleInstructions } from '../src/role-bundle.mjs';
import { verifyInstall } from '../src/package.mjs';
import { injectRole } from '../src/role-transport.mjs';

const [role, ...args] = process.argv.slice(2);
const root = fileURLToPath(new URL('..', import.meta.url));
try {
  verifyInstall(root);
  const instruction = roleInstructions(root, role);
  const protocol = args.includes('app-server') && !args.includes('--help') && !args.includes('--version');
  await runRoleProcess(process.env.SLP_CODEX_BIN || 'codex', args, {
    protocol, transform: message => injectRole(message, instruction),
  });
} catch (error) { console.error(error.message); process.exitCode = 1; }
