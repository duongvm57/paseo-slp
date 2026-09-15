import { join, isAbsolute, basename } from 'node:path';
import { savedProfileBinding, roleProvider, roles } from './profiles.mjs';
import { verifyInstall, snapshot } from './package.mjs';
import { catalogBinding } from './routing.mjs';
import { bindingCheck, dispositionPattern } from './binding.mjs';
import { roleInstructions, orchestrates } from './role-bundle.mjs';

// Every Binding source normalises to { binding, routing? } right here, so nothing
// downstream unwraps a source-specific shape. Order is precedence, highest first.
const bindingSources = [
  {
    name: 'saved profiles',
    selects: request => request.profiles != null,
    resolve: (role, request, route) => ({ binding: savedProfileBinding(role, request.profiles, request.providers, route) }),
  },
  {
    name: 'catalog routing',
    selects: request => request.route?.optionId != null,
    resolve: (role, request, route) => catalogBinding(request.repository, role, request.providers, route, request.paseoHome),
  },
  {
    name: 'an explicit binding',
    selects: request => request.binding != null,
    resolve: (role, request) => ({ binding: request.binding }),
  },
];

export function resolveBinding(role, request, disposition) {
  if (role === 'peer') {
    if (request.binding != null) throw new Error('Peer requires a project pool option; explicit bindings cannot bypass routing');
    // Profile inventory may accompany discovery, but never selects a Peer runtime.
    if (!request.route?.optionId) throw new Error('Peer requires a project routing option; run onboarding and select route.optionId with catalogSha256');
    return catalogBinding(request.repository, role, request.providers, { ...request.route, disposition }, request.paseoHome);
  }
  const source = bindingSources.find(candidate => candidate.selects(request));
  if (!source) throw new Error('Binding source required: saved profiles, catalog routing or an explicit binding');
  if (request.binding != null && source.name !== 'an explicit binding') {
    throw new Error(`Choose ${source.name} or an explicit binding, not both`);
  }
  return source.resolve(role, request, { ...request.route, disposition });
}

export function prompt(root, role, assignment, binding) {
  bindingCheck(binding);
  const instructions = binding.provider === roleProvider(role, binding.provider)
    ? roleInstructions(root, role) : `SLP role=${role}\n`;
  return `${instructions}\nLaunch binding: ${JSON.stringify(binding)}\nAssignment:\n${assignment}\n`;
}

// Provider switching creates a new session; it never mutates provider identity
// or reparents agents. The packet is evidence, gathered before anything is planned.
function handoffPacket(request) {
  const handoff = request.handoff;
  for (const key of ['previousAgentId', 'reason', 'authority', 'state']) {
    if (typeof handoff?.[key] !== 'string' || !handoff[key].trim()) throw new Error(`Missing handoff ${key}`);
  }
  if (handoff.previousOwner?.settled !== true || typeof handoff.previousOwner.evidence !== 'string' || !handoff.previousOwner.evidence.trim()) {
    throw new Error('Handoff requires old-owner settlement evidence; quota failure or idle alone is insufficient');
  }
  if (!Array.isArray(handoff.resources)) throw new Error('Handoff requires a resources list (including remaining Peer IDs and wake owners)');
  const candidate = snapshot(request.repository);
  return { ...handoff, candidate: { head: candidate.head, sha256: candidate.sha256 } };
}

const handoffNotice = (role, packet) => `\nProvider handoff evidence:\n${JSON.stringify(packet, null, 2)}\n` +
  'Before taking ownership, verify the current candidate and old-owner settlement against host/repository evidence. ' +
  'Reconcile existing Peer/workspace/resource ownership with the Human or assigned Supervisor. ' +
  'Parentage has not changed; do not claim control of old descendants or create duplicate writers. ' +
  'Acknowledge the transferred assignment. ' +
  (orchestrates(role) ? 'Use references/provider-routing.md for the handoff procedure.\n' : 'Return bounded findings to Lead; do not manage agents.\n');

function agentTitle(role, disposition, request, packet) {
  const label = request.taskLabel ?? (basename(request.repository) || 'Task');
  if (typeof label !== 'string' || !label.trim() || label.trim().length > 100 || /[\x00-\x1f\x7f]/.test(label)) {
    throw new Error('taskLabel must be a nonempty single-line string of at most 100 characters');
  }
  const display = value => value[0].toUpperCase() + value.slice(1).toLowerCase();
  return [display(role), ...(role === 'peer' ? [display(disposition ?? 'general')] : []),
    label.trim(), ...(packet ? ['Handoff'] : [])].join(' — ');
}

// The single owner of the create_agent argument record. Nothing edits it afterwards.
function plan(root, request, packet) {
  verifyInstall(root);
  const role = request.role ?? 'supervisor';
  if (!roles.includes(role)) throw new Error('Unknown role');
  const disposition = request.disposition ?? request.route?.disposition;
  if (disposition != null && (role !== 'peer' || typeof disposition !== 'string' || !dispositionPattern.test(disposition))) throw new Error('Invalid Peer disposition');
  for (const key of ['workspaceId', 'repository', 'assignment']) {
    if (typeof request[key] !== 'string' || !request[key].trim()) throw new Error(`Missing ${key}`);
  }
  if (!isAbsolute(request.repository)) throw new Error('Absolute repository required');
  const { binding, routing } = resolveBinding(role, request, disposition);
  roleProvider(role, binding?.provider);
  const assignment = `Repository: ${request.repository}\nWorkspace ID: ${request.workspaceId}\n${disposition ? `Disposition: ${disposition}\n` : ''}${request.assignment}`;
  return {
    transport: 'Paseo create_agent; settings.features must be preserved',
    role, instructionPath: join(root, `src/roles/${role}.md`),
    ...(routing ? { routing } : {}),
    ...(binding?.profileId ? { profileId: binding.profileId } : {}),
    create: {
      title: agentTitle(role, disposition, request, packet),
      notifyOnFinish: true,
      provider: `${binding.provider}/${binding.model}`,
      workspaceId: request.workspaceId,
      initialPrompt: prompt(root, role, assignment, binding) + (packet ? handoffNotice(role, packet) : ''),
      settings: {
        ...(binding.modeId ? { modeId: binding.modeId } : {}),
        ...(binding.thinkingOptionId ? { thinkingOptionId: binding.thinkingOptionId } : {}),
        features: binding.features ?? {},
      },
    },
    ...(packet ? { handoff: packet, activation: 'Paseo create_agent after current settlement verification; no agent started by this command' } : {}),
  };
}

export const launchPlan = (root, request) => plan(root, request, null);
export const handoffPlan = (root, request) => plan(root, request, handoffPacket(request));
