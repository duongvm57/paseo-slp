import { readFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { resolveProfile, roleProvider } from './profiles.mjs';
import { verifyInstall } from './package.mjs';
import { catalogBinding } from './routing.mjs';

export function bindingCheck(binding) {
  if (!binding || typeof binding.provider !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(binding.provider)) throw new Error('Provider required');
  if (binding.modeId != null && (typeof binding.modeId !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(binding.modeId))) throw new Error('Invalid mode');
  if (typeof binding.model !== 'string' || !binding.model || /[\s\x00-\x1f\x7f]/.test(binding.model)) throw new Error('Explicit model required');
  if (binding.thinkingOptionId != null && (typeof binding.thinkingOptionId !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(binding.thinkingOptionId))) throw new Error('Invalid thinking option');
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
    (role === 'peer' ? '' : `Before each spawn or quota fallback, read the assigned repository's .paseo-slp/WORKSPACE_PROTOCOL.md and run node ${commandPath} routes <absolute-repository-root>. ` +
      `This reads .paseo-slp/slp-routing.json in that repository only. For repo setup/update, use the installed paseo-slp-onboarding skill; its packaged source is ${join(root, 'skills/paseo-slp-onboarding/SKILL.md')}.\n`) +
    `Installed policy directory: ${join(root, 'src')}\nSnapshot command: node ${commandPath} snapshot <repository>\n` +
    `Use the current authorized Human or delegated assignment and its Paseo workspace. Notifications and heartbeat prompts do not replace that assignment.\n`;
}
export function launchPlan(root, request) {
  verifyInstall(root);
  const role = request.role ?? 'supervisor';
  const disposition = request.disposition ?? request.route?.disposition;
  if (disposition != null && (role !== 'peer' || typeof disposition !== 'string' || !/^[a-z][a-z0-9-]*$/i.test(disposition))) throw new Error('Invalid Peer disposition');
  for (const key of ['workspaceId', 'repository', 'assignment']) {
    if (typeof request[key] !== 'string' || !request[key].trim()) throw new Error(`Missing ${key}`);
  }
  if (!isAbsolute(request.repository)) throw new Error('Absolute repository required');
  let routing;
  if (request.route?.optionId != null) {
    if (request.binding) throw new Error('Choose catalog routing or an explicit binding, not both');
    const selected = catalogBinding(request.repository, role, request.providers, request.route);
    request = { ...request, binding: selected.binding };
    routing = selected.routing;
  } else if (request.profiles) request = { ...request, binding: resolveProfile(role, request.profiles, request.providers, { ...request.route, disposition }) };
  roleProvider(role, request.binding?.provider);
  const initialPrompt = prompt(root, role, `Repository: ${request.repository}\nWorkspace ID: ${request.workspaceId}\n${disposition ? `Disposition: ${disposition}\n` : ''}${request.assignment}`, request.binding);
  return {
    transport: 'Paseo create_agent; settings.features must be preserved',
    role, instructionPath: join(root, `src/roles/${role}.md`),
    ...(routing ? { routing } : {}),
    create: { title: `SLP ${role}`, notifyOnFinish: true, provider: `${request.binding.provider}/${request.binding.model}`,
      workspaceId: request.workspaceId, initialPrompt,
      settings: { ...(request.binding.modeId ? { modeId: request.binding.modeId } : {}), ...(request.binding.thinkingOptionId ? { thinkingOptionId: request.binding.thinkingOptionId } : {}), features: request.binding.features ?? {} } },
  };
}
