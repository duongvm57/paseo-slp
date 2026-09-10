Delegation procedure (Supervisor and Lead only):

Read references/provider-routing.md before every delegation or quota fallback.

1. Resolve project/task identity, repository root, authority and existing ownership.
   Inspect Paseo reachability, list_workspaces and relevant list_agents, plus Git
   changes in the target checkout. Establish baseline resources to preserve. Read
   list_profiles and profile notes. Select slp-supervisor, slp-lead or slp-peer for
   the child's role; disposition belongs to the assignment. Read this repository's
   .paseo-slp/WORKSPACE_PROTOCOL.md for tactics and budget. Runtime provider, model,
   mode, thinking and features come from the saved Human-configured agent profile.
   Discover the selected provider's availability and supported models/settings.
   Missing, incompatible or over-budget settings require a Human profile decision;
   report the exact profile and mismatch. A task request for Pi or Codex does not
   authorize rewriting profiles or substituting catalog settings.
   Before parallel writers, use references/orchestration.md for isolation and
   integration ownership. Complete preflight with an owner map and available route,
   or report the exact missing prerequisite for the dependent branch.
2. Refresh list_profiles immediately before creation and use the selected profile's
   complete bundle. Set create_agent.provider to its role provider ID, followed by
   `/` and its exact model ID, preserving any slashes within the model ID. Copy
   modeId, thinkingOptionId and featureValues to settings.modeId,
   settings.thinkingOptionId and settings.features, omitting absent settings.
   Record the selected profile ID and exact profile bytes with the launch arguments.
   Use agent-scoped Paseo create_agent; it has no profile parameter.
   Pass the actual workspaceId, title and notifyOnFinish=true.
   initialPrompt contains the neutral assignment: project/task identifiers,
   repository/workspace, role/disposition, objective or open question, owned/excluded
   scope, read/write mode, separate authority grants, known constraints/dependencies,
   verification, your own agent ID as the report recipient, and handback. For
   review include the exact candidate; for sealed design include the report
   visibility boundary. A Peer receives only relevant repository tactics and may
   propose a different solution.
   The provider supplies common/role instructions; do not paste them each time.
3. Record the returned agent/workspace IDs, assignment and ownership in your timeline.
   Paseo owns parentage. Use fresh sessions for independent judgment; CLI run,
   native subagents and context forks are not delegation substitutes.
4. Use references/monitoring.md to arrange event-driven waits, material reporting
   from Lead to Supervisor, and a heartbeat safety net when needed. On a
   finish/error/permission notification, read get_agent_status and
   get_agent_activity. If the full report is absent, inspect the host timeline
   through Paseo; report a visibility blocker if still unavailable. Follow-ups
   use send_agent_prompt to the existing child, with background=true and
   notifyOnFinish=true for asynchronous corrections. Idle is not acceptance.

If SLP profiles/providers are unavailable, report the missing setup.
The installed bin/slp.mjs prepare command remains an explicit offline fallback
for a Human-authorized stock Codex/Pi launch: it renders installed role bytes plus
assignment into create_agent arguments, without starting an agent. Never silently
route through a legacy role provider or imply that its title loads this policy.
