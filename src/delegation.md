Delegation procedure (Supervisor and Lead only):

Read references/provider-routing.md before every delegation, quota fallback or runtime settings change.
Peer runtime changes remain inside the project pool; quota fallback follows its quotaFallback setting.

Before any delegation tool call, classify the situation — the assignment
decides it, not the convenience of an existing session — and record a short
formation record in an authorized location: task/team, which row applies, the
calling actor, expected parent, target or existing child, pinned
workspace/cwd, report recipient, planned operation and any isolation reason.

| Situation | Correct action | What it never implies |
|---|---|---|
| New-team delegation: the assignment asks this parent to build a new team | Create each new Lead/Peer through the owning parent's agent-scoped create_agent; Lead creates its assigned Peers the same way | A standalone or differently parented seat with a fitting title or model does not become a child by receiving a prompt — never substitute send_agent_prompt for the create |
| Continuation: same team and ownership — a correction, re-review or a new bounded task for a child this team already created and verified | send_agent_prompt to the verified existing child, continuing its session to preserve context; carry any added grant explicitly | A new task does not by itself require a fresh seat or reopen verified parentage; continuity never merges a standalone or other-parent seat into this team |
| Observe-existing-work: the Human assigns observation of a Lead already running | Record the Lead ID, observation scope, an explicit report recipient and expectations; its real parent does not change | A working report route proves no parentage or sidebar hierarchy; observing grants no right to take over its implementation |

A standby Lead already created under this team can receive its concrete task
later by continuation, and a parentless direct Lead the Human assigned remains
a valid standalone workflow — neither becomes this parent's new child without
a matching create or authorized handoff. Continuation reuses the same suitable
child for authorized corrections, re-review and new bounded tasks inside the
ongoing assignment, after verifying its agent ID, owner/parent relation,
scope, availability and independence; it never establishes or changes
parentage.

1. Resolve project/task identity, repository root, authority and existing ownership.
   Inspect Paseo reachability, list_workspaces and relevant list_agents, plus Git
   changes in the target checkout. Establish baseline resources to preserve. Read
   the repository's .paseo-slp/workspace-protocol.md for tactics and budget.
   A worktree target missing .paseo-slp/ — gitignored local state holding absolute
   paths — needs catalog and protocol materialized before route resolution:
   `slp.mjs materialize <target> --from <source>` when the installed copy supports
   it, else copy .paseo-slp/ and rebase absolute paths that point under the
   source root onto the target root.
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
   When the daemon arms Jev routing (jev.capabilities.routing — see
   references/provider-routing.md), the receipt is a required third route field:
   author a routing brief, run `slp route-decide` and pass its decision as
   route.decision alongside optionId/catalogSha256; a decline or transport
   failure blocks the delegation until resolved or the Human disables the
   capability. Under an enabled-but-unarmed daemon (shadow evaluation),
   route-decide still emits a receipt — Lead chooses independently, supplies
   the receipt alongside, and the plan records both picks (routing.jev.
   jevChoice/declined) for agreement measurement; the Human arms the
   capability only after the recorded pairs satisfy pre-registered exit
   criteria. In armed mode the suitability reason trail is the receipt's
   recorded distribution, not the Lead prose above. Jev output is a bounded
   proposal — never delegation authority.
   For any role, discovery can arrive by file: the installed `slp.mjs inventory`
   helper emits {providers, profiles} for the exact daemon home (managed seats
   carry the verified invocation in their runtime helper block) — pass its
   absolute path as request.inventoryFile; an explicit inline array, including
   [], always wins. Managed-runtime inventory providers are labeled provenance
   configured — static config, not live evidence — so pass live list_providers
   output from the same daemon inline as providers instead. An inventory shows
   configuration completeness, never provider health or readiness.
   All catalog settings are complete; do not overlay model/effort/features from
   slp-peer, the Lead or a different option. No saved slp-peer profile is required.
   Map catalog provider pi/codex/devin/claude to slp-pi-peer/slp-codex-peer/slp-devin-peer/slp-claude-peer. Combine the wrapper
   ID with the exact model ID, preserving embedded slashes. Copy modeId,
   thinkingOptionId and features to settings, omitting absent fields; saved
   profiles use featureValues as settings.features. `settings.modeId` resolves
   by precedence: a prepare plan's binding `modeId` (emitted as
   `create.settings.modeId` with top-level `modeId` and `warnings`), then the
   protocol frontmatter `agent_mode` for direct spawns (Human→Supervisor),
   then the copied bundle's own `modeId`. When none is set, ask the Human;
   an agent must never silently inherit the caller's default. Record selected profile ID or
   catalog option ID/hash and exact bundle with the launch arguments.
   Use agent-scoped Paseo create_agent for every seat joining the team —
   Supervisor→Lead and Lead→Peer alike; it has no profile parameter. Only
   agent-scoped creation gives the host the parent link, report route and
   sidebar tree the team relies on: prompting an existing standalone session
   can observe work that session already owns but cannot carry a new
   delegation. Pass the pinned workspaceId, title and notifyOnFinish=true.
   Without an explicit placement override, create the child in the parent's
   workspace — a read-only review seat included. Create another workspace
   only for a declared worktree, repository or independently isolated lane
   requirement, and record the reason and resulting paths: "delegation should
   be isolated" or a tidier sidebar is not such a requirement. Isolation never
   substitutes for parentage, a shared workspace never merges write
   authority, and a second workspace on the same checkout is not filesystem
   isolation. The formation record catches both defects before the tool call:
   planning a new team while the operation is send_agent_prompt to a
   parentless or differently parented seat, or planning a second workspace
   for the same team with no isolation reason — stop and correct the plan
   rather than proceed or reclassify the call as observation.
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
   (including discovered filename hazards and their recovery technique), any
   effort/scope bound (for example, cover the top-N highest-risk references
   first, then breadth), verification, your own agent ID as the report
   recipient, and handback. For
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
   Verify the returned child against host evidence — actual parent and
   workspace/cwd are host-queryable; check them using the full agent ID from
   the creation receipt. The report route is a property of the brief, not
   host-queryable state: confirm it by the child's first report reaching the
   named recipient. A title, a sent prompt or a manually assigned label is
   not evidence of parentage; where the host exposes neither route evidence
   nor parent/workspace metadata, record the visibility gap instead of
   inferring the relationship. If verification finds a wrong relation — a
   missing or mismatched parent or an unexpected workspace — preserve the
   evidence and take the correction to the owning parent or Human; do not
   delete, archive or respawn the seat yourself.
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
   A required review gate defaults to parallel seats on split axes (Spec and
   Standards): a summary like "Engineer → Reviewer" does not license merging
   the axes into one seat, and a task too small to require review is a separate
   judgment from loosening a required gate. Required seats that cannot be
   supplied make the gate BLOCKED, never permission to skip or merge it.
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
