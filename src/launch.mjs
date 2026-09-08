import { readFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { resolveProfile } from './profiles.mjs';
import { verifyInstall } from './package.mjs';

export function bindingCheck(binding) {
  if (!binding || typeof binding.provider !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(binding.provider)) throw new Error('Provider required');
  if (typeof binding.modeId !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(binding.modeId)) throw new Error('Mode required');
  if (typeof binding.model !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(binding.model)) throw new Error('Explicit model required');
  if (binding.thinkingOptionId !== undefined && !/^[a-zA-Z0-9._-]+$/.test(binding.thinkingOptionId)) throw new Error('Invalid thinking option');
}
export function prompt(root, role, assignment, binding) {
  bindingCheck(binding);
  return `${roleInstructions(root, role)}\nLaunch binding: ${JSON.stringify(binding)}\nAssignment:\n${assignment}\n`;
}
export function roleInstructions(root, role) {
  if (!['supervisor', 'lead', 'peer'].includes(role)) throw new Error('Unknown role');
  const read = path => readFileSync(join(root, 'src', path), 'utf8');
  const commandPath = "'" + join(root, 'bin/slp.mjs').replaceAll("'", "'\\''") + "'";
  return `SLP role=${role}\n${read('common.md')}\n${read(`roles/${role}.md`)}\n` +
    (role === 'peer' ? '' : read('delegation.md') + '\n') +
    `Installed policy directory: ${join(root, 'src')}\nSnapshot command: node ${commandPath} snapshot <repository>\n` +
    `The current Human message is the assignment; use the current Paseo workspace.\n`;
}
export function launchPlan(root, request) {
  verifyInstall(root);
  const role = request.role ?? 'supervisor';
  if (request.profiles) request = { ...request, binding: resolveProfile(role, request.profiles, request.providers, request.route) };
  if (!['codex', `slp-codex-${role}`].includes(request.binding?.provider)) throw new Error('Live candidate supports stock codex or the matching SLP Codex role only; Pi is not yet verified');
  for (const key of ['workspaceId', 'repository', 'assignment']) {
    if (typeof request[key] !== 'string' || !request[key].trim()) throw new Error(`Missing ${key}`);
  }
  if (!isAbsolute(request.repository)) throw new Error('Absolute repository required');
  const initialPrompt = prompt(root, role, `Repository: ${request.repository}\nWorkspace ID: ${request.workspaceId}\n${request.assignment}`, request.binding);
  return {
    transport: 'Paseo create_agent; settings.features must be preserved',
    role, instructionPath: join(root, `src/roles/${role}.md`),
    create: { title: `SLP ${role}`, notifyOnFinish: true, provider: `${request.binding.provider}/${request.binding.model}`,
      workspaceId: request.workspaceId, initialPrompt,
      settings: { modeId: request.binding.modeId, ...(request.binding.thinkingOptionId ? { thinkingOptionId: request.binding.thinkingOptionId } : {}), features: request.binding.features ?? {} } },
  };
}
