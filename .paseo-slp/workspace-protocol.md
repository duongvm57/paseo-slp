---
version: '3'
owner: 'duongvm (Human)'
applies_to: 'paseo-slp source repository'
last_reviewed: '2026-09-22'
routing_intent: 'pinned'
supervisor_notebook: '.paseo-slp/notebook.md (owner: Supervisor)'
decided_by: 'duongvm (Human)'
decided_at: '2026-09-22'
---

# Workspace Protocol

Supervisor and Lead read this file when the assignment lands — before any
reply or decision that depends on repository tactics, not only before
delegation. Supervisor also reads it when assigned a protocol audit. Lead
passes only task-relevant constraints to the Peer.

This is a starting template of repository tactics. The Human's current assignment
controls authority. Complete unknown fields from repository evidence and the
assignment before the decision that depends on them; do not treat blanks as grants.
The defaults below can be adapted under the repository's policy mandate.

## Status and project characteristics

Owner, version, review date, scope, routing intent and
the Supervisor notebook live in the YAML frontmatter above — update it when
decisions change; the frontmatter is the single source for those fields.

- Criticality, dominant risks and expensive-to-reverse decisions: establish per repo.
- External effects and cost/model budget: use explicit assignment boundaries.

## Decision matrix

Lead selects methods, routes bounded work, reconciles technical decisions and accepts
project artifacts within the assignment. Human decides product/portfolio changes,
important owner-reserved architecture contracts, irreversible/cost trade-offs beyond
the grant and external effects. Edits, commits, pushes, deploys, host configuration
and other repositories each follow the applicable authority; profile permissions
do not supply it. Record additional repository-specific reserved decisions here.

Mark `must_ask` on every boundary where the Human alone decides: product and
priority, owner-reserved contracts, irreversible or material-cost trade-offs,
external effects and subjective acceptance. A missing must_ask answer pauses the
dependent work — it never defaults to Lead.

## Task classes and gates

| Class | Default shape and evidence gate |
|---|---|
| Default — any bounded task | `Engineer → Reviewer` — split-axis seats (Spec, Standards), never one merged seat; `ACVERDICT` on the frozen candidate. Lead may implement tiny tightly coupled work if the assignment allows. |
| Hard-to-reverse or high-blast — `src/` routing/delegation semantics and their `plugin/` mirrors (`plugin/shared/` — `contracts.ts` schema, `routing-vocabulary.ts`, `families.ts`, `archetypes.ts`, `snapshot-catalog.ts`; `plugin/server/` and `plugin/index.server.ts` request handlers), shipped doctrine (`skills/`, `src/templates/`, `src/references/`, `src/roles/`, `src/delegation.md`), this file (`.paseo-slp/workspace-protocol.md`), packaging/payload/release | `Engineer → Reviewer` (Reviewer = split-axis seats); full `node --test` output + candidate identity + `ACVERDICT`. Verification is the Lead's own duty — re-run the established checks and pin the snapshot on the same frozen candidate before and after the gate; for doctrine text the Lead dry-runs the procedure on a scenario. A UI-only `plugin/client/` change — render, copy or layout altering no semantics — stays Default. |
| Large dependency in a different domain | Separate bounded lane or dependency Lead within authority; explicit contract, handback and integration owner. |

These rows are defaults, not obligations — Lead judges each task by its
nature and may lighten or strengthen the seats; a tiny change inside a
risky area stays Default. Escalate to `Analyst → Architect → Engineer →
Reviewer` (Reviewer = split-axis seats) when the task touches routing/delegation semantics or the
spec cannot yet say what "done" means. For council, default to two
distinct lenses, at most one challenge/response round
per material proposition, then Lead reconciles. Add another lens only for an
unresolved decision-changing question worth the cost. These are repo defaults,
not universal role requirements. Escalate foundation uncertainty before tests pin
an undecided API or representation. In a new domain, establish enough Human framing
to locate owner boundaries before foundational implementation.

## Ownership and integration

Inspect existing changes and active writers. Record owned/excluded scopes and return
recipients. Concurrent writers require separate worktrees and non-overlapping scope
ownership; otherwise serialize handback. Review only paused, stable candidates.
Assign one integration writer, preserve unrelated changes and reverify the integrated
candidate. Do not infer filesystem isolation from workspace IDs.

## Routing and skills

`routing_intent` in the frontmatter is `pinned`, `inherit` or `empty`, plus who
decided and when — never restate option IDs there; the catalog file is the
source of truth. An absent repository catalog with recorded inherit intent is a
decision, not an accident; an absent catalog with pinned or no recorded intent
is incomplete onboarding.

