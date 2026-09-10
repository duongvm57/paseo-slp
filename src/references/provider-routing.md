# Provider/model routing and quota handoff

Supervisor/Lead read before every delegation or quota fallback. Three profiles carry
Human runtime settings: slp-supervisor, slp-lead and slp-peer. Lead chooses a task-specific Peer
disposition in the assignment; disposition never creates or selects another profile.

## Select a saved agent profile

1. Read the assigned repository's .paseo-slp/WORKSPACE_PROTOCOL.md for authority,
   tactics and budget. Read Paseo list_profiles and all relevant notes.
2. Select slp-supervisor, slp-lead or slp-peer for the intended role. The Human
   configures provider, model, thinkingOptionId, modeId and featureValues in
   Paseo Agent profiles. Peer disposition is independent of this selection.
3. Discover list_providers, list_models and inspect_provider for that saved
   provider. Verify its role wrapper, exact model and supported settings. Missing
   or incompatible profile settings block launch with the profile ID and reason;
   ask Human to configure the profile. Discovery validates the saved choice.
4. Refresh list_profiles before each spawn. Materialize its complete bundle as
   described in delegation.md, and record the profile and actual launch arguments.
   Compare the returned agent settings with that bundle; surface mismatches.

Saved profile settings are the runtime source for ordinary delegation. Repository
catalogs do not override them. Changes to Human profiles apply to the next launch;
existing agents retain their current session settings. The optional repository
catalog and offline route helpers remain available for explicitly assigned catalog
experiments or migrations; they are not prerequisites for profile-based tasks.
Changing a profile or using an explicit alternative binding requires Human authority.

Installed persistent policy providers are slp-codex-{role} and slp-pi-{role}.
For a Peer, both slp-codex-peer and slp-pi-peer load the same common/Peer policy.
Codex app-server gets developer instructions; Pi gets --append-system-prompt at
every process launch/resume, preserving Paseo's extension/MCP arguments. Retain
profile features and modes only when valid for the target provider/model.

Human may edit any of the three installed profiles' provider/model/thinking in
Paseo Settings. Keep its ID and select a matching role provider. Changing a saved
profile affects future sessions, not existing agents. When no model is selected,
ask Human to select a discovered model in that profile before launch.
Pi model IDs may include endpoint/provider prefixes and slashes; preserve the exact
discovered ID. Discovery must verify the saved provider is usable.

## Launch and offline preparation

Use agent-scoped Paseo create_agent with the saved role profile as described in
delegation.md. Installed wrappers supply role bytes; the initial prompt carries
the neutral assignment/disposition. Record the exact profile and actual settings.

Optional bin/slp.mjs prepare accepts role, disposition, repository, workspaceId,
assignment, and fresh profiles/providers inventories. With profiles supplied it
uses the saved role profile and rejects inline binding or catalog/runtime overrides.
It needs no repository catalog for this path and returns profileId plus create
arguments. It never creates an agent; the parent still calls Paseo create_agent.

Explicit offline binding and catalog requests remain supported separately for
Human-authorized experiments or handoffs. Catalog requests use route.optionId and
catalogSha256 with providers, without profiles or binding; they read only the
assigned repository's catalog, reject stale hashes and unavailable options, and
cannot stand in for a test of saved profiles. Stock provider offline launches
carry a role envelope in initialPrompt and also require explicit authority.

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
3. Ask Human to configure the target role profile, then refresh profile/provider discovery. Either
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
