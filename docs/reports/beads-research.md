# Beads (`bd`) — primary-source research

**Date:** 2026-09-21
**Scope:** Verify and expand the prior secondary research
(`agent-issue-tracker-research.md`) against primary sources only: the
[gastownhall/beads](https://github.com/gastownhall/beads) repository at commit
`403e27c6dead` (main, post-v1.3.0, 2026-09-19), plus a locally built binary
(`bd version 1.3.0 (dev: 403e27c6dead)`, CGO embedded-capable) exercised in
`/tmp`. Citations are repo paths; URLs use
`https://github.com/gastownhall/beads/blob/main/<path>`.

---

## 1. Storage architecture

**Dolt is the only storage backend.** SQLite ("Beads Classic"), PostgreSQL and
MySQL backends were all removed; the SQLite layer and its migration
infrastructure were deleted in v0.58.0 (2026-03-02). Upgrading doc calls
Postgres/MySQL "removed backends" that current `bd` refuses.
(CHANGELOG.md §[0.58.0]; docs/getting-started/upgrading.md, "Cross-era
Upgrades")

**Three deployment modes exist** — the README advertises two, the code three:

- **Embedded (default, `bd init`)** — Dolt engine linked in-process via
  `github.com/dolthub/driver/v2`; data at `.beads/embeddeddolt/`. Requires a
  CGO build: a `CGO_ENABLED=0` binary refuses `bd init` in embedded mode and
  offers `--proxied-server` or `--server` instead (verified: build + error
  text; `internal/storage/embeddeddolt/open.go` is `//go:build cgo`;
  docs/getting-started/installation.md distinguishes "server-mode only" vs
  "embedded-capable" `go install` lines).
- **Server (`bd init --server`)** — connects to an external
  `dolt sql-server` (default 127.0.0.1:3307, MySQL protocol); data at
  `.beads/dolt/`. Requires the standalone `dolt` CLI, **pinned to 2.2.0**
  because Dolt 2.3.x regressed `CALL DOLT_RESET('--hard')` on a few percent of
  fresh databases (docs/architecture/dolt.md, "Which Dolt version to
  install").
- **Proxied-server (`bd init --proxied-server`)** — `bd` spawns a
  per-workspace proxy plus a child `dolt sql-server` under `.beads/dolt/` and
  manages their lifecycle; the mode used by CGO-less binaries to avoid
  maintaining an external server (init error text; also referenced throughout
  `cmd/bd/*_proxied_server.go` and docs/getting-started/upgrading.md).

**`.beads/` layout** (verified by running `bd init` in /tmp):

| Path | Role |
|---|---|
| `.beads/metadata.json` | backend, `dolt_mode`, database name, `project_id` — the workspace identity checked on every connect |
| `.beads/config.yaml` | project config (git-tracked); per-machine overrides go in `config.local.yaml` |
| `.beads/embeddeddolt/` or `.beads/dolt/` | the Dolt data directory (gitignored) |
| `.beads/issues.jsonl` | optional export (see below) |
| `.beads/.gitignore` | init-managed: ignores DB dirs, runtime files (`bd.sock`, `*.lock`, `push-state.json`, `last_pull`), `dolt-server.*`, `backup/`, `.env`, federation credential key |
| `.beads/README.md` | generated orientation file |
| `.beads/.local_version` | last-touched bd version ("witness") used by cross-era upgrade gating |
| `.beads.gate.lock` (repo root) | physical-root workspace gate (`internal/workspacegate`) |
| `.beads/interactions.jsonl` | opt-in audit sidecar (`audit.enabled`) |
| `.beads/backup/` | optional periodic Dolt-native backups (`backup.enabled`) |
| `.beads/formulas/` | project formula search path |

(gitignore template: `cmd/bd/doctor/gitignore.go`; config keys:
docs/reference/configuration.md)

**`issues.jsonl` is a passive export, not the sync channel and not a backup.**
Docs are emphatic: "It is not the canonical cross-machine sync channel … JSONL
import is upsert-only; it cannot infer that records absent from an export were
deleted, pruned, or simply never exported." It exists for viewers,
interchange, migration, and as a fallback import source only when no Dolt
remote is configured. Auto-refresh requires `export.auto: true` (off by
default). (docs/core-concepts/sync-concepts.md; docs/architecture/dolt.md;
docs/reference/configuration.md)

**Schema version guard.** At open time `bd` compares DB schema version against
what the binary knows; a database migrated *ahead* of the binary is refused
with an actionable error (`schema version mismatch: database is at v45, binary
knows up to v42`), bypassable via `BD_IGNORE_SCHEMA_SKEW=1` /
`--ignore-schema-skew`. v1.3.0 migrates embedded/local stores in place from
v53 → v66 on first invocation (plus a clone-local migration series 0012 →
0026). A *shared* `dolt sql-server` is never auto-migrated — it requires
`bd migrate schema` consent after all clients are upgraded. On remote-backed
databases a state-aware gate prevents independent per-clone migration
(schema fork → unmergeable); the flow is one designated migrator +
`bd dolt push`, everyone else `bd bootstrap`. (README.md "Schema Version
Guard"; CHANGELOG §[1.3.0] upgrade notes; docs/getting-started/upgrading.md)

**Migration from old SQLite versions.** `bd migrate --to-dolt` was removed in
v0.58.0; pre-0.50 JSONL data uses `scripts/migrate-jsonl-to-dolt.sh`; SQLite
backups are preserved as `beads.backup-pre-dolt-*.db`. Current `bd` refuses
recognized historical SQLite/legacy-Dolt layouts before opening storage; a
"sealed SQLite bridge" exists for `.beads/*.db` files (export with a
historical binary, import into a fresh project). (docs/architecture/dolt.md
"Migrate from SQLite (Legacy)"; docs/getting-started/upgrading.md table)

---

## 2. Sync / collaboration model

**Wire format is Dolt remotes, not files.** `bd dolt push` / `bd dolt pull`
sync Dolt commit history. For git-hosted projects the Dolt remote can be the
same `origin` URL as the source code: Dolt stores data under `refs/dolt/data`,
separate from `refs/heads/*` and `refs/tags/*`. Remote URLs supported:
DoltHub, S3, GCS, `git+ssh://`/`git+https://`, `file://`.
(docs/core-concepts/sync-concepts.md; docs/architecture/dolt.md "Dolt
Remotes")

**Auto-wiring.** `bd init` auto-detects `git remote get-url origin` and
configures a Dolt remote named `origin`; first `bd dolt push` publishes
`refs/dolt/data`. Fresh clones run `bd bootstrap`, which probes `origin` for
`refs/dolt/data` and clones the database from it, wiring the remote for future
push/pull. (docs/core-concepts/sync-concepts.md; docs/architecture/dolt.md
"Contributor Onboarding")

**`bd sync`** is the full-cycle convenience command: pull → positively check
conflicts (from Dolt's conflict tables, never inferred from exit status) →
recompute the denormalized `is_blocked` flag → push with bounded retry on push
races. Exit codes: 0 synced, 1 error, 2 merge conflict halted, 3 retries
exhausted (transient), 4 stuck dirty working set. (`bd sync --help`,
cmd/bd/sync.go)

**Conflict resolution.** Dolt does cell-level 3-way merge. The pull path
auto-settles only convergent conflict classes: machine-local metadata,
audit-only dependency rows, `schema_migrations` vintage rows, `kv.memory.*`
config rows (persistent memories), and last-write-wins on issue cells.
Anything else aborts the merge and surfaces as conflicts; `bd conflicts`
re-presents `dolt_conflicts_*` rows per issue with `--ours`/`--theirs`
resolution per row or table. (`bd sync --help`;
internal/storage/versioncontrolops/mergesettle.go, conflicts.go;
docs/recovery/merge-conflicts.md)

**Multi-clone/multi-machine.** Each clone has its own local Dolt DB; sync is
explicit push/pull (or `bd sync`, `bd federation sync`). Hash-based issue IDs
(`bd-a1b2`) prevent ID collisions across clones; hierarchical IDs
(`bd-a3f8.1`) handle parent-child. (README.md; docs/core-concepts/hash-ids.md)

**Offline behavior.** All local operations work offline — the DB is local and
`bd` needs no network for CRUD, ready, graph, memory, formulas. Network is
needed only for `dolt push/pull`, `federation sync`, `gh:*` gate checks, and
integrations (Linear/Jira/GitHub sync). The git-free mode
(`BEADS_DIR` + `--stealth`, `no-git-ops`) runs with zero git calls.
(README.md "Git-Free Usage")

**Federation** is peer-to-peer sync between independent workspaces:
`bd federation add-peer/list-peers/sync/status`, endpoint schemes
dolthub/gs/s3/file/https/ssh/git-ssh, AES-256-encrypted local credentials,
"sovereignty tiers" T1–T4, topology patterns hub-spoke/mesh/hierarchical.
Conflicts pause for manual resolution unless `--strategy ours|theirs` is
given. (docs/multi-agent/federation.md; cmd/bd/federation.go)

---

## 3. Core primitives

**`bd ready`** — issues with no open *blocking* dependencies; filters by
priority/label/assignee/type/unassigned/molecule; `--sort`, `--claim` (claim
the first ready match), `--gated` (molecules where a gate just closed).
Verified live. (docs/core-concepts/dependencies.md; `bd ready --help`)

**`bd show <id>`** — issue detail incl. `revision`; `--current` resolves the
issue the actor has in progress; `--json` gives the full record.
(cmd/bd/list_show_filter_modes.go; verified live)

**`bd create`** — flags for `-t` type, `-p` priority 0–4, `--parent`,
`--deps`, `--description`/`-design`/`-notes`/`-acceptance`, `--labels`,
`--ephemeral`, `--body-file`/`--stdin`, `--json`. Issue types in source:
`bug, feature, task, epic, chore, decision, message, molecule, gate, spike,
story, milestone` (+ `event` internal; custom types via `types.custom`).
Statuses: `open, in_progress, blocked, deferred, closed, pinned, hooked` +
custom statuses. (internal/types/types.go `AllIssueTypes`; `bd types`,
`bd statuses` output)

**`bd update <id> --claim` is transactional compare-and-set.** The claim sets
`assignee=actor, status=in_progress` in a single SQL transaction only while
the issue is open/active and unassigned, held by the same actor (idempotent
re-claim, `Changed=false`), or assigned to a configured `claim.pools` alias.
Foreign holder → `ErrAlreadyClaimed`; ineligible status → `ErrNotClaimable`;
both wrapped in `*ClaimConflictError` carrying the observed state. Because
Dolt has no real row locking ("FOR UPDATE / SKIP LOCKED are parse-only
no-ops"), a claim that loses the optimistic commit-time merge (MySQL
1213/1205) is retried inside `withRetryTx`, then resolved by
verify-by-re-read. **Verified live**: two concurrent `bd update --claim`
processes on an embedded DB → one wins, other gets `issue already claimed by
agent-a`. (`issueops/claimer.go` — the CAS contract;
internal/storage/dolt/issues.go `ClaimIssue`; internal/storage/issueops/claim.go)

**Claims carry leases.** A claim grants a lease (default TTL **5 minutes**,
`internal/storage/issueops/lease.go` `DefaultLeaseTTL`) kept alive by
`bd heartbeat`; a dead worker's lease goes stale and `bd reclaim` reverts the
issue to open (grace window default ≈2× TTL). Leases live in a node-local
`dolt_ignored` table — heartbeats write no Dolt commit/history and leases are
enforceable only on the replica that granted them (`BEADS_NODE_ID` /
`node_id`); what syncs is `status`/`assignee` on the issue row.
`bd unclaim` releases a claim. (`bd reclaim --help`, `bd heartbeat --help`;
docs/multi-agent/federation.md "Leases are per-replica"; verified live —
claimed issue shows `lease_expires_at`, `heartbeat_at`)

**`bd dep add <B> <A>`** — "B depends on / is blocked by A" (the dependent
comes **first** — a documented agent pitfall: temporal phrasing tempts the
reverse). `--blocked-by`/`--depends-on` flags are aliases; `--file` takes
JSONL bulk edges; per-edge cycle checks run at write time (`--no-cycle-check`
skips per-edge checks but bulk still runs a whole-graph check). Cross-repo
targets: `external:<project>:<capability>` resolved at query time via
`external_projects` config + `provides:` labels. (`bd dep add --help`;
docs/core-concepts/dependencies.md; docs/workflows/molecules.md "Agent
Pitfalls")

**Dependency types — the real list** (internal/types/types.go
`AllDependencyTypes`):

- *Blocking* (affect `bd ready`): `blocks` (default), `parent-child`,
  `conditional-blocks` (B runs only if A fails), `waits-for` (fan-out gate —
  wait for dynamic children)
- *Non-blocking*: `related`, `discovered-from`, `tracks`, `caused-by`,
  `validates`, `supersedes`, `until`, `replies-to`, `relates-to`,
  `duplicates`, `authored-by`, `assigned-to`, `approved-by`, `attests`,
  `delegated-from`
- `bd dep add --type` accepts: `blocks|tracks|related|parent-child|
  discovered-from|until|caused-by|validates|relates-to|supersedes` (the
  remaining types are minted by other commands — `bd dep relate`,
  `bd supersede`, `bd duplicate`, gate/molecule machinery, or custom types —
  the type column accepts any non-empty string ≤32 chars;
  internal/types/types.go `DependencyType.IsValid`)

**`bd close <id> [--reason]`** — batch-capable; `--claim-next` claims the next
highest-priority ready issue in the same request; `--continue` advances a
molecule; `--force` needed for pinned issues or unsatisfied gates; positional
close reasons. Interactive sessions default to the "last touched" issue when
no ID is given (disabled for scripts/agents). (`bd close --help`)

**`bd remember "<insight>"`** — persistent project memory stored as
`kv.memory.<key>` rows in the Dolt `config` table (derived or `--key` key);
`bd memories` list/search, `bd recall <key>`, `bd forget <key>`. Memory keys
are the *only* config class auto-resolved as convergent on merge. `bd prime`
injects memories at session start. (cmd/bd/memory.go; memoryops/memories.go;
internal/storage/kvkeys; internal/storage/versioncontrolops/mergesettle.go)

**Compaction / decay** is a stack of distinct mechanisms:

- `bd compact --auto` — AI-powered semantic summarization of closed issues
  (needs `ANTHROPIC_API_KEY`, `MINIMAX_API_KEY`, or `ai.api_key`); **Tier 1
  only** (~30d closed, ~70% reduction); Tier 2 is explicitly "not yet
  implemented". Manual path: `--analyze` → `--apply --id <id> --summary`.
  `bd restore <id>` recovers pre-compaction content from a snapshot.
  (`bd compact --help`; internal/compact/compactor.go)
- `bd gc` — three-phase lifecycle GC: decay (delete closed issues >90d) +
  squash Dolt commits + `dolt gc` (`--full` collects all generations).
  (`bd gc --help`)
- `bd prune` / `bd purge` — delete closed persistent / ephemeral beads
  (`--force` required); prune skips beads still referenced by open work.
  `bd flatten` squashes all Dolt history into one commit.
  (docs/architecture/dolt.md "Maintenance")

---

## 4. Formulas / Molecules / Gates — current reality

The vocabulary is real and current, but the mechanics differ from what a
casual reading of older material suggests:

**Formula** = a declarative workflow template file (TOML preferred, JSON
accepted) living on a search path (`.beads/formulas/`,
`~/.beads/formulas/`, checkout-root, `$GT_ROOT`). Schema: `formula`, `vars`
(with `required`/`default`/`pattern`/`enum`), `[[steps]]` with `id`, `title`
(`{{var}}` substitution), `needs`, `type`, `[steps.gate]` blocks,
`waits_for` fan-in, `[[compose.bond_points]]`, `type = workflow|expansion|
aspect` (aspects = cross-cutting `[[advice]]` transforms). Commands:
`bd formula list/show/schema`, `bd formula convert` (JSON↔TOML). Step
completion hooks (`on_complete.run`) are documented as **not wired end to
end** — the historical example was invalid. (docs/workflows/formulas.md;
`bd formula --help`; docs/workflows/molecules.md "Hooks")

**Proto** = a cooked formula persisted as an epic carrying the `template`
label. **`bd cook <file>`** compiles a formula into a proto (ephemeral by
default; `--persist` to keep). A molecule is *literally an epic with
children* plus workflow intent — "a formula is optional — any epic with
children is a molecule." (docs/workflows/molecules.md)

**Molecule** = instantiated proto: `bd mol pour <proto> --var k=v` creates the
parent + hierarchical child beads (`bd-xyz.1`, `.2`…) wired by `needs` edges;
children are **parallel by default** — only explicit dependencies sequence
them. `bd mol` family: `pour` (persistent), `wisp` (ephemeral), `bond`
(polymorphic proto+proto/proto+mol/mol+mol composition), `squash` (condense
to digest), `burn` (delete outright), `distill` (extract formula from ad-hoc
epic), `current`, `progress`, `stale`, `ready`, `last-activity`. Closing the
last child does **not** auto-close the root — `bd epic close-eligible` sweeps
those. (docs/workflows/molecules.md; `bd mol --help`, `bd mol pour --help`)

**Wisp** = molecule in the "vapor phase": real beads flagged `Ephemeral`,
stored in `wisps`/`wisp_dependencies`/`wisp_comments`/`wisp_events` tables
that are `dolt_ignored` (not versioned, not synced — "Wisps skip DOLT_COMMIT
since they live in dolt_ignored tables", internal/storage/dolt/issues.go).
Excluded from federation push by default (`federation.exclude_types =
[wisp]`); bulk-deleted by `bd purge` / `bd mol wisp gc`.
(docs/workflows/wisps.md; internal/storage/dolt/ephemeral_routing.go)

**Gate** = a *bead of issue-type `gate`* that blocks dependents through a
normal dependency edge until an external condition holds. Await types:
`human` (manual `bd gate resolve`), `timer` (Go duration; no `d` unit),
`gh:pr` (PR merged, via `gh pr view`), `gh:run` (CI success, via
`gh run view`), `bead` (another bead closes). `bd gate check` evaluates and
closes satisfied gates; `bd gate discover` heuristically matches `gh:run`
gates to workflow runs; `bd gate create --type ... --blocks <id>` attaches a
gate to existing work. In formulas, `[steps.gate]` with `type/id/await_id/
timeout/repo`. **Known limitations (GH#5861):** cross-rig `bead` gates never
auto-resolve, `bd close` can't verify bead gates in proxied-server mode, and
prefix routing can't open a proxied-server target rig.
(docs/workflows/gates.md; docs/core-concepts/dependencies.md "Gates")

---

## 5. Agent integration mechanisms

**`bd setup <recipe>`** — 14 built-in recipes (`bd setup --list`, verified):
aider, claude, codex, cody, copilot, cursor, factory, gemini, junie,
kilocode, kiro, mux, opencode, windsurf; custom recipes via
`bd setup --add <name> <path>`. Each recipe knows its target files
(docs/getting-started/ide-setup.md table), e.g.:

- `claude` → `.claude/settings.json` SessionStart hook `bd prime --hook-json`
  + `CLAUDE.md` section (project-local default, `--global` for
  `~/.claude/settings.json`); skipped when the beads plugin already provides
  hooks
- `codex` → `.agents/skills/beads/SKILL.md` + `AGENTS.md` section +
  `.codex/hooks.json` (SessionStart/PreCompact/PostCompact/UserPromptSubmit →
  `bd codex-hook`)
- `cursor` → `.cursor/rules/beads.mdc` + `.cursor/hooks.json`
  (sessionStart/preCompact/postToolUse → `bd cursor-hook`)
- `factory`/`mux`/`opencode` → managed `AGENTS.md` section
  (`BEGIN/END BEADS INTEGRATION` markers carrying version/profile/hash;
  `--check` reports missing/stale/current; `--remove` deletes only the
  managed section)
- `gemini` → `~/.gemini/settings.json` hooks + `GEMINI.md`;
  `copilot` → `.copilot-plugin/plugin.json` +
  `.github/copilot-instructions.md`; `aider` → `.aider.conf.yml` +
  `.aider/BEADS.md`; `junie` → `.junie/guidelines.md` + MCP config;
  `kiro`/`windsurf`/`cody`/`kilocode` → rules/steering files

Verified live: plain `bd init` (no `--skip-agents`) auto-installed AGENTS.md,
CLAUDE.md, `.claude/settings.json`, `.codex/*`, `.cursor/*`, and
`.agents/skills/beads/SKILL.md`.

**Instruction-content strategy** is profile-based: `full` profile (complete
command reference) for AGENTS-first tools, `minimal` profile (pointer to
`bd prime`, ~60% smaller) for hook-enabled tools, since `bd prime` injects
full context at session start/compaction. `bd onboard` prints a paste-able
snippet for unsupported agents. `AGENT_INSTRUCTIONS.md` in the repo is for
*beads development itself*, not shipped to user projects.
(docs/getting-started/ide-setup.md "Template Profiles"; README.md;
AGENT_INSTRUCTIONS.md header)

**Git hooks** (via `bd hooks install`, or auto by `bd init`): five managed
hooks — pre-commit (chained hooks; refreshes `issues.jsonl` when
`export.auto`), post-merge, pre-push, post-checkout, prepare-commit-msg
(agent-identity trailers). Thin marker-delimited shims (`BEGIN/END BEADS
INTEGRATION v<ver>`) exec `bd hooks run <name>` under a 300s timeout; hook
generation is embedded in the binary, worktree-aware, and versioned — `bd
doctor` flags stale hooks. (cmd/bd/hooks.go; `bd hooks --help`;
docs/core-concepts/sync-concepts.md "Hooks"; AGENT_INSTRUCTIONS.md)

**Claude Code plugin** ships in-repo: `plugins/beads/.claude-plugin/
plugin.json` (plus `.codex-plugin/` and `.copilot-plugin/` manifests), with
SessionStart + PreCompact hooks running `bd prime`, a `skills/beads/`
directory of command docs, and a root `.claude-plugin/marketplace.json` for
marketplace install. (plugins/beads/; .claude-plugin/marketplace.json)

**Structured (non-CLI) interfaces:**

- **`bd serve`** — a loopback HTTP JSON API, OpenAPI-3.0 spec-first
  (`internal/httpapi/spec/openapi.v0.yaml`, types generated via
  `make api-gen`). Operations include `getContext`, `listReadyWork`,
  `countReadyWork`, `listIssues`/`queryIssues`/`countIssues`, `getIssue`,
  `createIssue`, `updateIssue`, `claimIssue`, `releaseIssue`, `closeIssue`,
  `reopenIssue`, `compareAndSetMetadata`, `sweepIssues`, `deleteIssues`,
  comments, related, dependency tree/cycles, stats, events watch. Optional
  bearer-token auth (`--auth-token-file`, rotation by append/remove line);
  `--allow-non-loopback` requires a token; no TLS; hooks deliberately do not
  fire; refuses `--readonly`. (`cmd/bd/serve.go` Long help; the spec)
- **MCP** — `bd` itself ships **no** MCP server. MCP support is a separate
  Python package `beads-mcp` (`pip/uv tool install beads-mcp`) that wraps the
  `bd` CLI and parses its `--json` output
  (`integrations/beads-mcp/src/beads_mcp/bd_client.py` literally shells out).
  Docs recommend CLI+hooks over MCP when shell is available (context cost
  ~1–2k vs 10–50k tokens). There is no MCP sync tool — sync stays on the CLI.
  (docs/integrations/mcp-server.md; integrations/beads-mcp/)
- **JSON coverage** — `--json` is a persistent root flag (also `--format` and
  a `json` config key), and the AGENT instructions mandate adding `--json` to
  every new command; `bd schema` prints the JSON Schema of `--json`/export
  output. Effectively all read/write commands accept it.
  (cmd/bd/main.go:847; `bd schema --help`; AGENT_INSTRUCTIONS.md "Adding a
  New Command")

---

## 6. Worktree / multi-agent behavior

**One `.beads` per repo, shared across worktrees.** `bd` discovers the
repository's `.beads` from linked worktrees (a `redirect` file handles the
pointer); issue changes live in Dolt, not on the git branch. `BEADS_DIR`
overrides discovery entirely (external shared workspace, or git-free mode).
The old experimental `sync.branch` workflow with hidden
`.git/beads-worktrees/` was **removed**; cleanup instructions exist.
`bd worktree` manages git worktrees. (docs/reference/worktrees.md;
gitignore template; `bd worktree --help`)

**Embedded-mode concurrency is subtler than "single writer" suggests.** The
docs still say "single writer (one process at a time)", but the current store
holds no lock: "The dolthub/driver/v2 handles its own concurrency internally.
File-level locking is only used during bd init … the store itself does not
hold any lock." Each method opens a short-lived connection in an explicit tx,
minimizing the engine's internal write-lock hold time, and DSN config carries
unbounded backoff retry. A multi-process stress test exists
(`TestConcurrencyMultiProcess`, 10 procs × 5 iters). **Verified live**: 5
concurrent `bd create` processes and 2 racing `--claim`s all worked correctly
on one embedded DB — claims arbitrated by CAS, loser got
`ErrAlreadyClaimed`. Earlier versions (pre-1.0) did hold an exclusive flock
for store lifetime (CHANGELOG §1.0.0, GH#2571). So: concurrent embedded
writers are *serialized*, not excluded — safe but not parallel; the docs still
recommend server mode when "multiple agents" or "concurrent writers" are the
point. (internal/storage/embeddeddolt/store.go:34-42, open.go `OpenSQL`
backoff; docs/architecture/dolt.md; README.md "Storage Modes"; experiment)

**Concurrent-update machinery beyond claims:** leases + `bd reclaim` for
dead-worker recovery (§3); `bd merge-slot` — a per-project exclusive-access
bead to serialize conflict-prone work; `claim.pools` config lets any actor
claim an issue assigned to a pool alias; `bd update --if-assignee /
--if-status` for atomic guarded reassigns; assignees are plain strings — "no
agent registry". (docs/multi-agent/coordination.md;
internal/storage/issueops/claim.go; `bd prime` output)

---

## 7. Identity / actor model

- Actor resolution order: `--actor` flag > `BEADS_ACTOR` env > `BD_ACTOR`
  (deprecated) > `config.yaml actor` > `git config user.name` > `$USER` >
  `"unknown"`. (cmd/bd/main.go:766-816)
- Actor is **caller-asserted provenance, not authenticated identity** —
  "any local process can pass any --actor"; the same is true on the HTTP API.
  (issueops/claimer.go; cmd/bd/serve.go)
- Every mutation writes an `events` row (id, issue_id, event_type, actor,
  old_value, new_value, comment, created_at) — visible per issue via
  `bd history <id> --events` and in `bd show`. `bd history <id>` shows
  Dolt-commit version history. (internal/storage/schema;
  cmd/bd/history.go; verified live — created/claimed events carry actor)
- Optional durable **events journal** (`events-journal` config /
  `BD_EVENTS_JOURNAL`) for consumers mirroring mutations, applied by store
  factories so `bd doctor --fix` writes are covered too;
  `bd events` reads/manages it. (internal/eventsjournal; cmd/bd/events.go)
- Optional `audit.enabled` writes `.beads/interactions.jsonl` sidecar via
  `bd audit record/label`. (docs/reference/configuration.md)
- `created_by`/`owner` fields on issues: actor name + git email respectively
  (verified live). Commit convention: `(bd-abc)` suffix enables `bd doctor`
  orphan detection; `Agent-Signature:` trailer spec in
  engdocs/AGENT_SIGNING.md; prepare-commit-msg hook adds identity trailers.
  (AGENT_INSTRUCTIONS.md; cmd/bd/hooks.go)

---

## 8. Maturity / ops

- **License:** MIT (LICENSE; plugin.json also declares MIT).
- **Language:** Go (module `github.com/steveyegge/beads`, go 1.26.5 /
  toolchain 1.26.7; repo moved to gastownhall org — go.mod still uses the old
  path). MCP sidecar is Python.
- **Platforms:** macOS, Linux, Windows, FreeBSD.
- **Install:** Homebrew (`brew install beads`), npm (`@beads/bd`), curl
  install script (checksum-verified), PowerShell `install.ps1`, `go install`
  (CGO=1 for embedded-capable), Nix flake, winget, AUR.
  (README.md; docs/getting-started/installation.md; winget/, flake.nix)
- **Releases:** semver + Keep-a-Changelog CHANGELOG. 1.0.0 (2026-04-03),
  1.1.0 (2026-07-04), 1.1.2 (2026-07-26), 1.2.2 (2026-08-15), 1.3.0
  (2026-09-15), each preceded by RCs — roughly monthly-minor cadence.
  **Ops caveat:** v1.2.1 was an *accidental release that was pulled*; v1.2.2
  is a recovery re-ship of 1.1-era code, making the 1.2.2→1.3.0 upgrade cross
  two release lines (28 migrations). A recovery runbook exists
  (docs/recovery/accidental-1-2-1-release.md). (CHANGELOG.md; `gh release
  list`)
- **Repo stats (2026-09-21):** ~27.3k stars, ~1.85k forks, 1,234 open issues,
  pushed daily. (`gh api repos/gastownhall/beads`)
- **Dependency pin worth noting:** Dolt CLI pinned to 2.2.0 due to an
  upstream `DOLT_RESET('--hard')` regression in 2.3.x — the pin exists to
  protect `bd flatten`/`bd admin compact`/merge-settle.
  (docs/architecture/dolt.md)
- **Telemetry:** on by default (opt-out) — sends command names + version/OS
  to `https://gastownhall-eventsapi.com/mp/collect`; `bd metrics off`,
  `BD_DISABLE_METRICS=1`, or `DO_NOT_TRACK=1` to disable. Relevant when
  evaluating `bd` as a dependency. (AGENT_INSTRUCTIONS.md "Telemetry")
- **Open-issue signals:** the tracker itself is heavily triaged (needs-triage
  automation); notable current items include a performance regression —
  embedded `pull` went ~1min → ~35min on a 3.8k-issue DB (issue #6605), a
  claim-idempotency edge across actor roles (#6611), and gate/doctor edge
  fixes. The volume of narrowly-scoped correctness issues suggests a fast-
  moving surface — pin versions and test upgrades. (`gh issue list`)
- **Upgrade posture:** binaries refuse DBs migrated ahead of them; remote-
  backed DBs need a designated-migrator procedure; `bd upgrade review` shows
  the delta. This is well-engineered but operationally nontrivial — budget
  for it if embedding `bd` in a managed fleet. (docs/getting-started/
  upgrading.md)

---

## 9. Gaps and commonly-misunderstood points

1. **`issues.jsonl` is not sync and not a backup.** Older write-ups describe
   "SQLite + JSONL synced through git" — that architecture is gone. Sync is
   `bd dolt push/pull` over `refs/dolt/data`; JSONL is an opt-in export and
   legacy fallback only. (docs/core-concepts/sync-concepts.md)
2. **"Single writer" is not a hard exclusion.** Embedded mode serializes
   writers via the Dolt driver's internal locking (verified: concurrent
   claims and creates across processes work); the docs' phrasing is a sizing
   recommendation, not a mutex. For genuinely parallel multi-agent writes,
   server mode is still the documented answer.
3. **There are three modes, not two.** `--proxied-server` (bd-managed local
   `dolt sql-server` + proxy) is the third path and the one CGO-less
   binaries steer you to.
4. **Embedded requires CGO.** `go install CGO_ENABLED=0` or a nocgo build
   gives you a server-mode-only `bd` — easy to miss in minimal containers.
5. **Actor ≠ auth.** Identity is asserted, unaudited-by-authn provenance; any
   local process can claim "as" anyone. Claims are safe against races, not
   against impersonation.
6. **Claim ≠ permanent ownership.** Claims carry 5-min TTL leases with
   heartbeat/reclaim semantics — a claimed issue is recoverable by
   `bd reclaim` once the lease lapses. This is the dead-worker path the prior
   doc's "crash" scenario needs.
7. **Molecule = epic, proto = labeled epic.** No separate object store;
   formulas are TOML/JSON files; wisps are `dolt_ignored` tables that never
   sync. Step `on_complete` hooks are not implemented.
8. **No native MCP/Go SDK.** The MCP path is a Python wrapper around CLI
   `--json`; the native structured interface is `bd serve` (loopback HTTP,
   OpenAPI spec-first).
9. **Auto-commit differs by mode.** Embedded commits Dolt history per write;
   server mode defaults `auto-commit: off` (per-write `DOLT_COMMIT` under
   concurrency caused read-only errors). (`docs/architecture/dolt.md`)
10. **`bd doctor --fix` is the repair front door** (hooks, gitignore,
    conflicts, orphans) — not separate `repair`/`recover` commands.
11. **Telemetry is opt-out.** On by default; disable via `bd metrics off` /
    env.

---

## Verified vs corrected claims (vs the prior research doc)

**Verified:**

- "Distributed graph issue tracker for AI agents, powered by Dolt" — current
  README tagline; Dolt is the only backend (SQLite fully removed, v0.58.0).
- `bd ready`, `bd show`, `bd update --claim` (atomic), `bd dep add`,
  `discovered-from`, `bd close`, `bd dolt push/pull` — all exist and behave
  as described; claim atomicity verified experimentally (CAS + retry +
  verify-by-re-read).
- `bd setup claude` / `bd setup codex` — real; installs hooks/instructions/
  skills as described.
- "SQLite + JSONL is no longer the main architecture" — confirmed, and
  stronger: SQLite is deleted entirely.
- Formulas/Molecules/Gates exist and are first-class — confirmed.
- ~27k stars / ~1.8k forks, active development — confirmed (27,327 / 1,850 /
  1,234 open issues, 2026-09-21).
- `bd remember` persistent memory injected by `bd prime` — confirmed.

**Corrected / refined:**

- Dependency types were understated: the doc listed 4; there are ~19 defined
  types (10 CLI-settable + internal/specialized ones like `conditional-
  blocks`, `waits-for`, `duplicates`, `delegated-from`).
- "Atomic claim" is real but incomplete: claims also carry a **lease**
  (5-min TTL, `bd heartbeat`, `bd reclaim` for dead workers) — the doc's
  crash-recovery case is handled by this machinery, which it didn't mention.
- "Embedded = single writer" needs nuance: concurrent processes serialize
  through the embedded driver rather than being excluded (verified live);
  server mode remains the documented answer for true parallelism.
- Formula/Molecule/Gate description was vague: formulas are TOML/JSON files
  cooked into *protos* (template-labeled epics) and poured into molecules
  (plain epics+children); gates are beads of type `gate` with concrete await
  types (`human`/`timer`/`gh:pr`/`gh:run`/`bead`) — with known multi-rig
  limitations (GH#5861).
- The doc implied MCP integration is part of `bd`; actually it's a separate
  Python package wrapping the CLI. `bd`'s own structured surface is
  `bd serve` (loopback HTTP/OpenAPI).
- Missing entirely from the prior doc: proxied-server mode, CGO requirement
  for embedded builds, `bd sync` conflict-settle loop and its exit codes,
  merge slots, claim pools, guarded `--if-assignee/--if-status` updates,
  wisps/`dolt_ignored` storage, `bd bootstrap` clone flow, schema-version
  guard and designated-migrator upgrade procedure, compaction tiers (Tier 1
  only, AI-key required), opt-out telemetry, and the v1.2.1/v1.2.2 release
  incident.
