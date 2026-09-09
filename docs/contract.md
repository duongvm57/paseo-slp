# Candidate contract and file map

This revision provides persistent role installation and SLP operating policy for
task-specific topology, supervision and evidence-based acceptance.
Behavioral authority is the operating guide and current Human assignment.
Local installation/transport checks do not constitute workflow acceptance.

| Files | Responsibility |
|---|---|
| install.sh | One-command local install into the selected destination and Paseo home; reload configuration. |
| src/paseo-install.mjs | Merge owned provider/profile entries, preserve existing preferences, record rollback binding, initialize repository protocol. |
| bin/codex-role.mjs, src/role-transport.mjs | Transparent Codex stdio adapter; append installed role instructions at start/resume and existing turn overrides. |
| bin/pi-role.mjs, src/role-transport.mjs | Pi native append-system-prompt adapter; preserve RPC bytes, host extensions and session/model/thinking arguments. |
| src/common.md, src/roles/*.md | Authority and role behavior; no repository tactics or model IDs. |
| src/delegation.md | Paseo profile discovery, agent-scoped delegation, notification and report retrieval. Only Supervisor/Lead load it. |
| src/references/orchestration.md | Lead's conditional topology, independent review/council, dependency and integration procedure. |
| src/references/monitoring.md | Supervisor/Lead event observation, heartbeat ownership and resource settlement. |
| src/references/governance.md | Supervisor scope, causal notebook, authorized recovery and policy evolution. |
| src/references/anti-patterns.md | All 20 guide §9 hypotheses with evidence, questions and bounded responses; reached on audit/drift triggers. |
| src/references/provider-routing.md | Human catalog selection, provider settings, quota fallback and provider handoff procedure. |
| src/routing.mjs | Read only the assigned repository's catalog; bind a Lead-selected option with fresh hash and availability checks. |
| skills/paseo-slp-onboarding/SKILL.md | Installable repo setup/update workflow for protocol and routing; project/global installation is independent from repo config initialization. |
| src/templates/WORKSPACE_PROTOCOL.md | Repository tactics template with risk classes, routing, monitoring and proof gates; explicit init preserves existing files. |
| src/launch.mjs, src/profiles.mjs | Compose shared role bytes and optional offline create_agent arguments from selected settings. |
| src/handoff.mjs | Prepare a new-session handoff with explicit authority, old-owner evidence, resources and current work snapshot; no lifecycle mutations. |
| src/package.mjs | Package identity, exclusive staging, integrity checks and stable Git work snapshot. |
| bin/slp.mjs | Install/upgrade/preview, verify/uninstall, init, routes, prepare/handoff, identity and snapshot entrypoints. |
| src/observation.mjs | Offline evidence helpers; no lifecycle runner or acceptance oracle. |
| tests/*.test.mjs | Local installer, rollback, transport, envelope and snapshot checks. |

The install unit is package.json, install.sh, bin/ and src/. installed.json binds their
exact bytes. A Paseo-integrated install also binds paseo-binding.json, containing
only owned entries and the prior values of two MCP flags, never credentials.
The shell installer and installed CLI share the same installation code.

Only three managed profiles exist: slp-{supervisor,lead,peer}; providers use
slp-codex-{role} and slp-pi-{role}. Peer disposition belongs to the assignment;
it never maps to a specialized profile. Explicit Human profile launches remain
supported, with settings in Paseo. Existing IDs must be
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

Codex and Pi share role bytes through their respective adapters. Provider changes
within a managed profile use the matching role wrapper; repeat installation preserves
those selections. Offline prepare accepts stock or matching role Codex/Pi providers,
slash-bearing model IDs and optional modes. Stock providers receive the role envelope
in initialPrompt, while installed wrappers also load it independently. Cross-family
route overrides require a target model and drop old mode/thinking/features unless
explicitly supplied. The ordinary delegation path discovers target capabilities.

The Human catalog is <repository>/.paseo-slp/slp-routing.json beside
<repository>/.paseo-slp/WORKSPACE_PROTOCOL.md.
init creates the missing protocol and empty catalog; it preserves each existing file
independently. --routing-from explicitly seeds a
missing repo catalog from a validated JSON file; no automatic import or merging.
Uninstall does not remove repo files. The two repo files have separate formats:
protocol owns tactics/budget, catalog owns concrete runtime options within those bounds.
Lead reads them on every delegation and reasons over suitability,
restrictions, priority and quota, and chooses an option independently of disposition.
routes requires an absolute repo directory, not a catalog file or installation path.
prepare resolves from request.repository and rejects route.catalogFile. Neither cwd,
PASEO_HOME, another repo, nor an old global catalog supplies a fallback. Worktrees
use their own copies; the chosen base candidate or an authorized copy supplies them.
The routes command returns current bytes' hash. Catalog-based prepare requires that
hash, role eligibility, enabled=true and availability=ready; conflicting inline
settings fail. It emits a complete runtime bundle without inheriting profile defaults.
Provider inventory is checked; live model/effort/features and quota require host
discovery. The check is at preparation time, not an atomic gate in Paseo create_agent.
Policy requires rereading immediately before creation and prohibits silent catalog
bypass. This is a local selector and agent procedure, not a quota telemetry service.

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
