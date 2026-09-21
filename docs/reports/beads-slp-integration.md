# Beads integration directions for SLP

Internal working note, not end-user documentation. Companion to
[beads-research.md](beads-research.md) (primary-source facts about
`gastownhall/beads`) and the uploaded landscape survey
`agent-issue-tracker-research.md` (Beads vs Grite vs GitHub/Linear).

This file answers one question: **where could a work-graph tracker (`bd`)
plug into SLP without breaking its contract** — and what must stay outside it.

## 1. What SLP is missing today

SLP deliberately keeps Paseo as the only control plane and puts all
coordination in policy text. Work state currently lives in:

| State | Where it lives today | Weakness |
|---|---|---|
| Bounded assignment | `initialPrompt` / `assignmentFile` | one-shot; no durable identity |
| Lead project checkpoint (decisions, owner map, gate map) | "task's permitted notes or session" | per-session; dies with context unless manually persisted |
| Owner map / formation records / creation receipts | owner timeline or `.local-checks/` notes | free-form; not queryable |
| Dependency between tasks | prose inside assignments | no `ready` computation; Lead re-derives |
| Discovered work (bug found mid-task) | report text to Lead | no `discovered-from` provenance edge |
| Review-gate state (axis→seat, candidate, verdicts) | checkpoint + handback text | no structure; re-review bookkeeping manual |
| Settlement ledger (seats, heartbeats, terminals) | handback resource lists | reconstructed each time |
| Supervisor causal notebook | `.paseo-slp/notebook.md` | durable but prose; not linked to task state |

Every row is a place where an agent must *rebuild* state from conversation
instead of *querying* it. That is exactly the problem beads exists to solve:
`bd ready` (unblocked work), `bd show` (task reconstruction), `--claim`
(atomic ownership), typed deps (`blocks`, `parent-child`, `discovered-from`),
per-issue comments/history, plus Dolt-backed versioning and `refs/dolt/data`
sync.

Verified properties that matter here (see companion research for citations):

- Worktrees of one repo share a single `.beads` — SLP's worktree lanes see
  the same graph.
- Embedded mode serializes writers through the driver's internal lock
  (verified live: concurrent creates and racing claims resolve correctly);
  "single writer" means contention errors are possible under load, and
  server mode (`dolt sql-server`, pinned Dolt 2.2.0) is the documented
  multi-writer answer. A third `bd init --proxied-server` mode exists for
  CGO-less builds — embedded requires CGO.
- `bd update --claim` is a real CAS transaction (racing claimant gets
  `ErrAlreadyClaimed`) **and a 5-minute lease**: `bd heartbeat` renews,
  `bd reclaim` recovers a dead worker's claim — built-in crash recovery.
- Both coordination directions exist: `bd assign <id> <actor>` +
  `bd ready --assignee <actor>` (orchestrator-push) and
  `bd update --claim` / `bd ready --claim` (worker-pull).
- `bd human <id>` and `bd gate` (`human`/`timer`/`gh:run`/`gh:pr`/`bead`
  types) — a gate is a bead that blocks its waiters until the world catches
  up; human gates close only via `bd gate resolve`.
- "Merge slots" in `docs/multi-agent/coordination.md` — an explicit
  primitive to serialize conflict-prone integration work.
- `bd prime` injects ~1-2k tokens of workflow context at session start via
  a SessionStart hook — and fires again after resume/clear/compaction.
  Agent-context profiles (`conservative` default / `minimal` /
  `team-maintainer`, set via `agent.profile` config or `BD_AGENT_PROFILE`
  env) explicitly subordinate beads' block to "user, repository, and
  orchestrator instructions" — beads already models orchestrator precedence.
- `.beads/*` is gitignored except shared content like `.beads/formulas` —
  checkout-local state, no working-tree pollution, same posture as
  `.paseo-slp/`. `bd sync` wraps dolt pull → conflict-check → recompute →
  push over `refs/dolt/data`; `issues.jsonl` is a passive export only.
