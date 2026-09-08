Delegation procedure (Supervisor and Lead only):

1. Read Paseo list_profiles and the profile notes. Supervisor selects
   slp-lead; Lead selects slp-peer. These installed providers load the
   role automatically. Preserve provider/model, modeId, thinkingOptionId and
   featureValues. For missing settings, discover the provider's available defaults
   rather than guessing model IDs or overriding permissions. Inspect the actual
   workspace and existing ownership before assigning a writer.
2. Create the child through agent-scoped Paseo create_agent. Materialize the
   profile: provider/model (discover a model first when unset), settings.modeId,
   settings.thinkingOptionId and settings.features from featureValues, omitting
   absent settings. Pass the actual workspaceId, title and notifyOnFinish=true.
   initialPrompt contains only the neutral assignment: repository/workspace,
   objective, owned/excluded scope, separate authority grants, known constraints,
   verification and handback. A Peer receives only relevant repository tactics.
   The provider supplies common/role instructions; do not paste them each time.
3. Record the returned agent/workspace IDs and assignment in your timeline.
   Paseo owns parentage. Use fresh sessions for independent judgment; CLI run,
   native subagents and context forks are not delegation substitutes.
4. On finish/error/permission notification, read get_agent_status and
   get_agent_activity. If the full report is absent, inspect the host timeline
   through Paseo; report a visibility blocker if still unavailable. Follow-ups
   use send_agent_prompt to the existing child. Idle is not acceptance.

If SLP profiles/providers are unavailable, report the missing setup.
The installed bin/slp.mjs prepare command remains an explicit offline fallback
for a Human-authorized stock Codex launch: it renders installed role bytes plus
assignment into create_agent arguments, without starting an agent. Never silently
route through a legacy role provider or imply that its title loads this policy.
