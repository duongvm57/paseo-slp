# Provider/model routing and quota handoff

Supervisor/Lead read before every delegation or quota fallback. Supervisor and
Lead have saved Paseo profiles; Peer has a project runtime pool. The three roles
are behavior contracts, not a requirement for three saved profiles.

## Supervisor and Lead

Read the repository protocol for authority/tactics/budget. Refresh list_profiles
and select slp-supervisor or slp-lead. Verify the matching installed role provider,
exact model and optional mode/thinking/features with live provider discovery.
Copy the complete saved bundle. Missing settings require Human configuration;
never silently replace these choices with catalog options. Changes affect future
launches, not existing sessions.

## Peer pool (default)

Read the assigned repository's .paseo-slp/slp-routing.json with
`node <installed>/bin/slp.mjs routes <absolute-repository>` before each delegation.
Each option contains an id, provider family (pi/codex), model, optional modeId,
thinkingOptionId/features, roles, enabled, availability, priority, suitableFor,
avoidFor and notes. Human/onboarding establishes the pool and suitability under
project setup authority; Lead chooses within it for each task and budget.

Choose an enabled, ready option with peer in roles. Explain suitability using the
assignment and option descriptions; Engineer/Architect/Reviewer are dispositions,
not fixed model mappings. Two Peers may use different models or providers while
receiving the same Peer policy. Supervisor/Lead profiles need not match their family.

Validate the exact model/settings against live provider capabilities. Refresh the
catalog hash and use prepare with role=peer and route.optionId/catalogSha256 before
calling Paseo create_agent. The selected pi/codex option maps to slp-pi-peer or
slp-codex-peer, whose installed wrapper supplies common/Peer instructions.
Record the option, hash, suitability reason, create arguments and actual settings.

No slp-peer saved profile is installed or required. Profile inventories may accompany
prepare discovery but cannot override the selected Peer option. Missing/empty pool,
no eligible option, stale hash or unavailable runtime blocks only the dependent
Peer delegation: use paseo-slp-onboarding to complete project setup. Do not fall
back to host/global/another repository's catalog, a saved Peer profile or inherited
Lead settings. Unknown availability is not permission to launch.

## Peer quota fallback

The catalog's quotaFallback is { enabled: boolean, optionIds: [pool option IDs] }.
Absent or disabled means stop the quota-blocked branch. Enabled authorizes Lead to
choose a suitable target only from that list and the current project pool, within
assignment budget. The list is an allowlist, not a command to try every option.

On a real quota error, record the source option, failed operation and provider error.
Refresh routes and live capabilities. Select a different enabled/ready Peer option
allowed by quotaFallback; reject any target whose runtime/account is known to share
the exhausted quota. A different model on the same provider is not proof of fresh quota.
Use prepare with route.optionId, route.catalogSha256 and route.quotaFallbackFrom
(the failed option ID). Missing authorization, no viable target or a repeated quota
error ends this fallback attempt; report the blocked branch without a retry loop.
Catalog status is configuration, not proof of live quota or recovery.

Use the validated complete bundle for every create, resume or settings change.
Never override a pool model with a provider default or discovery result, or use an
explicit binding to bypass the pool. For same-provider continuation, verify current
ownership and apply the complete target settings before resuming; if absent settings
cannot be cleared through the host, use a fresh session after settlement instead.
For a provider change, settle the old owner and use prepare-handoff with the same
route fields and handoff evidence before creating a fresh Peer. Keep the failed
session/evidence; enforce task topology and one writer. Fallback authority does not
waive ownership, independent-review requirements or authorize new pool entries.

## Preparation and role loading

Supervisor/Lead prepare requests use fresh profiles/providers, role, repository,
workspaceId and assignment. Peer requests use the same task fields and providers,
plus route.optionId/catalogSha256. Preparation reads only the assigned repository
pool and emits arguments; it never creates an agent or chooses the option for Lead.
Pass the array returned by live list_providers as request.providers, extracting
it from the tool response envelope when necessary. Each entry carries the observed
id, enabled and status (and extends when present). A missing inventory is a request
construction error: supply the discovery already obtained and rerun preparation;
it is not a reason to change the selected model or read package implementation.
Use taskLabel for a short Human-readable work label and disposition for the Peer
seat. prepare renders the naming convention from delegation.md; omitted taskLabel
uses the repository directory name, and omitted Peer disposition displays General.
Catalog hash validation is not atomic with host creation; record actual launches.

Installed providers are slp-codex-{role} and slp-pi-{role}. Both Peer wrappers load
the same policy. Codex receives developer instructions; Pi uses
--append-system-prompt while preserving host extensions/MCP arguments. Pi model IDs
may contain endpoint prefixes and slashes; preserve the exact discovered ID.

Explicit bindings are for separately authorized Supervisor/Lead experiments. Peer quota
recovery always uses the project pool and its quotaFallback configuration.
Historical profile/catalog experiments do not establish the current default path.

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
