---
version: '1'
owner: ''
applies_to: ''
last_reviewed: ''
routing_intent: ''
agent_mode: ''
supervisor_notebook: ''
decided_by: ''
decided_at: ''
---

# Workspace Protocol

Lead reads this file before delegation. Supervisor reads it when assigned a
protocol audit. Lead passes only task-relevant constraints to the Peer.

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
- `agent_mode` records the intended Paseo modeId for agents spawned in this
  repository (for example `bypass`); empty falls back to the spawn bundle's own
  modeId, and the spawner asks only when neither is set rather than letting
  agents inherit the host default.

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

| Class | Starting topology and evidence gate |
|---|---|
| Tiny / bounded familiar | One Engineer, focused proof and Lead artifact inspection. Lead may implement tiny tightly coupled work if assignment allows. Independent review optional unless material risk appears. |
| Cross-module / lifecycle / migration / security | Read-only Architect investigates before implementation; one owner per write scope; independent Reviewer on stable candidate before Lead acceptance. |
| Foundation / costly architecture lock-in | Independent design lenses or sealed council with distinct mandates; Lead records decision/counterargument/reversal conditions; Engineer then independent review. Human decides owner-only trade-offs. |
| Large dependency in a different domain | Separate bounded lane or dependency Lead within authority; explicit contract, handback and integration owner. |

For council, default to two distinct lenses, at most one challenge/response round
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
priority and budget. Record the rationale, option ID/hash and actual launch bundle.
Validate against fresh provider discovery; do not inherit a saved slp-peer profile
or Lead settings. Apply the installed orchestration session continuity policy:
keep existing context for corrections and re-review; establish a separate session
when a new independent seat is required. No catalog in either scope or no
eligible runtime requires onboarding setup; a missing repository catalog falls
back to the user-scope pool, never to another repository's catalog.

Lead uses macro skills, Supervisor observation/governance skills, Peer task micro
skills. Configure Peer quotaFallback.enabled/optionIds in slp-routing.json; default
disabled, targets restricted to existing eligible pool options. Record allowed pool
maintenance, cost limits and
settlement boundaries. Provider changes for existing work require a new-session
handoff; an eligible pool option does not itself grant replacement authority.
Use paseo-slp-onboarding to update tactics and pool while preserving Human choices.

## Monitoring and heartbeat

Use finish/error/permission notifications first. Lead reports material decisions,
reopen/dependency requests and significant risk changes to the assigned Supervisor.
For short bounded work with adequate events, default to no heartbeat. For long work
or incomplete event coverage, decide and record the observer, reporting route,
cron/timezone, expiry/run bound, evidence checkpoint and stop condition before
creating a fallback heartbeat. No universal cadence is prescribed; ownership,
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

## Reopen, dependency, and blocked handling

Lead reconciles REOPEN_REQUEST (failed premise) and DEPENDENCY_REQUEST (another owner,
API or scope). BLOCKED identifies a missing decision/prerequisite/capability. After
repeated identical failures, inspect the shared mechanism and prerequisite changes
before retrying; any numeric retry threshold is a repository choice. Owner-only
decisions go through the assigned Supervisor or directly to Human. At handback,
record actual proof, unresolved findings and settlement of task-owned resources.

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
