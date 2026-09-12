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
| src/references/provider-routing.md | Saved Human profile selection, provider validation and provider handoff procedure. |
| src/routing.mjs | Read only the assigned repository's catalog; bind a Lead-selected option with fresh hash and availability checks. |
| skills/paseo-slp-onboarding/SKILL.md | Installable repo tactics setup and saved-profile verification; project/global installation is independent from repo config initialization. |
| src/templates/WORKSPACE_PROTOCOL.md | Repository tactics template with risk classes, routing, monitoring and proof gates; explicit init preserves existing files. |
| src/binding.mjs | Every rule a Binding must satisfy: setting patterns, the route override deny-lists and the single provider-health check. Imports nothing from the package. |
| src/role-bundle.mjs | Which policy bytes each role receives at session entry, and their order; the load-path contract traced in guide-coverage.md. |
| src/launch.mjs, src/profiles.mjs | Select one Binding source (saved profiles, catalog routing or an explicit binding), then compose the create_agent argument record. launchPlan and handoffPlan share one builder; nothing edits that record afterwards. Handoff adds explicit authority, old-owner evidence, resources and current work snapshot; no lifecycle mutations. |
| src/package.mjs | Package identity, exclusive staging, integrity checks and stable Git work snapshot. |
| bin/slp.mjs | Install/upgrade/preview, verify/uninstall, init, routes, prepare/handoff, identity and snapshot entrypoints. |
| skills/paseo-slp-e2e/SKILL.md | Single-session full-suite execution procedure; requires the source checkout and authorized Paseo actors. |
| e2e/evidence.mjs | One contract per evidence kind: what may enter the ledger and what discharges the kind's requirement at seal. |
| e2e/criteria.mjs | U1–U7 as code, each naming the evidence kinds that can support it; the mapping a reviewer previously held in their head. |
| e2e/ | Development-only scenario manifest, fixture, external outcome check, evidence collector and repository E2E protocol. Collector commands do not create agents or judge behavioral evidence. |
| tests/*.test.mjs | Local installer, rollback, transport, envelope and snapshot checks. |

The install unit is package.json, install.sh, bin/, skills/ and src/. installed.json binds their
exact bytes. A Paseo-integrated install also binds paseo-binding.json, containing
only owned entries and the prior values of two MCP flags, never credentials.
The shell installer and installed CLI share the same installation code.

Only three managed profiles exist: slp-{supervisor,lead,peer}; providers use
slp-codex-{role} and slp-pi-{role}. Peer disposition belongs to the assignment;
it never maps to a specialized profile. Ordinary launches use the saved Human-configured role profiles in Paseo. Existing IDs must be
removed before installing; unrelated configuration is preserved.

Installation performs no agent creation. Reload changes host configuration for
future launches. Uninstall requires unchanged managed entries and package files;
it preserves unrelated config edits and refuses removal with extra files. Existing
sessions may still depend on installed paths: finish them before uninstall.
A repeat install of identical bytes preserves profile setting edits. Replacing a
different candidate requires explicit upgrade into a new directory. Upgrade preserves
current profile preferences and unrelated config, adds new bundles and rebinds owned
providers to the new directory while retaining the old installation for active sessions.
Owned legacy disposition profiles are removed from host profiles and archived exactly
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
read/write authority and output; independent review uses fresh sessions and exact candidates.

The policy describes monitoring, council, recovery and parallel ownership, but these
paths are not E2E-qualified by this revision. Heartbeat uses discovered host wake
primitives; no semantic detector, lifecycle runner, tool filter or schedule adapter
is added. Missing capabilities remain explicit before any fallback. See
[guide coverage](guide-coverage.md) for requirement mapping, load paths and host gaps.

Codex and Pi share role bytes through their respective adapters. Human configures
slp-supervisor, slp-lead and slp-peer with matching SLP role providers in Paseo.
Ordinary delegation refreshes list_profiles and copies the saved provider, model,
modeId, thinkingOptionId and featureValues into create_agent arguments. Discovery
validates availability/settings; it does not select a replacement model. Missing
or incompatible profile settings require Human configuration before launch.

Optional prepare accepts fresh profiles/providers inventories and returns profileId
plus exact create arguments. This path rejects explicit binding and route runtime
or catalog overrides, and requires no repository catalog. It is not a mandatory
step before agent-scoped Paseo create_agent. Stock provider bindings and catalog
requests remain separate explicit offline paths for authorized experiments/handoffs.
They do not qualify saved-profile acceptance.

init preserves existing files and creates missing protocol plus an empty optional
catalog at <repository>/.paseo-slp. Protocol holds repo tactics and budget. Ordinary
profile-based tasks may leave the catalog empty. --routing-from and routes remain
for explicitly assigned catalog experiments/migrations: no global or other-repo
fallback, stale hash or disabled/unavailable option bypass. Catalog settings never
override a saved-profile request. The helper validates supplied inventory at
preparation time; host provenance, freshness and actual launch need live evidence.

New basic-codex/basic-pi manifests require runtimeSource=profiles and the corresponding
provider family. Human configures all three profiles before testing; coordinator
records raw inventories and never edits profiles to make a row launchable. begin
validates settings.source/profiles/providers and derives the role bundles. U2
compares all actor launches with those saved profiles. Old frozen manifests and
reviews keep their original criteria; no past catalog run gains profile acceptance.

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
