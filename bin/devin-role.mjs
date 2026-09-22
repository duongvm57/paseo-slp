#!/usr/bin/env node
import { runRoleProcess } from '../src/role-process.mjs';
import { fileURLToPath } from 'node:url';
import { roleDelivery } from '../src/role-bundle.mjs';
import { verifyInstall } from '../src/package.mjs';
import { acpRolePrompt } from '../src/role-transport.mjs';

const [role, ...args] = process.argv.slice(2);
const root = fileURLToPath(new URL('..', import.meta.url));
try {
  verifyInstall(root);
  const delivery = roleDelivery(root, role);
  const command = args.length ? args : ['acp'];
  const protocol = command[0] === 'acp';
  const seen = new Set();
  await runRoleProcess(process.env.SLP_DEVIN_BIN || 'devin', command, {
    protocol, transform: message => acpRolePrompt(message, delivery, seen),
  });
} catch (error) { console.error(error.message); process.exitCode = 1; }
