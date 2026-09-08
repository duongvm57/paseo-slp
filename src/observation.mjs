// CLI 0.7.2 inspect JSON uses these capitalized fields. Unknowns stay unknown.
export function descendants(rootId, snapshots) {
  const ids = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const agent of snapshots) {
      if (ids.has(agent.ParentAgentId) && !ids.has(agent.Id)) {
        ids.add(agent.Id); changed = true;
      }
    }
  }
  return snapshots.filter(agent => ids.has(agent.Id));
}
export function observationEnd(agents, deadlineReached) {
  if (agents.some(a => a.PendingPermissions?.length)) return 'BLOCKED_PERMISSION';
  if (agents.some(a => a.Status === 'error' || a.Status === 'closed' || a.Archived)) return 'BLOCKED_AGENT';
  if (deadlineReached) return 'DEADLINE';
  // Even all-idle never proves an end-to-end outcome or that callbacks have settled.
  return null;
}
export function report(reason, agents) {
  return { observation: reason, review: 'NOT_RUN', outcomeCheck: 'NOT_RUN',
    instructionEvidence: 'REQUIRES_REVIEW', resourceSettlement: 'UNVERIFIED',
    agents: agents.map(a => ({ id: a.Id, parentAgentId: a.ParentAgentId,
      status: a.Status, provider: a.Provider, mode: a.Mode, cwd: a.Cwd })),
    note: 'Observation ended; agents were not cancelled. No acceptance verdict inferred.' };
}

export function instructionEvidence(rootId, agents, transcripts, roleBytes) {
  return agents.map(agent => ({
    agentId: agent.Id,
    configuredRole: agent.Id === rootId ? 'supervisor' : null,
    configurationSource: agent.Id === rootId ? 'frozen.json:plan.create' : 'parent create_agent arguments required',
    completeRoleTextSeen: Object.entries(roleBytes).filter(([, bytes]) =>
      transcripts[agent.Id]?.includes(bytes)).map(([role]) => role),
    verdict: 'UNVERIFIED',
    reason: 'Curated text may omit or quote instructions; review the actual initial input and parent launch arguments, never a self-declared label.',
  }));
}
