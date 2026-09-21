# Candidate contract and file map

This revision provides persistent role installation and SLP operating policy for
task-specific topology, supervision and evidence-based acceptance.
Behavioral authority is the operating guide and current Human assignment.
Local installation/transport checks do not constitute workflow acceptance.

| Files | Responsibility |
|---|---|
| install.sh | One-command local install into the selected destination and Paseo home; reload configuration. |
| src/paseo-install.mjs | Merge owned provider/profile entries, preserve existing preferences, record rollback binding, initialize repository protocol and Supervisor notebook scaffold; materialize clones a source checkout's protocol and catalog into a target checkout with frontmatter paths rebased (Supervisor notebook excluded). |
| src/host-config.mjs | Sole reader/writer of the Paseo host configuration; one rule each for owned provider and owned profile verification and the two MCP flags. |
| bin/codex-role.mjs, src/role-transport.mjs | Transparent Codex stdio adapter; append installed role instructions at start/resume and existing turn overrides. |
| bin/pi-role.mjs, src/role-transport.mjs | Pi native append-system-prompt adapter; preserve RPC bytes, host extensions and session/model/thinking arguments. |
| bin/devin-role.mjs, src/role-transport.mjs | Generic ACP adapter; prepend installed role instructions to the first session prompt of each session; re-arm on load/resume/fork. |
| bin/claude-role.mjs, src/role-transport.mjs | Claude Agent SDK stream-json adapter; append installed role instructions to the initialize control request's system-prompt append field; all other frames pass through. |
| src/common.md, src/roles/*.md | Authority and role behavior; no repository tactics or model IDs. |
| src/delegation.md | Paseo profile discovery, agent-scoped delegation, notification and report retrieval; inlines the required review-gate invariant and the agent-scoped create_agent rule for new seats. Only Supervisor/Lead load it. |
| src/references/orchestration.md | Lead's conditional topology, independent review/council, dependency and integration procedure. |
| src/references/monitoring.md | Supervisor/Lead event observation, heartbeat ownership and resource settlement. |
| src/references/governance.md | Supervisor scope, causal notebook, authorized recovery and policy evolution. |
| src/references/anti-patterns.md | All 20 guide §9 hypotheses with evidence, questions and bounded responses; reached on audit/drift triggers. |
| src/references/provider-routing.md | Supervisor/Lead profile selection, Peer pool selection, validation and handoff procedure. |
| src/references/review-gates.md | Review gate structure: parallel axis-split seats (Spec vs Standards, optional cross-family), smell baseline, neutral briefs, non-merged aggregation. |
| src/routing.mjs | Resolve the repository catalog, falling back to the plugin-owned user-scope pool at `<paseoHome>/slp-runtime/state/peer-pool.json` when absent; bind a Lead-selected option with fresh hash and availability checks. `optionExclusions` is the single eligibility predicate — closed-vocabulary tokens (`disabled`, `availability:<state>`, `role-not-listed`) shared by enforcement and Jev candidate generation. `validateCatalog` stays shape-only (it also refuses the Jev decline sentinel as an option id — a shape-level collision); the semantic layer reports a reserved standard-seat id whose tokens diverge from the package set as a Token conflict on every read, and `catalogBinding` refuses to bind one. `catalogBinding` verifies a supplied Jev receipt offline — including the vocabulary version it was issued under — and requires one when the daemon arms `jev.capabilities.routing`. |
| src/routing-vocabulary.mjs | Canonical routing-criteria vocabulary (docs/spec/routing-criteria.md): the four axes, the 16 standard `axis:value` tokens with definitions, the 12 reserved standard-seat ids with package token sets, the §4 reading helpers and the English Jev guidance — all versioned under `ROUTING_VOCABULARY_VERSION`. `plugin/shared/routing-vocabulary.ts` is its Manager-side mirror; neither side can import the other, so tests pin identical data. |
| src/jev.mjs | Jev (TypeSafe System One) bounded-decision transport — never an ACP provider. Per-daemon config/key resolution (fail closed, all toggles default off), OpenRouter Decisions API calls to the pinned `typesafe/jev-1.13` with ~5s timeout and at most one bounded retry, typed-answer validation, credential-shaped-string redaction before send, and decision-receipt build/verify. Receipts prove consistency, not authenticity; confidence is recorded, never a threshold. |
| src/jev-routing.mjs | First Jev consumer: `route-decide` computes the deterministic eligible set from `optionExclusions`, drops Token-conflicted seats from candidates (reporting every catalog conflict on the receipt), sends the Lead-authored brief as state plus the versioned English suitability guidance and the compact per-token glossary (never raw assignmentFile bytes; catalog `notes` withheld) and emits the option id plus receipt. The per-option surface is fixed-shape — `id`, `provider`, `model`, `thinkingOptionId` (explicit `null` when absent), `suitableFor`, `avoidFor`. Decline exits nonzero; `jev-no-candidates` when no usable seat remains. Runs only on explicit invocation — no loops, schedules or prepare-time calls. |
| skills/paseo-slp-onboarding/SKILL.md | Installable repo tactics and Peer pool setup, with Supervisor/Lead profile verification; project/global installation is independent from repo config initialization. |
| src/templates/workspace-protocol.md | Repository tactics template with risk classes, routing, monitoring and proof gates; the `agent_mode` frontmatter field records the intended spawn mode for direct launches (empty falls back to the bundle's `modeId`, then asks); explicit init preserves existing files. |
| src/binding.mjs | Every rule a Binding must satisfy: setting patterns, the route override deny-lists and the single provider-health check. Imports nothing from the package. |
| src/role-bundle.mjs | Which policy bytes each role receives at session entry, and their order; the load-path contract traced in reports/guide-coverage.md. Session-entry instructions also carry the carrier block (spawn kit plus policy-byte locators) so profile/provider launches receive the same payload prepare places in initialPrompt. Managed sessions also inject the plugin-set communication language (slp-runtime/state/communication-language) when present — one line, nothing when unset. |
| src/launch.mjs, src/profiles.mjs | Select one Binding source (saved profiles, catalog routing or an explicit binding), then compose the create_agent argument record. launchPlan and handoffPlan share one builder; nothing edits that record afterwards. Handoff adds explicit authority, old-owner evidence, resources and current work snapshot; no lifecycle mutations. request.inventoryFile fills providers/profiles the request did not inline; request.assignmentFile appends a read-first pointer to the emitted prompt without inlining file bytes. The plan also surfaces the intended `modeId` (with a warning when the binding lacks one), a `spawnKit` of role-appropriate MCP tool signatures, and an `orientation` manifest of policy-byte locators (path/bytes/sha256, `missing` for receipt-declared files absent on disk; the set derives from the install receipt, so source-only documents are never declared) — locators only, never interpretation; the same payload is carried inside `create.initialPrompt`, the only field create_agent transmits, so the spawned seat actually receives it. The prompt-side carrier is omitted only when the binding targets the canonical `slp-<family>-<role>` wrapper and the request's live provider inventory observed it — the wrapper injects the carrier at session entry; unverified targets keep the prompt fallback. |
| src/inventory.mjs | Provider/profile inventory in the exact shapes prepare consumes: `paseo provider ls --json` only when the requested home's paseo.pid names a live process, else that home's own config.json `agents.providers` — never another daemon's providers, no directory materialization; provider `enabled` may be null for unrecognized states; profiles always from `daemon.agentProfiles`. Read-only; on multi-daemon hosts the live listing reflects whichever daemon the paseo CLI reaches. |
| src/agents.mjs | Agent listing from daemon persistence (`<paseoHome>/agents/*/<id>.json`) with shell-quoted devin-family `devin -r` attach hints; works around `paseo inspect`/`ls` not surfacing `persistence.nativeHandle`. Read-only, best-effort host detail. |
| src/spawn-kit.mjs | Package-owned approximation of the Paseo MCP tool surface per role (orchestrating vs peer), emitted in prepare plans so seats skip live schema re-derivation; marked approximate pending live `mcp_list_tools` verification. |
| src/monitor.mjs | On-demand signal scan over daemon-owned agent state plus each declared worktree's git status; emits `{agentId, kind, evidence, observedAt}` candidates (attention, follow-up-round, idle-dirty, scope-drift, test-mirror, file-churn, tool-mix, correction-cadence) only for new fingerprints when a stateFile checkpoint is supplied — that checkpoint is the only write. Never a verdict, daemon or rendered-log parse; broken cwd becomes an evidence gap. An opt-in `devinSessionsDb` request field probes the devin CLI sessions.db read-only for devin-family agents (joined by `persistence.nativeHandle` = `sessions.id`; a missing or unmatched handle is a gap — never a cwd guess) to derive tool-mix and correction-cadence candidates; every failure is an evidence gap, not a crash. |
| src/notebook.mjs | Read-only locator for a repository's active governance notebook: resolves the repository's git common dir — the property linking a worktree back to its repository — then lists Supervisor agents (provider containing `supervisor`, or a Supervisor-titled state file) whose `cwd` shares it. Output is candidates only, sorted by lastActivityAt, each with notebook path and `notebookExists`; broken agent cwds become gaps. Never copies or mutates notebook content, and picks no authoritative candidate — governance stays per-checkout. |
| src/package.mjs | Package identity, exclusive staging, integrity checks and stable Git work snapshot; untracked nested Git work-tree roots are snapshotted recursively under `nested`, sub-repos can carry their own `nested`, and index gitlinks record `{path, kind:"gitlink", indexOid, headOid, state}` with non-clean states listed in top-level `incomplete`. |
| src/runtime-state.mjs | Read-only plugin-state probes (H13 workaround): `localTarget` mirrors the plugin's daemon-home detection; `runtimeStatus` recomputes the file-derivable parts of the daemon `status` view — receipt, owned providers/profiles, runtime and launcher integrity, config-drift presence — and reports daemon-only views (live conflicts, family availability) as gaps, never guesses. The Jev probe reports `hasKey`/`keyPermissionsOk` only — key material never enters output. Fails closed on corrupt plugin state. Mutation RPCs are Human-authority and are not exposed. Retire when the host ships `paseo plugin invoke` or MCP `invoke_plugin_rpc`. |
| bin/slp.mjs | Install/upgrade/preview, verify/uninstall, init, materialize, routes, prepare/handoff, inventory, agents, monitor, notebook, identity, snapshot, instructions (raw session-entry bundle bytes on stdout, provenance on stderr), route-decide (the only path that calls Jev — explicit invocation, network, emits a receipt; prepare and prepare --check stay offline), status and local-target (read-only plugin-state probes) entrypoints. |
| skills/paseo-slp-e2e/SKILL.md | Single-session full-suite execution procedure; requires the source checkout and authorized Paseo actors. |
| e2e/evidence.mjs | One contract per evidence kind: what may enter the ledger and what discharges the kind's requirement at seal. |
| e2e/criteria.mjs | U1–U7 as code, each naming the evidence kinds that can support it; the mapping a reviewer previously held in their head. |
| e2e/collector.mjs | Frozen evidence ledger and review history; verify assessment byte identities and original-review links before summaries, addenda or review-dependent launch gates. |
| e2e/ | Development-only scenario manifest, fixture, external outcome check, evidence collector and repository E2E protocol. Collector commands do not create agents or judge behavioral evidence. |
| tests/*.test.mjs | Local installer, rollback, transport, envelope and snapshot checks. |

The install unit is package.json, install.sh, bin/, skills/ and src/. installed.json binds their
exact bytes. The standalone Paseo installer also binds paseo-binding.json, containing
only owned entries and prior MCP values, never credentials. The Option A plugin
keeps its receipt and operation intents in a private per-daemon-home sidecar
outside immutable candidates and plugin settings; its payload manifest
additionally verifies file modes. The shell installer and installed CLI share
the standalone installation code. The plugin uses the documented config.patch
transaction and stable executable shims.

Three roles remain Supervisor, Lead and Peer. Only two saved profiles are managed:
slp-supervisor and slp-lead. The twelve providers remain slp-codex-{role},
slp-pi-{role}, slp-devin-{role} and slp-claude-{role}; Peer chooses runtime from
the project pool, not a saved profile. Devin bindings accept swe-2 models only.
Peer disposition belongs to the assignment, independent of pool option choice.
Standalone installation refuses collisions with owned provider and Supervisor/Lead
profile IDs. Plugin activation may adopt existing entries only by explicit
request and exact persisted-schema equality. A surviving receipt preserves the
original restoration baseline; adoption without that receipt records the
observed baseline and cannot recover earlier shared values. Unrelated
configuration is preserved within the documented exclusive administrative edit
window.

Installation performs no agent creation. Reload changes host configuration for
future launches. Uninstall requires unchanged managed entries and package files;
it preserves unrelated config edits and refuses removal with extra files. Existing
sessions may still depend on installed paths: finish them before uninstall.
A repeat install of identical bytes preserves profile setting edits. Replacing a
different candidate requires explicit upgrade into a new directory. Upgrade preserves
current profile preferences and unrelated config, adds new bundles and rebinds owned
providers to the new directory while retaining the old installation for active sessions.
Owned slp-peer and legacy disposition profiles are removed from host profiles and archived exactly
in paseo-binding.json retiredProfiles for review. Other profiles remain untouched.
The user-scope Peer pool is plugin-owned mutable state at
<paseo-home>/slp-runtime/state/peer-pool.json (mode 0600, atomic
whole-file writes under a sha256 compare-and-swap; the manager surface is
its sole writer). Standalone host install/upgrade/uninstall and plugin
activation/deactivation create, edit, and delete no routing catalogs —
a repository catalog exists only where `init --routing-from` imported an
explicitly chosen file. A legacy <paseo-home>/slp-routing.json is read for
a one-time import into the pool and is never deleted automatically.
Populating routing choices and migrating repository catalogs require
explicit onboarding or migration authority.
The old retained binding
no longer owns current host entries and cannot uninstall those entries. Runtime cutover
still requires task authority; neither install nor upgrade creates replacement sessions.

Option A plugin deactivation restores shared configuration semantics, not
original JSON bytes or absent-key shape. It removes unchanged owned
provider/profile entries and restores the recorded effective injectIntoAgents
value; an originally absent value may become explicit false and an absent
profile array may become empty. It never patches mcp.enabled, which must
already be enabled. Human profile preferences are preserved during rebind and
may be acknowledged by reconcile; conflicting managed entries stop
deactivation.

SLP management operations are administrator-only and require an exclusive
administrative edit window for the selected daemon. Do not edit daemon
configuration through the app, another plugin, a CLI, or a file while
activate, reconcile, or deactivate is in progress. The plugin serializes its
own operations and verifies persisted and live results. Paseo 0.8.0 provides
no compare-and-swap for these patches; this plugin cannot guarantee
preservation against concurrent external writers. A detected mismatch stops
automatic mutation and requires reconciliation.

Plugin disable/remove is not SLP deactivation. Raw removal leaves verified
stable transports operational and correctly roled, with ownership recoverable
by reinstalling the same plugin ID and reconciling its retained receipt.
Deactivate before removing the manager when detachment is intended. Neither
lifecycle cleanup nor deactivate deletes stable runtime or launcher
directories. These directories belong to the per-daemon SLP store and remain
available to existing sessions; deletion requires separate maintenance
authority after dependencies have ended. Provider commands and policy/helper
paths must never reference managed plugin checkouts.

Policy is injected independently of the ordinary task prompt. Provider labels
and agent self-reports are not proof of loading: E2E evidence must correlate the
provider command, installed bytes, actual session instructions and host parentage.
Permissions and role boundaries remain distinct: policy is not tool isolation.

Assignment supplies objective, repository/workspace, owned/excluded scope,
authority, verification and handback. Supervisor and Lead read the repository
protocol when the assignment lands — before decisions that depend on its
tactics, not only before delegation. Lead passes only relevant constraints to
Peer. No global role is written to AGENTS.md.

Common/role instructions and the Supervisor/Lead delegation procedure load at
session entry. They point to conditional references under the installed src/
directory. The recursive install unit includes all those references; the full
operating guide stays a source document, not a prompt broadcast to every role.
Load-bearing decision rules — the required review gate and agent-scoped seat
creation — sit in that always-loaded layer, and Lead re-reads the conditional
references at the decisions that apply them, including after resume or
compaction.
The carrier block (spawn-kit signatures plus policy-byte locators) reaches a
seat through two channels: session-entry bundle injection for profile/provider
launches, and `create.initialPrompt` for the prepare path — the only field
create_agent transmits, so plan-level `spawnKit`/`orientation` fields alone
would never arrive. The captions differ on purpose: session-entry locators are
measured when the bundle loads, plan locators where prepare ran. The kit is an
approximation to verify against live `mcp_list_tools`; locators are integrity
evidence, not policy content. The source contract reviewers use is this file —
`docs/contract.md` lives in the repository and is deliberately outside the
install unit, so locator sets never declare it.
Protocol defaults select tactics; global roles no longer impose a single Engineer
or prohibit heartbeat for every assignment. Assignment supplies Peer disposition,
read/write authority and output; independent review uses sessions separate from
implementation and exact candidates; a required gate is parallel seats on split
axes — never one merged seat — and seats that cannot be supplied make it
BLOCKED rather than skipped. Within one assignment, Lead normally reuses
the Engineer for corrections and the same independent review seats for re-review on the new
stable candidate. New independent seats and recovery remain explicit choices.
Lead builds relevant project context from repository evidence and maintains a
decision/ownership checkpoint across handbacks and resume; Peers receive only
the context needed for their bounded assignments.

The policy describes monitoring, council, recovery and parallel ownership, but these
paths are not E2E-qualified by this revision. Heartbeat uses discovered host wake
primitives; `slp.mjs monitor` adds a caller-invoked, delta-only signal scan that
emits candidates without verdicts — it is not a semantic detector, and no
lifecycle runner, tool filter or schedule adapter is added. Missing capabilities remain explicit before any fallback. See
[guide coverage](reports/guide-coverage.md) for requirement mapping, load paths and host gaps.

Codex, Pi, Devin and Claude share role bytes through their respective adapters. Human configures
slp-supervisor/slp-lead with matching role providers and chosen models/settings.
Supervisor/Lead launches refresh these saved profiles and copy their complete
provider/model/mode/thinking/features bundles; `modeId` alone follows the
delegation precedence — plan binding, then protocol `agent_mode` for direct
spawns, then the bundle's own — rather than verbatim copy. Missing or
incompatible settings require Human configuration before the dependent launch.

Peer delegation resolves the assigned repository's .paseo-slp/slp-routing.json
first; when the repository has no catalog, the plugin-owned user-scope pool
($PASEO_HOME/slp-runtime/state/peer-pool.json, default ~/.paseo) is the
declared fallback. Onboarding prepares a pool of complete provider/model/settings
options with suitableFor, avoidFor, notes and explicit eligibility — authored in
the manager surface, where model/mode values come from the live provider
catalog. The 12 standard archetype ids are reserved: on them the package owns
the closed `axis:value` suitability vocabulary (docs/spec/routing-criteria.md)
and the fields are read-only; any other id is a custom seat with free strings,
and a reserved id carrying divergent tokens is a Token conflict that cannot be
saved or routed until resolved. Lead reads the pool,
selects an option per task/budget, explains why it fits and validates its fresh hash
with prepare. Provider pi/codex/devin/claude maps to the matching installed Peer wrapper; policy
and disposition stay separate from runtime choice. Neither the Lead's family nor
a saved slp-peer limits the pool. No catalog in either scope, or an
empty/no-eligible pool, blocks Peer creation until setup is completed — never a
saved profile, another repository's catalog or inherited Lead settings. An empty
repository catalog remains authoritative and disables the fallback.

Jev-assisted routing is an opt-in per-daemon capability, configured under
<daemonHome>/slp-runtime/state/jev.json with the OpenRouter key beside it
(write-only, 0600; status surfaces hasKey only). Jev is a bounded decision
primitive over OpenRouter's Decisions API (pinned typesafe/jev-1.13), never
an ACP provider or agent seat, and runs only through the explicit
route-decide helper — no loops, schedules or prepare-time calls; prepare and
prepare --check remain offline and merely verify the supplied receipt. Two
modes: shadow (enabled without capabilities.routing — route-decide emits a
receipt, the Lead still chooses, the plan records both picks for agreement
measurement) and armed (capabilities.routing=true — the receipt is required
and binding, including optionId matching the recorded choice); when supplied
a receipt is always verified, toggles apply at preparation time and never
mutate running seats. Shadow evaluation precedes arming: the Human
pre-registers exit criteria (agreement rate and the asymmetric error class)
and arms only once the recorded pairs satisfy them. In armed mode the
suitability reason trail is the receipt's recorded distribution, not Lead
prose. Eligibility stays deterministic and precomputed (the same
optionExclusions tokens enforcement uses), Jev may only pick inside the
eligible set plus the explicit no-suitable-option sentinel, and every
configuration, transport, validation or receipt error fails closed. An
OpenRouter/TypeSafe outage therefore blocks only the dependent Peer
delegation while armed — controlled degradation is the Human disabling the
capability and Lead judgment resuming; disabling keeps the stored key.
Confidence lands on the receipt as evidence, never as a routing threshold,
and receipts prove consistency, not cryptographic authenticity. Accepted
risk (recorded): the key file is 0600 inside the daemon home, yet any
same-user process can read it — daemon-home integrity is the boundary.

prepare accepts repository, workspaceId, assignment and role. Supervisor/Lead use
fresh profiles/providers; Peer uses providers and route.optionId/catalogSha256.
A profiles inventory can accompany Peer discovery but does not select its runtime;
an inventoryFile path fills providers/profiles the request did not inline (explicit
inline arrays win, including `[]`), and an assignmentFile path appends a
read-first pointer to the emitted prompt while keeping file bytes out of it. Both
fields apply to prepare-handoff through the shared plan builder.
Catalog settings cannot be overlaid via route runtime/profile overrides. Explicit
binding without profiles remains a separate Human-authorized offline/handoff path,
not an ordinary missing-pool fallback. Helpers emit create arguments only; Paseo
owns lifecycle and actual settings. The three layers stay distinct: launch
planning pins repository/workspaceId/binding and renders the create record;
the calling Supervisor or Lead owns executing agent-scoped create_agent as the
recorded parent; the host owns the resulting parentage, placement and report
routing. A plan documents intended arguments — it is not proof the team
formed, so the caller verifies the returned child's actual parent, workspace
and report route against host evidence. request.workspaceId stays a required
plan input copied into create.workspaceId; a direct agent-scoped create_agent
may omit workspaceId to inherit the caller's workspace, but prepare keeps
emitting the resolved value. New seats are created through agent-scoped
create_agent so the host records parentage, the report route and the sidebar
tree; prompting a standalone session observes work it already owns and cannot
carry a new delegation. Same-team seats share the assignment's pinned
workspace unless a declared worktree, repository or lane-isolation reason is
recorded with its paths — a second workspace on the same checkout is not
isolation. Source selection is shared by prepare-handoff.

init creates missing protocol and Supervisor notebook files
without overwriting existing files, and writes .paseo-slp/slp-routing.json only
when --routing-from names an explicitly chosen catalog — a repository without
its own catalog resolves the user-scope pool. Host upgrade archives retired Peer
profiles but neither creates
nor edits project catalogs, so setup never silently imports host choices.

New basic manifests use runtimeSource=profiles-and-peer-pool. Supervisor/Lead
profiles and eligible Peer options match the selected basic family. begin records
settings.roles for the two profiles and settings.peerPool for the proposed pool;
Lead selects the actual Peer option, not the coordinator. U2 compares each launch
with its relevant saved profile or option/hash. mixed-peer can use Pi and Codex
Peer options under either Lead family without requiring extra saved profiles or
both basic runs. Old frozen manifests retain their original criteria and results.

New reviews and each addendum record an independent byte digest, and each addendum
binds the original review plus its own sequence position. Summary and
review-dependent gates verify the surviving assessment history, including superseded
addenda; deleting a record and its digest removes it from that set, so complete
local rollback stays outside this protection. New manifests require this identity
protection; missing, mismatched, noncanonical or out-of-sequence records/digests
fail closed. Historical assessments without recorded identity remain
readable as UNVERIFIED_LEGACY without automatic resealing. Their verdicts remain
visible but do not qualify dependency or retry gates. A new addendum cannot
retroactively verify an unsigned original. Summary exposes gateReady separately
from historical status; its CLI returns success only for a fully qualified PASS.

Provider switching creates a new session: prepare-handoff requires old-owner settlement
evidence and transfers state/resources without inventing new parentage or acceptance.
Supervisor/Human still verifies host state and performs the authorized Paseo lifecycle
operations. Quota alone is not switch authority; a Human request or standing fallback
policy supplies it. Actual live transfer remains separate E2E evidence.

A work snapshot includes HEAD, tracked/untracked nonignored paths, content,
symlink targets, permission modes and deleted markers. It excludes ignored build
outputs, staging intent, external artifacts and processes; relevant external
proof must be recorded separately. An untracked directory that is itself a Git
work-tree root is snapshotted recursively and recorded under `nested` with its
own HEAD/sha256/files (a sub-repo can itself carry `nested`); the top-level
sha256 covers nested content. An index gitlink (mode 160000) records
`{path, kind:"gitlink", indexOid, headOid, state}`: indexOid is the stage-0
pointer — the single staging-intent exception, because a gitlink's index entry
is itself the identity object and no working-tree bytes represent it; a
conflicted index (stages 1–3) records `indexOid:null` and `state:"conflicted"`
rather than picking a stage. headOid is the submodule's own HEAD, resolved
read-only (never fetch/init/update); state is `missing` (no directory on disk),
`uninitialized` (no resolvable HEAD), `clean` (HEAD resolves, empty porcelain),
`dirty` or `conflicted`. Any non-clean state lists the path in top-level
`incomplete` — that submodule scope is unproven content, so handoff packets
record it as an evidence gap instead of claiming full-candidate coverage.
Listed directories that are not repositories remain unsupported. Before/after
snapshots detect drift while Peer is paused, not transient or malicious writes.

Peer quota fallback is configured by catalog quotaFallback.enabled and optionIds.
Missing/disabled means stop; targets must be existing eligible pool bundles.
prepare validates route.quotaFallbackFrom against this authorization and fresh hash.
Raw Paseo create/update calls remain host capabilities: the package supplies policy
and validation, not a host security boundary. Evidence must verify actual settings
on start/resume/update; availability flags alone do not prove quota recovery.
