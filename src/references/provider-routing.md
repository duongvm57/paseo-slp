# Provider/model routing and quota handoff

Supervisor/Lead consult before delegation or quota fallback under the common
core's policy-text freshness rule. Supervisor and
Lead have saved Paseo profiles; Peer has a project runtime pool. The three roles
are behavior contracts, not a requirement for three saved profiles.

## Supervisor and Lead

Read the repository protocol for authority/tactics/budget. Refresh list_profiles
and select slp-supervisor or slp-lead. Verify the matching installed role provider,
exact model and optional mode/thinking/features with live provider discovery.
Copy the complete saved bundle. Missing settings require Human configuration;
never silently replace these choices with catalog options. A pool option can
still serve Supervisor/Lead when the Human tags that role in option.roles —
that is a declared choice, not an agent substitution. Changes affect future
launches, not existing sessions.

## Peer pool (default)

Read the assigned repository's .paseo-slp/slp-routing.json with
`node <installed>/bin/slp.mjs routes <absolute-repository>` before each delegation.
Resolution is skill-style: the repository catalog wins when present; when the
repository has no catalog, routes resolves the plugin-owned user-scope pool
($PASEO_HOME/slp-runtime/state/peer-pool.json, default ~/.paseo) and reports
scope/path. The Manager's Peer pool card is that file's sole writer — its
model/mode/thinking values come from the live provider catalog, so a seat
cannot name a mode the provider never offered.
Each option contains an id, provider family (pi/codex/devin/claude), model, optional modeId,
thinkingOptionId/features, roles, enabled, availability, suitableFor,
avoidFor and notes. The 12 archetype ids are reserved standard-seat names:
on them suitableFor/avoidFor are the package's closed `axis:value` token set
(read-only in the Manager — docs/spec/routing-criteria.md), and a reserved id
with divergent tokens is a Token conflict that cannot be routed or saved until
resolved; every other id is a custom seat with free strings.
Human/onboarding establishes the pool and suitability under
project setup authority; Lead chooses within it for each task and budget.

Choose an enabled, ready option with peer in roles. Explain suitability using the
assignment and the option's suitability tokens; Engineer/Architect/Reviewer are dispositions,
not fixed model mappings. Two Peers may use different models or providers while
receiving the same Peer policy. Supervisor/Lead profiles need not match their family.

Validate the exact model/settings against live provider capabilities. Refresh the
catalog hash and use prepare with role=peer and route.optionId/catalogSha256 before
calling Paseo create_agent. The selected pi/codex/devin/claude option maps to
slp-pi-peer, slp-codex-peer, slp-devin-peer or slp-claude-peer, whose installed
wrapper supplies common/Peer instructions.
Record the option, hash, suitability reason, create arguments and actual settings.

No slp-peer saved profile is installed or required. Profile inventories may accompany
prepare discovery but cannot override the selected Peer option. No catalog in
either scope, an empty or ineligible pool, stale hash or unavailable runtime
blocks only the dependent Peer delegation: use paseo-slp-onboarding to complete
setup. The user-scope catalog is the only declared fallback — never substitute
another repository's catalog, a saved Peer profile or inherited Lead settings.
An empty repository catalog remains authoritative and disables the fallback.
Unknown availability is not permission to launch.

## Jev-assisted routing (opt-in, per-daemon)

Jev is a bounded decision primitive, not an agent: it answers one typed choice
question over a caller-supplied state and returns a calibrated answer. It is
served through one of two provider kinds: `openrouter` — OpenRouter's
Decisions API at `https://openrouter.ai/api/alpha/decisions` with the pinned
model `typesafe/jev-1.13` — or `typesafe` — the first-party System One API
at `https://api.typesafe.ai/v1/systemone` with the pinned model `jev-1.13.0`,
whose `baseUrl` may point at a custom https endpoint/proxy carrying an
origin+path prefix. Jev is never an ACP provider, never an agent seat and
never runs in a background loop or schedule — it is invoked only through the
explicit helper `node <installed>/bin/slp.mjs route-decide <request.json>`.