Read slp-supervisor/slp-lead saved profiles for those roles. Peer delegation uses
this repository's .paseo-slp/slp-routing.json pool; when the repository has no
catalog, the user-scope pool ($PASEO_HOME/slp-routing.json, default ~/.paseo) is
the declared fallback. Onboarding populates
Human-approved provider/model/settings options and suitability descriptions; an
empty init catalog is a setup scaffold, not ready for Peer delegation, and remains
authoritative over the user-scope pool until removed.
Lead selects a ready Peer option for each task using suitableFor, avoidFor, notes,
priority and budget. Record the rationale, option ID/hash and actual launch bundle
(under armed Jev routing the reason trail is the receipt's distribution, not prose).
Validate against fresh provider discovery; do not inherit a saved slp-peer profile
or Lead settings. Apply the installed orchestration session continuity policy:
keep existing context for corrections and re-review; establish a separate session
when a new independent seat is required. No catalog in either scope or no
eligible runtime requires onboarding setup; a missing repository catalog falls
back to the user-scope pool, never to another repository's catalog.
Jev-assisted routing is a per-daemon toggle (jev.capabilities.routing), not a
repository setting: when armed, Lead authors a routing brief and runs
`slp route-decide` for the receipt prepare requires; a decline or transport
failure fails closed — escalate rather than retry, and disabling is Human
authority via the Manager Jev card. Shadow evaluation precedes arming: under an
enabled-but-unarmed daemon route-decide still emits a receipt, Lead chooses
independently and prepares with both, and the plan records jevChoice/declined;
the Human pre-registers exit criteria (agreement rate + asymmetric error class)
and arms only once the recorded pairs satisfy them.

Lead uses macro skills, Supervisor observation/governance skills, Peer task micro
skills. Configure Peer quotaFallback.enabled/optionId in slp-routing.json; default
disabled, targets restricted to existing eligible pool options. Record allowed pool
maintenance, cost limits and
settlement boundaries. Provider changes for existing work require a new-session
handoff; an eligible pool option does not itself grant replacement authority.
Use paseo-slp-onboarding to update tactics and pool while preserving Human choices.
Every seat joining the team is created through agent-scoped create_agent so the
host records the parent link, report route and sidebar tree; prompting a
standalone session can observe work it already owns but cannot carry a new
delegation.
One team's seats share the assignment's workspace by default — read-only review
seats included; a separate workspace needs a declared worktree, repository or
lane-isolation reason recorded with its resulting paths. Keep the
team→parent→workspace→worktree owner map and creation receipts in the owner's
timeline or an authorized notes path so the Human can trace every lane.
Peer skills worth naming in assignments: `writing-for-agents` for
doctrine-text tasks; a test-design skill for test-authoring tasks when installed.

## Roster disposition

| Disposition | Work | Skill | Suggested seat |
|---|---|---|---|
| Scout | Read-only recon (`plugin/`, `src/`, `tests/`) before design | — | `lightweight-recon` |
| Architect | Contract, schema and spec change (`docs/spec/`, `plugin/shared/contracts.ts`, `src/routing-*`) | `writing-for-agents` for doctrine text | `deep-reasoning` |
| Engineer — runtime | `src/`, `bin/`, payload manifest | — | `standard-coding` |
| Engineer — UI | `plugin/client/` (RN primitives, host-parity with `composer/agent-controls`) | — | `standard-coding` |
| Reviewer /Spec | Candidate matches `docs/spec/*` and docs stay in sync | — | `deep-reasoning` |
| Reviewer /Std | `AGENTS.md`, conventions, comment and code smell | — | `standard-coding` |
| Host Verifier | Reinstall plus live UI verify via browser or screenshot on the daemon host | — | Lead self or a peer with exec |
| Proof Auditor | Whether claims carry real evidence — cross-checks outputs against commands run | — | `independent-second-opinion` |

Suggested seats are catalog hints, not assignments — Lead may name a
different seat as the task requires; the `optionId` must exist in the
current pool. Fall back when the hint is unbound or disabled —
`independent-second-opinion` covers a pure-verdict pass.

## Monitoring and heartbeat

Use finish/error/permission notifications first. Lead reports material decisions,
reopen/dependency requests and significant risk changes to the assigned Supervisor.
For short bounded work with adequate events, default to no heartbeat. For long work
or incomplete event coverage, decide and record the observer, reporting route,
cron/timezone, expiry/run bound, evidence checkpoint and stop condition before
creating a fallback heartbeat; the heartbeat prompt names the live checkpoint
or state file to read, never a snapshot of its contents. No universal cadence is prescribed; ownership,
receipts, bounded lifetime and settlement follow references/monitoring.md.
Record the creation/deletion receipts and retain pre-existing monitoring outside
the task.

## Candidate, verification, review, and acceptance

Identify established repo checks for each requested outcome; record exact commands
and the behavior they demonstrate in the assignment. Match evidence to the risk:
integration/failure/cancellation/migration checks or Human visual/playtest/product
evaluation where needed. Coverage and mock-only checks cannot define success.
Use a deterministic snapshot or exact commit with relevant working changes accounted
for; record external proof separately. Review and verdict bind to the same candidate.
Acceptance is not assignment close: keep accepted Peers idle after the accept
sweep so rework keeps its context, and consider a batch archive when the
assignment that formed the team closes and rework has settled. A Human stop
still takes effect immediately; idle retention never runs hidden work or
delays required cleanup.

## Reopen, dependency, and blocked handling

Lead reconciles REOPEN_REQUEST (failed premise) and DEPENDENCY_REQUEST (another owner,
API or scope). BLOCKED identifies a missing decision/prerequisite/capability. After
repeated identical failures, inspect the shared mechanism and prerequisite changes
before retrying; any numeric retry threshold is a repository choice. Owner-only
decisions go through the assigned Supervisor or directly to Human. At handback,
record actual proof, unresolved findings and settlement of task-owned resources.

## Repository specifics (paseo-slp)

- This repo is the paseo-slp package source; the live installation is
  plugin-managed under `~/.paseo/slp-runtime/<candidate-sha>` — the sha
  changes on every activation, so never hardcode it. Managed sessions get
  the verified runtime root + CLI via the injected managed-helpers block;
  outside a managed session, resolve it with `slp.mjs local-target` or the
  provider env (`SLP_RUNTIME_ROOT`). Repo `bin/slp.mjs` works for
  init/routes/verify; prepare/prepare-handoff must run from the installed
  copy.
- Established checks: `npm test` (node --test tests/*.test.mjs), `npm run check`
  (identity), `node bin/slp.mjs verify <dir>`. Run `npm test` isolated from a
  managed session's ambient env — `env -i HOME="$HOME" PATH="$PATH"
  PASEO_HOME="$(mktemp -d)" npm test`, or unset the full `SLP_*` set
  (`SLP_DAEMON_HOME SLP_MANAGED_RUNTIME SLP_RUNTIME_ROOT SLP_NODE_BIN`); a
  partial unset leaks managed-runtime variables into the suite and fakes
  failures. `node e2e/cli.mjs` runs the E2E
  manifest — requires task authority per AGENTS.md; local checks are not E2E
  acceptance.
- Authority carried from AGENTS.md: runtime installation, host configuration,
  live agents, commit and push require task authority. Other repositories are
  read-only unless explicitly authorized. Repository tactics live in this file;
  E2E tactics live in e2e/workspace-protocol.md.
- Pool maintenance: only the Human changes option eligibility/models (via
  onboarding); Lead selects among enabled/ready options per assignment and may
  not add options. quotaFallback stays disabled unless the Human enables it.
- Team formation records and creation receipts (situation row, calling actor,
  expected parent, workspace/cwd, report recipient, operation, isolation
  reason) live in the owning agent's timeline; durable notes go under
  .local-checks/ when the assignment grants that write scope.
- Seat naming (Human preference 2026-09-19): reviewer titles stay short —
  suffix the seat inside the request `taskLabel`, never an "axis" suffix:
  `Peer — Reviewer — <task> / Spec` / `/ Std`. The two split seats must stay
  distinguishable; do not rename seats already running.

## Repo anti-patterns

`supervisor_notebook` in the frontmatter records `.paseo-slp/notebook.md`
(scaffolded by init) or `timeline:<agentId>` with a retrieval note the Human can
follow; onboarding records the choice and its owner there. A separate file write
needs scope just like other writes. Handback preserves notes if durable
retrieval is unavailable and reports the gap.

For each observed repo-specific pattern, record signal, evidence/counterevidence,
suspected mechanism, impact, open question, allowed response and outcome. Begin
without invented repo patterns; use the installed generic catalog when relevant.

## Evolution

Distill repeated failures into tactics, keep authority changes with Human, and record
version, review date, causal evidence, counterargument and reversal conditions.
Review after recurring failures or material architecture change, and check whether
new rules improve evidence or merely add ceremony. Preserve change history.
