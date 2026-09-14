# Candidate contract and file map

This revision provides persistent role installation and SLP operating policy for
task-specific topology, supervision and evidence-based acceptance.
Behavioral authority is the operating guide and current Human assignment.
Local installation/transport checks do not constitute workflow acceptance.

| Files | Responsibility |
|---|---|
| install.sh | One-command local install into the selected destination and Paseo home; reload configuration. |
| src/paseo-install.mjs | Merge owned provider/profile entries, preserve existing preferences, record rollback binding, initialize repository protocol. |
| src/host-config.mjs | Sole reader/writer of the Paseo host configuration; one rule each for owned provider and owned profile verification and the two MCP flags. |
| bin/codex-role.mjs, src/role-transport.mjs | Transparent Codex stdio adapter; append installed role instructions at start/resume and existing turn overrides. |
| bin/pi-role.mjs, src/role-transport.mjs | Pi native append-system-prompt adapter; preserve RPC bytes, host extensions and session/model/thinking arguments. |
| src/common.md, src/roles/*.md | Authority and role behavior; no repository tactics or model IDs. |
| src/delegation.md | Paseo profile discovery, agent-scoped delegation, notification and report retrieval. Only Supervisor/Lead load it. |
| src/references/orchestration.md | Lead's conditional topology, independent review/council, dependency and integration procedure. |
| src/references/monitoring.md | Supervisor/Lead event observation, heartbeat ownership and resource settlement. |
| src/references/governance.md | Supervisor scope, causal notebook, authorized recovery and policy evolution. |
| src/references/anti-patterns.md | All 20 guide §9 hypotheses with evidence, questions and bounded responses; reached on audit/drift triggers. |
| src/references/provider-routing.md | Supervisor/Lead profile selection, Peer pool selection, validation and handoff procedure. |
| src/routing.mjs | Read only the assigned repository's catalog; bind a Lead-selected option with fresh hash and availability checks. |
| skills/paseo-slp-onboarding/SKILL.md | Installable repo tactics and Peer pool setup, with Supervisor/Lead profile verification; project/global installation is independent from repo config initialization. |
| src/templates/WORKSPACE_PROTOCOL.md | Repository tactics template with risk classes, routing, monitoring and proof gates; explicit init preserves existing files. |
| src/binding.mjs | Every rule a Binding must satisfy: setting patterns, the route override deny-lists and the single provider-health check. Imports nothing from the package. |
| src/role-bundle.mjs | Which policy bytes each role receives at session entry, and their order; the load-path contract traced in guide-coverage.md. |
| src/launch.mjs, src/profiles.mjs | Select one Binding source (saved profiles, catalog routing or an explicit binding), then compose the create_agent argument record. launchPlan and handoffPlan share one builder; nothing edits that record afterwards. Handoff adds explicit authority, old-owner evidence, resources and current work snapshot; no lifecycle mutations. |
| src/package.mjs | Package identity, exclusive staging, integrity checks and stable Git work snapshot. |
| bin/slp.mjs | Install/upgrade/preview, verify/uninstall, init, routes, prepare/handoff, identity and snapshot entrypoints. |
| skills/paseo-slp-e2e/SKILL.md | Single-session full-suite execution procedure; requires the source checkout and authorized Paseo actors. |
| e2e/evidence.mjs | One contract per evidence kind: what may enter the ledger and what discharges the kind's requirement at seal. |
| e2e/criteria.mjs | U1–U7 as code, each naming the evidence kinds that can support it; the mapping a reviewer previously held in their head. |
| e2e/collector.mjs | Frozen evidence ledger and review history; verify assessment byte identities and original-review links before summaries, addenda or review-dependent launch gates. |
| e2e/ | Development-only scenario manifest, fixture, external outcome check, evidence collector and repository E2E protocol. Collector commands do not create agents or judge behavioral evidence. |
| tests/*.test.mjs | Local installer, rollback, transport, envelope and snapshot checks. |

The install unit is package.json, install.sh, bin/, skills/ and src/. installed.json binds their
exact bytes. A Paseo-integrated install also binds paseo-binding.json, containing
only owned entries and the prior values of two MCP flags, never credentials.
The shell installer and installed CLI share the same installation code.

Three roles remain Supervisor, Lead and Peer. Only two saved profiles are managed:
slp-supervisor and slp-lead. The nine providers remain slp-codex-{role},
slp-pi-{role} and slp-devin-{role}; Peer chooses runtime from the project pool,
not a saved profile. Devin bindings accept swe-2 models only.
Peer disposition belongs to the assignment, independent of pool option choice.
Installation refuses collisions with owned provider and Supervisor/Lead profile
IDs; unrelated configuration is preserved.

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
Host install/upgrade neither creates nor reads/writes routing catalogs; previous global
catalogs stay untouched until an explicitly requested repo migration.
The old retained binding
no longer owns current host entries and cannot uninstall those entries. Runtime cutover
still requires task authority; neither install nor upgrade creates replacement sessions.

Policy is injected independently of the ordinary task prompt. Provider labels
and agent self-reports are not proof of loading: E2E evidence must correlate the
provider command, installed bytes, actual session instructions and host parentage.
Permissions and role boundaries remain distinct: policy is not tool isolation.

Assignment supplies objective, repository/workspace, owned/excluded scope,
authority, verification and handback. Lead reads the repository protocol and
passes only relevant constraints to Peer. No global role is written to AGENTS.md.

Common/role instructions and the Supervisor/Lead delegation procedure load at
session entry. They point to conditional references under the installed src/
directory. The recursive install unit includes all those references; the full
operating guide stays a source document, not a prompt broadcast to every role.
Protocol defaults select tactics; global roles no longer impose a single Engineer
or prohibit heartbeat for every assignment. Assignment supplies Peer disposition,
read/write authority and output; independent review uses sessions separate from
implementation and exact candidates. Within one assignment, Lead normally reuses
the Engineer for corrections and the independent Reviewer for re-review on the new
stable candidate. New independent seats and recovery remain explicit choices.
Lead builds relevant project context from repository evidence and maintains a
decision/ownership checkpoint across handbacks and resume; Peers receive only
the context needed for their bounded assignments.

The policy describes monitoring, council, recovery and parallel ownership, but these
paths are not E2E-qualified by this revision. Heartbeat uses discovered host wake
primitives; no semantic detector, lifecycle runner, tool filter or schedule adapter
is added. Missing capabilities remain explicit before any fallback. See
[guide coverage](guide-coverage.md) for requirement mapping, load paths and host gaps.

Codex and Pi share role bytes through their respective adapters. Human configures
slp-supervisor/slp-lead with matching role providers and chosen models/settings.
Supervisor/Lead launches refresh these saved profiles and copy their complete
provider/model/mode/thinking/features bundles. Missing or incompatible settings
require Human configuration before the dependent launch.

Peer delegation defaults to the assigned repository's .paseo-slp/slp-routing.json.
Onboarding prepares a pool of complete provider/model/settings options with
suitableFor, avoidFor, notes, priority and explicit eligibility. Lead reads the pool,
selects an option per task/budget, explains why it fits and validates its fresh hash
with prepare. Provider pi/codex/devin maps to the matching installed Peer wrapper; policy
and disposition stay separate from runtime choice. Neither the Lead's family nor
a saved slp-peer limits the pool. Missing/empty/no-eligible pool blocks Peer
creation until setup is completed, without profile/global/other-repo fallback.

prepare accepts repository, workspaceId, assignment and role. Supervisor/Lead use
fresh profiles/providers; Peer uses providers and route.optionId/catalogSha256.
A profiles inventory can accompany Peer discovery but does not select its runtime.
Catalog settings cannot be overlaid via route runtime/profile overrides. Explicit
binding without profiles remains a separate Human-authorized offline/handoff path,
not an ordinary missing-pool fallback. Helpers emit create arguments only; Paseo
owns lifecycle and actual settings. Source selection is shared by prepare-handoff.

init creates missing protocol and empty pool scaffold without overwriting existing
files. Onboarding completes the project pool; empty init output is not ready for
Peer delegation. --routing-from imports only an explicitly chosen catalog into a
missing repo file. Host upgrade archives retired Peer profiles but neither creates
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
proof must be recorded separately. Submodules are unsupported. Before/after
snapshots detect drift while Peer is paused, not transient or malicious writes.

Peer quota fallback is configured by catalog quotaFallback.enabled and optionIds.
Missing/disabled means stop; targets must be existing eligible pool bundles.
prepare validates route.quotaFallbackFrom against this authorization and fresh hash.
Raw Paseo create/update calls remain host capabilities: the package supplies policy
and validation, not a host security boundary. Evidence must verify actual settings
on start/resume/update; availability flags alone do not prove quota recovery.