Jev routing mode is per-daemon configuration under
`<daemonHome>/slp-runtime/state/jev.json` with its provider key in
`jev-<kind>.key` (0600, write-only; the Manager card stores it and status
reports `hasKey` only). All toggles default off, evaluated at preparation
time — toggling never mutates already-running seats. Two live modes:

- **Shadow** (`enabled: true`, `capabilities.routing: false`): route-decide
  still runs and emits its receipt, but the Lead's pick stays binding.
  prepare verifies a supplied receipt for consistency and records BOTH picks
  in the plan (`routing.jev.jevChoice`, `routing.jev.declined`) — the paired
  record is the evaluation data.
- **Armed** (`enabled` and `capabilities.routing` both true): the receipt is
  required and binding — `route.optionId` must equal the receipt choice and a
  decline fails closed.

**Shadow evaluation is the gate before arming** — the capability toggle stays
OFF until shadow data exists. The procedure: (1) for each delegation, Lead
runs route-decide under an enabled-but-unarmed daemon to emit the receipt;
(2) Lead still chooses the seat by its own judgment and prepares with
`route.optionId` + `route.decision`; (3) the plan records both picks;
(4) the Human pre-registers exit criteria — agreement rate and the
asymmetric error class (Jev declining a fit option, or picking one the Lead
rejects) — and only after the recorded pairs satisfy them does the Human arm
`capabilities.routing`. Arming before that data exists skips the gate.

The flow in either mode: Lead authors a routing `brief` — a nonempty string
of raw task/assignment text (never raw `assignmentFile` bytes) — and runs
route-decide. Structured forms are refused (`jev-request-invalid`): a
`signals` field or object/array let the caller pre-classify the task with
Jev's own decision vocabulary, turning the seat choice into a rubber stamp —
inline the same facts as prose instead. Standard `axis:value` tokens quoted
verbatim inside the text still ship, but as unverified mentions: the decision
instructions tell Jev to read them as prose, and `warnings` in the output
lists every hit for the caller. A useful brief carries the task description,
risk/effort signals, constraints and dependencies — the brief is the entire
evidence surface, so a starved brief (`"x"`) yields answers that drift toward
chance; this is guidance, not a hard schema, because what a good brief needs
is itself measured during shadow evaluation. The helper computes the eligible
candidate set deterministically — the same `optionExclusions` tokens prepare
enforces — plus one explicit `no-suitable-option` sentinel, sends
`{brief, role, options}` as state (catalog `notes` are
withheld), and emits `{optionId, catalogSha256, declined, warnings, decision}`
where `decision` is the receipt. prepare then takes `route.optionId` +
`route.catalogSha256` + `route.decision` and verifies the receipt offline:
internal hash, pinned model (matching the configured provider), catalog hash
match, exactly the `route_option` question, matching role, candidate
membership — plus answer match when armed. A receipt is verified whenever
supplied — even with Jev off — and is required whenever the capability is
armed, so a bare `route.optionId` then fails closed. The same rules bind
prepare-handoff through the shared plan builder, and `prepare --check` runs
the identical receipt stages offline.

The receipt records the model, state hash, question set, catalog hash,
candidate list, the full answer with its probability distribution and
confidence, timestamp and latency. In armed mode the reason trail moves from
Lead prose to this receipt — a recorded distribution, not reasoning; the
"Lead records its choice rationale" posture applies when Jev routing is not
armed. Confidence is recorded evidence — never a routing threshold; a
low-confidence pick is not auto-rejected or retried. Receipts prove
consistency, not cryptographic authenticity: they cannot certify that a real
Jev answered, only that the supplied artifact is internally consistent with
this catalog.

Jev's answer is a proposal, not authority — deterministic eligibility and
prepare's receipt verification still bound it, and every failure is closed:
missing/disabled config or key, an OpenRouter/TypeSafe outage, a timeout,
an empty eligible set, a choice outside the candidate set or a stale catalog
hash all refuse rather than guess. A decline (`no-suitable-option`) emits
its receipt, exits nonzero and is escalated — the pool is Human-owned, so
Lead reports the gap rather than retrying. Controlled degradation: while the
capability stays armed an unreachable OpenRouter blocks the dependent Peer
delegation; the Human disables `enabled` or `capabilities.routing` in the
Manager card (or edits jev.json) and Lead judgment resumes — disabling keeps
the stored key.

