import { launchPlan } from './launch.mjs';
import { snapshot } from './package.mjs';

// Prepare a new Paseo session, never mutate provider identity or reparent agents.
export function handoffPlan(root, request) {
  const handoff = request.handoff;
  for (const key of ['previousAgentId', 'reason', 'authority', 'state']) {
    if (typeof handoff?.[key] !== 'string' || !handoff[key].trim()) throw new Error(`Missing handoff ${key}`);
  }
  if (handoff.previousOwner?.settled !== true || typeof handoff.previousOwner.evidence !== 'string' || !handoff.previousOwner.evidence.trim()) {
    throw new Error('Handoff requires old-owner settlement evidence; quota failure or idle alone is insufficient');
  }
  if (!Array.isArray(handoff.resources)) throw new Error('Handoff requires a resources list (including remaining Peer IDs and wake owners)');
  const candidate = snapshot(request.repository);
  const plan = launchPlan(root, request);
  const packet = { ...handoff, candidate: { head: candidate.head, sha256: candidate.sha256 } };
  plan.create.title = `SLP ${plan.role} handoff`;
  plan.create.initialPrompt += `\nProvider handoff evidence:\n${JSON.stringify(packet, null, 2)}\n` +
    'Before taking ownership, verify the current candidate and old-owner settlement against host/repository evidence. ' +
    'Reconcile existing Peer/workspace/resource ownership with the Human or assigned Supervisor. ' +
    'Parentage has not changed; do not claim control of old descendants or create duplicate writers. ' +
    'Acknowledge the transferred assignment. ' +
    (plan.role === 'peer' ? 'Return bounded findings to Lead; do not manage agents.\n' : 'Use references/provider-routing.md for the handoff procedure.\n');
  return { ...plan, handoff: packet, activation: 'Paseo create_agent after current settlement verification; no agent started by this command' };
}
