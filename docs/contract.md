# Candidate contract and file map

This revision implements persistent role installation for the bounded SLP path.
Behavioral authority is the operating guide and current Human assignment.
Local installation/transport checks do not constitute workflow acceptance.

| Files | Responsibility |
|---|---|
| install.sh | One-command local install into the selected destination and Paseo home; reload configuration. |
| src/paseo-install.mjs | Merge owned provider/profile entries, preserve existing preferences, record rollback binding, initialize repository protocol. |
| bin/codex-role.mjs, src/role-transport.mjs | Transparent Codex stdio adapter; append installed role instructions at start/resume and existing turn overrides. |
| src/common.md, src/roles/*.md | Authority and role behavior; no repository tactics or model IDs. |
| src/delegation.md | Paseo profile discovery, agent-scoped delegation, notification and report retrieval. Only Supervisor/Lead load it. |
| src/templates/WORKSPACE_PROTOCOL.md | Bounded-job protocol installed only through explicit init, preserving existing files. |
| src/launch.mjs, src/profiles.mjs | Compose shared role bytes and optional offline create_agent arguments from selected settings. |
| src/package.mjs | Package identity, exclusive staging, integrity checks and stable Git work snapshot. |
| bin/slp.mjs | Install/preview, verify/uninstall, init, prepare, identity and snapshot entrypoints. |
| src/observation.mjs | Offline evidence helpers; no lifecycle runner or acceptance oracle. |
| tests/*.test.mjs | Local installer, rollback, transport, envelope and snapshot checks. |

The install unit is package.json, install.sh, bin/ and src/. installed.json binds their
exact bytes. A Paseo-integrated install also binds paseo-binding.json, containing
only owned entries and the prior values of two MCP flags, never credentials.
The shell installer and installed CLI share the same installation code.

Profiles use slp-{supervisor,lead,peer}; providers use slp-codex-{role}.
Configure model, mode, thinking and features in Paseo. Existing IDs must be
removed before installing; unrelated configuration is preserved.

Installation performs no agent creation. Reload changes host configuration for
future launches. Uninstall requires unchanged managed entries and package files;
it preserves unrelated config edits and refuses removal with extra files. Existing
sessions may still depend on installed paths: finish them before uninstall.
A repeat install of identical bytes preserves profile setting edits. Replacing a
different candidate requires an explicit cutover; there is no implicit upgrade.

Policy is injected independently of the ordinary task prompt. Provider labels
and agent self-reports are not proof of loading: E2E evidence must correlate the
provider command, installed bytes, actual session instructions and host parentage.
Permissions and role boundaries remain distinct: policy is not tool isolation.

Assignment supplies objective, repository/workspace, owned/excluded scope,
authority, verification and handback. Lead reads the repository protocol and
passes only relevant constraints to Peer. No global role is written to AGENTS.md.

A work snapshot includes HEAD, tracked/untracked nonignored paths, content,
symlink targets, permission modes and deleted markers. It excludes ignored build
outputs, staging intent, external artifacts and processes; relevant external
proof must be recorded separately. Submodules are unsupported. Before/after
snapshots detect drift while Peer is paused, not transient or malicious writes.