Accepted risk (recorded): the key file is `0600` inside the daemon home, but
any process running as the same user — including a Peer seat — can read it.
`0600` narrows the exposure to same-user processes; it does not eliminate it.
The Jev provider key is the only credential SLP stores; treat daemon-home
integrity as the security boundary.

## Peer quota fallback

The catalog's quotaFallback is { enabled: boolean, optionId: pool option ID | null } —
one designated option, not an ordered list. Absent or disabled means stop the
quota-blocked branch. Enabled authorizes Lead to retry exactly the designated
option, within assignment budget — one attempt, not a search over candidates.

On a real quota error, record the source option, failed operation and provider error.
Refresh routes and live capabilities. The designated option must be a different
enabled/ready Peer option; reject it when its runtime/account is known to share
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
plus route.optionId/catalogSha256. An optional paseoHome overrides the fallback
catalog home ($PASEO_HOME, default ~/.paseo). Preparation resolves the repository
pool with the user-scope catalog as fallback and emits arguments; it never creates
an agent or chooses the option for Lead. When the repository catalog binds,
prepare and route-decide still surface `poolDrift` and a `warnings` line for
the chosen option whenever its runtime bundle (provider/model/modeId/
thinkingOptionId/features) differs from the live pool record — reported for
reconciliation, never auto-merged.
Pass the array returned by live list_providers as request.providers, extracting
it from the tool response envelope when necessary — each provider object
verbatim from that array: no added, removed or edited fields, never a
configured or hand-authored entry (preparation refuses anything else and the
error says so). Each entry carries the observed
id, enabled and status (and extends when present). The same data can arrive by
file: `node <installed>/bin/slp.mjs inventory --paseo-home <exact-home>` emits
{providers, profiles} in the shape preparation consumes — write it to a file and
pass its absolute path as request.inventoryFile, which fills only fields the
request did not inline; an explicit inline array, including [], always wins.
Under a managed runtime (SLP_MANAGED_RUNTIME=1) that helper never calls paseo:
its providers are static config reads labeled provenance configured that launch
planning refuses, so take live providers from the same daemon's list_providers
and pass them inline as request.providers. Either way an inventory proves
configuration completeness, never provider health — a listed entry can be stale
(`paseo provider ls` status included), so its presence is not permission to
launch. A missing inventory is a request
construction error: supply the discovery already obtained and rerun preparation;
it is not a reason to change the selected model or read package implementation.
Use taskLabel for a short Human-readable work label and disposition for the Peer
seat. prepare renders the naming convention from delegation-execution.md; omitted taskLabel
uses the repository directory name, and omitted Peer disposition displays General.
Catalog hash validation is not atomic with host creation; record actual launches.

Installed providers are slp-codex-{role}, slp-pi-{role}, slp-devin-{role} and
slp-claude-{role}.
Every Peer wrapper loads the same policy. Codex receives developer instructions;
Pi uses --append-system-prompt while preserving host extensions/MCP arguments;
Devin runs a generic ACP adapter, so its wrapper prepends the role core,
recovery pointer and current managed communication language to every session
prompt — the first prompt and prompts re-armed by load/resume/fork also carry
the session-entry helpers and measured carrier; Claude runs the Agent SDK stream-json
transport, so its wrapper appends the role policy to the appendSystemPrompt
field of the initialize control request (SDK 0.3.246 hoists a preset
systemPrompt's append there; the wrapper also covers a verbatim preset object).
Each wrapper spawns the family CLI resolved on PATH; SLP_CODEX_BIN,
SLP_PI_BIN, SLP_DEVIN_BIN and SLP_CLAUDE_BIN override the binary, so
daemon-side executable overrides on the stock provider do not reach the
wrappers. Devin bindings accept swe-2 models only.
Pi model IDs may contain endpoint prefixes and slashes; preserve the exact
discovered ID.

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
