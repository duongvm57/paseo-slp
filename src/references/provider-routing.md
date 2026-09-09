# Provider/model routing and quota handoff

Supervisor/Lead read before every delegation or quota fallback. Three profiles carry
role defaults: slp-supervisor, slp-lead and slp-peer. Lead chooses a task-specific Peer
disposition in the assignment; disposition never creates or selects another profile.

## Select a runtime option

1. Read .paseo-slp/WORKSPACE_PROTOCOL.md in the assigned repository, then run the installed
   bin/slp.mjs routes <absolute-repository-root> command. It reads only that root's
   .paseo-slp/slp-routing.json and returns path, hash, policy and options. Use the same repository
   root in prepare, regardless of the caller's cwd or package installation path.
   A missing file requires repo setup; there is no global or parent-repo fallback.
2. Frame the work and disposition. Read the Human policy and each relevant option's
   suitableFor, avoidFor and notes. Tags describe strengths and trade-offs, not a
   fixed disposition taxonomy or benchmark proof. One option may fit coding and
   review; one Engineer may choose from several providers or reasoning settings.
3. Exclude disabled options, availability other than ready, and roles not containing
   the intended role. Higher priority is a preference among equally suitable options.
   Honor the current assignment and repository budget/independence requirements.
   If no permitted option fits, report the missing choice; do not retry exhausted
   quota, reactivate an option or silently route around the catalog.
4. Discover list_providers, list_models and inspect_provider for the selected option.
   Confirm exact model ID, thinking, mode, features and credentials/capability evidence.
   A Human ready flag is not live quota telemetry. If discovery contradicts the file,
   record the failure and choose another eligible option only under the fallback grant.
5. Record option ID, catalog hash, actual runtime settings and the reason for selection.
   Reread immediately before spawning or fallback. Human edits apply on the next
   selection without reload. Existing sessions retain their runtime and assignment.

Human owns this mutable catalog outside the integrity-bound installation. Editing
it needs an explicit config mandate. Store preferences and quota notes, never secrets.
.paseo-slp/WORKSPACE_PROTOCOL.md owns repo tactics and budget; catalog policy and options operate
within those boundaries. For setup or migration, use the packaged
skills/paseo-slp-onboarding/SKILL.md. `init` creates only the two missing config files
inside `.paseo-slp`; install the onboarding skill separately at project or global scope
so the host can discover and trigger it.
--routing-from imports a catalog only when explicitly requested.
Commit/version these repo files when authorized. New worktrees need the selected
files in their base candidate or an authorized copy; do not route a worktree through
another checkout's mutable catalog. A quota edit affects this repo/worktree copy.
Use separate option IDs for different model/reasoning bundles on the same provider.
An explicit Human launch setting overrides a preference, but conflicting availability
requires a Human decision. Profile defaults apply only for explicitly requested profile
launches or explicit Human settings when the catalog is empty; no automatic bypass.

Installed persistent policy providers are slp-codex-{role} and slp-pi-{role}.
For a Peer, both slp-codex-peer and slp-pi-peer load the same common/Peer policy.
Codex app-server gets developer instructions; Pi gets --append-system-prompt at
every process launch/resume, preserving Paseo's extension/MCP arguments. Retain
profile features and modes only when valid for the target provider/model.

Human may edit any of the three installed profiles' provider/model/thinking in
Paseo Settings. Keep its ID and select a matching role provider. Changing a saved
profile affects future sessions, not existing agents. When no model is selected,
discover list_models for that provider and choose within the assigned protocol.
Pi model IDs may include endpoint/provider prefixes and slashes; preserve the exact
discovered ID. Do not assume that all entries in a catalog have usable credentials.

For an explicit provider override, discover the target provider's models, thinking
options, features and modes. Select a target model explicitly; never carry an old
provider's model/mode/feature bundle across providers by accident. Same-provider
model/thinking updates can use Paseo update_agent when available and authorized;
select target-supported settings rather than transplanting effort labels blindly.

## Launch and offline preparation

Use agent-scoped Paseo create_agent with the selected provider/model and option
settings as described in delegation.md. Installed wrappers supply role bytes so the
initial prompt carries the neutral assignment/disposition. Record the selected
option ID, catalog hash and actual launch settings in the owner map.

For offline preparation, bin/slp.mjs prepare accepts role, disposition, repository,
workspaceId, assignment, providers and route.optionId/catalogSha256.
prepare reads repository/.paseo-slp/slp-routing.json, checks the hash, role and
availability, and emits a complete binding without inheriting profile settings.
It rejects inline overrides mixed with an option; choose a different option instead.
route.catalogFile is rejected so requests cannot redirect routing to a global file.
This check covers preparation time, not a host-enforced lock through create_agent.

Explicit Human launches can instead use binding or profiles/providers/route inventories.
route.profileId overrides the role default, independently of disposition;
route.model/thinkingOptionId/modeId/features are explicit overrides.
A cross-provider route.provider also requires route.model;
unspecified settings from the old provider are dropped. Null mode/thinking clears
that setting. Stock codex/pi launches use a role envelope in the prepared prompt;
prefer installed role providers for policy independent of ordinary task text.

## Provider quota failure or requested switch

Treat quota errors as evidence, not permission to switch providers or add cost.
An explicit Human switch request or standing fallback policy supplies that authority.
If no such grant exists, present the available target and missing decision. Never
retry an unchanged quota failure in a loop.

For a Lead switch:

1. The assigned Supervisor or Human pauses the old Lead and verifies settlement
   through Paseo. Record current writer ownership and wake sources. A quota failure
   alone does not prove its descendants stopped. Cancel owned activity as authorized;
   retain the old session and its evidence. If the Lead cannot answer, reconstruct
   state from timeline, artifacts and prior reports; label unknowns rather than
   spending unavailable quota trying to obtain a new summary.
2. Collect the authorized objective/scope, technical decisions, alternatives,
   candidate identity, actual proof/findings, unfinished dependencies, Peer IDs and
   workspace/resource/heartbeat ownership. Read governance.md for recovery boundaries.
3. Select the target profile or explicit provider/model with fresh discovery. Either
   compose this handoff into the new assignment or use bin/slp.mjs prepare-handoff
   with the ordinary prepare fields plus handoff.previousAgentId, reason, authority,
   state, previousOwner:{settled:true,evidence:<receipt/reference>} and resources:[]
   (populate all remaining resources). The helper freezes the current work snapshot
   and emits create_agent arguments; it does not cancel, launch or prove host state.
4. Verify settlement remains current, then create a fresh Lead using Paseo in the
   intended workspace. Do not pass a Codex session file to Pi or pretend provider
   identity changed in place. New Lead checks evidence and acknowledges ownership
   before any continuation. Update the owner map and reporting routes.
5. Existing Peer parentage remains with the old Lead. Discover whether the new Lead
   can message/control those agents. Where it cannot, the Human/Supervisor retains
   coordination or explicitly settles and hands off their work before replacements.
   Preserve one writer per scope. Unknown heartbeat/control access remains visible.

To switch Supervisor, Human performs the same transfer while preserving each Lead's
technical ownership. For Peer replacement, Lead transfers only that bounded scope;
the Peer receives handoff facts and does not load orchestration procedures.
