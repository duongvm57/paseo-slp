Delegation procedure (Supervisor and Lead only):

Read references/provider-routing.md before every delegation, quota fallback or runtime settings change.
Peer runtime changes remain inside the project pool; quota fallback follows its quotaFallback setting.

1. Resolve project/task identity, repository root, authority and existing ownership.
   Inspect Paseo reachability, list_workspaces and relevant list_agents, plus Git
   changes in the target checkout. Establish baseline resources to preserve. Read
   the repository's .paseo-slp/WORKSPACE_PROTOCOL.md for tactics and budget.
   Supervisor/Lead runtime settings come from slp-supervisor/slp-lead saved profiles.
   Peer runtime settings come from this repository's .paseo-slp/slp-routing.json,
   or the user-scope catalog ($PASEO_HOME/slp-routing.json, default ~/.paseo) when
   the repository has none.
   Disposition belongs to the assignment, not a fixed profile or option mapping.
   Discover provider availability and exact model/settings for the selected bundle.
   Missing setup goes through paseo-slp-onboarding; never invent a model or read
   another repository's pool as fallback.
   Before parallel writers, use references/orchestration.md for isolation and
   integration ownership. Complete preflight with an owner map and available route,
   or report the exact missing prerequisite for the dependent branch.
2. Before creating Supervisor/Lead, refresh list_profiles and copy the selected
   role profile's complete bundle. Before creating a Peer, read routes for the
   assigned repository, choose an enabled ready option eligible for peer using
   suitableFor, avoidFor, notes, priority and the task budget. Record why it fits;
   priority alone does not select a model. Refresh the catalog hash before launch.
   Use prepare with role=peer, route.optionId, route.catalogSha256, repository,
   workspaceId, assignment and fresh providers to validate the selection and obtain
   create arguments. Profile inventory never overrides a Peer pool selection.
   All catalog settings are complete; do not overlay model/effort/features from
   slp-peer, the Lead or a different option. No saved slp-peer profile is required.
   Map catalog provider pi/codex/devin to slp-pi-peer/slp-codex-peer/slp-devin-peer. Combine the wrapper
   ID with the exact model ID, preserving embedded slashes. Copy modeId,
   thinkingOptionId and features to settings, omitting absent fields; saved
   profiles use featureValues as settings.features. Record selected profile ID or
   catalog option ID/hash and exact bundle with the launch arguments.
   Use agent-scoped Paseo create_agent; it has no profile parameter.
   Pass the actual workspaceId, title and notifyOnFinish=true.
   Use titles `Supervisor — <task>`, `Lead — <task>` and
   `Peer — <Disposition> — <task>`; for example Engineer and Reviewer Peers
   share the task label but have distinct dispositions. Pass taskLabel and the
   Peer disposition to prepare and preserve its returned title. For multiple
   seats with the same disposition, qualify taskLabel with their bounded scope
   or seat (for example `checkout totals / API review`). Resume keeps the name;
   prepare-handoff adds `Handoff` for a new session. Titles aid Human navigation;
   record actual agent IDs for ownership and report routing.
   initialPrompt contains the neutral assignment: project/task identifiers,
   repository/workspace, role/disposition, objective or open question, owned/excluded
   scope, read/write mode, separate authority grants, known constraints/dependencies
   (including discovered filename hazards and their recovery technique), the
   protocol's communication language for reports and handbacks, any effort/scope
   bound (for example, cover the top-N highest-risk references first, then
   breadth), verification, your own agent ID as the report recipient, and handback. For
   review include the exact candidate; for sealed design include the report
   visibility boundary. A Peer receives only relevant repository tactics and may
   propose a different solution.
   The provider supplies common/role instructions; do not paste them each time.
   For phased work, state the child's current authority and completion condition
   separately from the eventual project outcome. Pass required prerequisites
   intact. A later write grant is a separate assignment after its conditions are
   verified; describing the eventual repair does not grant those writes now.
   A standby Lead — requested before its task is concrete — gets a bounded
   read-only assignment: orient on the repository and protocol, acknowledge
   ownership and handback conditions, then await the task; the acknowledgment is
   its completion condition. The later task and write grant arrive as a separate
   assignment. For an N-peer fan-out, write one brief file per seat under a
   non-deliverable scratch path (for example .local-checks/), pass a short
   assignment plus assignmentFile=<absolute path> to prepare and keep briefs one
   per seat; the emitted prompt references the seat's brief file instead of
   inlining it.
3. Record the returned agent/workspace IDs, assignment and ownership in your timeline.
   If create_agent is aborted, times out or loses its response, its outcome is
   unknown: the child may still start. Keep that scope reserved to the pending
   creation. Reconcile the request with host events and child inventory; an empty
   list_agents result alone does not prove the request had no side effect.
   Adopt a matching child when identified. Create a replacement only after the
   host confirms the original request cannot still create a child and any existing
   owner is settled. If the host cannot resolve that uncertainty, report this
   delegation blocked and continue only unrelated scopes; do not retry the create.
   Paseo owns parentage. Establish independent judgment in a session separate from
   the implementer and the Lead's reasoning; follow references/orchestration.md
   for reuse of an existing independent Reviewer. CLI run, native subagents and
   context forks are not delegation substitutes.
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