- Structured interfaces beyond the CLI: `bd serve` is the native surface —
  a spec-first OpenAPI HTTP API on loopback (bearer-token auth, no TLS,
  hooks don't fire). `beads-mcp` is an external Python wrapper shelling out
  to `bd --json`; there is no in-binary MCP server. For Codex, beads ships
  a skill (`.agents/skills/beads/`).
- ~19 dependency types (4 blocking: `blocks`, `parent-child`,
  `conditional-blocks`, `waits-for`); ~10 exposed on the CLI.
- Actor identity is **asserted provenance, not authenticated**
  (`--actor`/`BEADS_ACTOR`/git user.name); audit lives in the `events`
  table (`bd history --events`) plus an opt-in events journal.
- Ephemeral layer exists: "wisps" are `dolt_ignored` tables that never
  sync — scratch work need not enter the shared graph.
- `bd init` is not inert: it installs host/repo hooks
  (`.claude/settings.json` SessionStart → `bd prime --hook-json`, Codex/
  Cursor hooks, managed AGENTS.md/CLAUDE.md sections, git hooks via
  `bd hooks install`). Adoption footprint = installation authority.
- Ops notes: MIT, Go 1.26, monthly-ish releases but a pulled v1.2.1 +
  recovery v1.2.2 incident, ~1.2k open issues incl. a pull perf
  regression, **opt-out telemetry** (a policy decision to record), schema
  guard + designated-migrator upgrade dance.
- `bd` works without git; embedded mode adds no daemon process.

## 2. Fit map — beads primitive ↔ SLP concept

| beads primitive | SLP concept it could serve | Caveat |
|---|---|---|
| issue + status + assignee | bounded assignment + seat ownership | claim is intent, not authority — assignment stays source of grant |
| `bd ready` | Lead's "what can start now" after a report lands | deterministic; replaces re-derivation |
| `blocks` / `parent-child` | DEPENDENCY_REQUEST handling, lane decomposition | tracker records the edge; Lead still owns the split |
| `discovered-from` | "found while working on X" provenance | maps 1:1 onto Peer→Lead discovered-work reports |
| comments / notes / history | project checkpoint fields, causal evidence trail | could carry per-issue worklog; notebook keeps governance semantics |
| `bd assign` + `bd ready --assignee` | Lead assigns bounded work to a named seat | orchestrator-push — matches SLP delegation, not worker-pull |
| claim lease + `bd heartbeat`/`bd reclaim` | worker-crash recovery, stale-claim detection | reclaimed ≠ settled — verify old owner before reassigning (same rule as interrupted `create_agent`) |
| `bd human` / `human` gate | `must_ask` boundary, BLOCKED pending Human decision | a Human-decision dep becomes an explicit gate only the Human resolves |
| merge slots | "one integration writer" / serialized handback | tracker-level serialization of the conflict-prone merge step |
| wisps (non-synced tables) | per-seat scratch state | ephemeral by design; never evidence |
| formula / molecule / gate | protocol "Task classes and gates" rows (Engineer → Reviewer + QC) | duplication risk — policy text must remain authoritative (see §3) |
| `bd prime` / SessionStart hooks | session-entry instruction channel | **collision seam**: SLP injects role bytes at session entry too — coexistence + precedence need a rule |
| `BD_AGENT_PROFILE` | authority alignment knob | `conservative` (no commit/push) matches SLP's grant model; settable per-seat via env |
| `bd remember` + compaction | cross-session project memory | overlaps notebook; needs a boundary rule |
| `bd dolt push/pull` | cross-machine / cross-run graph sync | optional; embedded local suffices per repo |
| `beads-mcp` | structured tool surface for seats | alternative to CLI in spawn kits |

## 3. Boundary rules — what beads must never become in SLP

These follow from `docs/contract.md` + `docs/architecture.md`, not from taste:

1. **Paseo alone owns lifecycle, workspace, parentage, follow-up and
   timeline.** Beads holds *task* state, never seat state. A `bd` claim does
   not create parentage, a report route, or a sidebar tree — only
   agent-scoped `create_agent` does. Beads must not become a second
   control plane (no spawning, no notifications, no "bd says X is ready →
   auto-spawn").
2. **Authority lives in the assignment, not the tracker.** `bd update
   --claim` records who *took* work; it cannot grant write scope, commit or
   push rights. SLP policy must say: assignment creates the bead (or names
   it); a claim without a matching assignment is evidence of drift, not
   ownership.
3. **Orchestrator-push, not worker-pull.** Beads' canonical loop is "agent
   runs `bd ready`, claims what's free", but `bd assign` +
   `bd ready --assignee` support push natively. SLP's model is Lead assigns
   a bounded outcome to a created seat. The natural mapping: Lead writes
   the graph (create issue, set deps, `bd assign <id> <seat>`), the Peer
   transitions status (`--claim` on receipt, close at handback). Peer-side
   `bd ready` self-assignment contradicts disposition/brief binding and
   stays out of policy unless explicitly granted.
4. **Review gates stay SLP gates.** A beads Gate/Formula must not silently
   *replace* the split-axis rule (Spec ∥ Standards seats, never merged, a
   required gate BLOCKED rather than skipped). A formula may *instantiate*
   the shape, but the invariant lives in review-gates.md, and "the tracker
   showed a gate" is not evidence the gate ran — verdicts still come from
   seat reports bound to a frozen candidate. Conversely, beads' `human`
   gate/`bd human` is a *good* carrier for the SLP `must_ask` boundary: a
   Human-only decision becomes a blocking bead that only the Human resolves
   (`bd gate resolve`), and the dependent seat leaves `bd ready` until then
   — the graph itself encodes the pause instead of relying on memory.
5. **The tracker is evidence, not truth** — same posture as labels/statuses:
   a bead marked `in_progress` proves a recorded claim, not that work is
   happening; acceptance still requires artifact + candidate + checks.
6. **One writer per moving scope applies to the graph too.** Embedded mode
   serializes short writes safely (verified), so concurrency is an ops
   question more than a correctness one. Still: Lead-as-sole-writer (Peers
   report, Lead records) keeps the audit trail attributable and the
   authority story clean; letting every seat write needs
   `BEADS_ACTOR` discipline since actor identity is asserted, not
   authenticated. Server mode only if contention actually appears.
7. **No new secrets/daemons/policy broadcasts.** Embedded mode adds no
   process. `bd serve` (HTTP) and beads-mcp (Python wrapper) both add a
   per-seat or per-repo service — install/authority decisions, and config
   surfaces the plugin does not own. **Telemetry is opt-out** — the repo's
   adoption decision must record whether it is disabled.
8. **Session-entry channel coexistence.** `bd prime` (via `bd setup
   <family>` hooks or instruction blocks) and SLP's role-bundle injection
   both write into a seat's session-entry context. They are compatible by
   design — beads' managed block declares itself subordinate to
   orchestrator instructions — but the adoption decision must record: which
   channel carries bd guidance (repo hook vs assignment text vs spawn-kit
   note), that `bd setup` writes into the repo/host and therefore needs the
   same authority as other installation steps, and that seats run
   `BD_AGENT_PROFILE=conservative` (or unset) — `team-maintainer` would let
   a session-close hook push/sync, which SLP only grants explicitly.
9. **`.beads/` treatment mirrors `.paseo-slp/`**: checkout-local state,
   gitignored except formulas. Linked git worktrees share the source repo's
   `.beads` via a `redirect` pointer file; a Paseo `isolation=worktree`
   workspace whose checkout sits outside the source tree can still be bound
   to the shared graph explicitly with `BEADS_DIR` — record which binding
   each lane uses (see research report §6).

## 4. Integration levels

Ordered by increasing coupling. L0 is doable today with zero package change;
each level above it needs its own evidence before adoption.

### L0 — Policy-only adoption (repo tactic, no code)

A repository that wants beads records it in `.paseo-slp/workspace-protocol.md`:

- frontmatter/state: `work_tracker: beads` + who decided;
- Lead creates a bead per bounded assignment, `bd assign`s it to the seat,
  and records `beadId` in the assignment text and the formation record;
- a `must_ask` dependency becomes a `human` gate bead — the blocked seat
  leaves `bd ready` until the Human resolves it;
- Peers `--claim` their assigned bead on receipt and write
  findings/next-step into it before handback; discovered work →
  `bd create --deps discovered-from:<id>`;
- Lead uses `bd ready`/`bd dep tree`/`bd list --assignee` to schedule
  continuations instead of re-deriving from prose;
- merge/conflict-prone integration steps use beads' merge-slot pattern;
- a dead seat's claim is recovered via `bd reclaim` *after* owner
  settlement is verified — the lease lapsing is a signal, not settlement
  proof;
- handback names bead IDs for all open work; settlement sweep includes
  "no claimed-but-abandoned beads" and all gates either resolved or
  explicitly handed off.

Cost: a protocol section + onboarding skill note. Risk: instruction-only —
agents may forget under compaction; mitigated by putting the `bd` commands
in the per-seat assignment (visible prompt), which is exactly the Agent-UX
channel beads itself relies on.

### L1 — Read-only probe + spawn-kit hints (small code)

Same shape as `monitor.mjs`/`notebook.mjs` (read-only, emits candidates/gaps,
no verdicts):

- `slp.mjs workgraph <repo>` (or `monitor` request field `beadsDir`):
  scan `.beads` state and emit candidates — `ready-unclaimed`,
  `claimed-stale` (claimed, no activity past threshold), `blocked-chain`
  (downstream of a dead owner), `unsettled-open` (open beads at settlement
  sweep). Every failure → gap, never crash. One writer (stateFile
  checkpoint), like monitor.
- Add `bd` command signatures to `spawn-kit.mjs` for orchestrating roles so
  seats don't pay CLI-discovery tax; Peer assignments carry the exact
  commands they may run.

Cost: one module + tests + contract row. Risk: low; probe is advisory.

### L2 — Lifecycle wiring (planner + evidence)

- `prepare`/`handoffPlan` accept `beads.issueId` (optional): the emitted
  assignment references it, and the handoff packet carries it so a
  replacement seat rehydrates via `bd show` instead of transcript
  archaeology. Handoff keeps its current required fields — the bead is an
  *extra evidence pointer*, not a substitute for settlement proof.
- `snapshot`/acceptance records could pin `bd` graph digest alongside the
  git snapshot (work-graph state bound to candidate identity).
- E2E: a new evidence kind (e.g. `workgraph`) — a `bd` export captured at
  seal — supporting U3 (topology/ownership) and U6 (honest handback) with a
  machine-checkable trail of claims/deps/discoveries.

Cost: launch.mjs fields, evidence registry row, e2e collector support,
contract + guide-coverage updates. Risk: medium — this is the point where
beads becomes load-bearing in proofs; the proof model must tolerate a
missing/corrupt `.beads` (treat as evidence gap, not BLOCKED-by-crash).

### L3 — Formulas encoding workflow shapes (deliberate, probably not worth it)

Encode the protocol's task-class shapes (`Engineer → Reviewer + QC`…) as
beads formulas so spawning a class instantiates the whole molecule. Appeal:
one command builds the graph. Risk: two sources of workflow truth (policy
text vs formula file) that can silently diverge — the SLP failure mode this
package exists to prevent is "the artifact claims a gate it didn't run".
Recommendation: only revisit after L0–L2 prove the base mapping; if done,
formulas are generated *from* the protocol file (checked generation), never
hand-edited.

## 5. Non-goals (all levels)

- Beads does not replace: Paseo parentage/notifications, the Lead checkpoint
  judgment, the Supervisor causal notebook's hypothesis→outcome semantics,
  the peer pool, Jev routing, or review-gate rules.
- No `bd`-triggered automation (auto-spawn on ready, hooks that mutate git).
- No shared human backlog claim — GitHub/Linear stay the human-facing
  tracker; beads is the team's internal work graph (hybrid pattern from the
  landscape doc).

## 6. Open questions for the POC

The right next step is a bounded dogfood, matching the landscape doc's POC
shape but aimed at SLP seams:

1. Writer model: Lead-sole-writer vs seat-writers under embedded mode —
   measure lock errors/latency with N=4 seats doing concurrent short writes;
   verify `BEADS_ACTOR` attribution lands in the events table.
2. Worktree sharing: confirm a Paseo `isolation=worktree` workspace resolves
   the shared `.beads` — via redirect when linked, `BEADS_DIR` when not.
3. Cold-start: new seat given only `bd show <id>` + assignment — does it
   reconstruct context without transcript?
4. Crash: kill a Peer mid-task; does `claimed-stale` + `bd show` let a
   replacement resume correctly?
5. Compaction/resume: Lead after compaction — does `bd` graph + checkpoint
   beat re-derivation?
6. Evidence: does a `bd` export make U3/U6 review materially easier?
7. Token cost: `bd show/ready` vs equivalent timeline re-reads.

Suggested first dogfood: this repository, one bounded feature, Lead writes
the graph, two Engineer lanes in worktrees, split-axis review — L0 policy
only, no code.

## 7. Recommendation

Adopt **L0 now** as an optional per-repo tactic (template text + onboarding
note), design **L1** as the first package change (probe + spawn-kit), and
treat **L2** as conditional on the POC answers in §6. Keep beads strictly on
the "work state" side of the line in §3 — the moment it starts deciding who
works on what, it has crossed into Paseo's control plane and into Lead's
authority, both of which are contract violations.

Dependencies/risks to track: beads release cadence and schema-version guard
(upgrades are one-writer migrations), Dolt operational surface in server
mode, and the project still being young — the abstraction boundary in §4
(assignment carries `beadId`, probe reads `.beads`) keeps a future swap to
e.g. Grite a tactic change, not a rewrite.
