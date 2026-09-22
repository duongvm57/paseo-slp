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

Supervisor and Lead read this file when the assignment lands — before any
reply or decision that depends on repository tactics, not only before
delegation. Supervisor also reads it when assigned a protocol audit. Lead
passes only task-relevant constraints to the Peer.

This is a starting template of repository tactics. The Human's current assignment
controls authority. Complete unknown fields from repository evidence and the
assignment before the decision that depends on them; do not treat blanks as grants.
The defaults below can be adapted under the repository's policy mandate.

## Context recovery

If role policy or locators are missing after compaction, use the Policy recovery
command delivered with the role (the verified runtime's `bin/slp.mjs instructions
<role>`), then read the references relevant to the current decision. Preserve the
recorded Node, runtime root and daemon home; a source-checkout preview is not the
managed session's policy. Recover assignment and ownership from task evidence
before applying this repository's tactics.

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
| Tiny / bounded familiar | One Peer Engineer, focused proof and Lead artifact inspection; follow the Tiny procedure below. Independent review optional unless the assignment, protocol or material risk requires it. |
| Cross-module / lifecycle / migration / security | Read-only Architect investigates before implementation; one owner per write scope; independent review gate — split-axis seats, never one merged seat — on the stable candidate before Lead acceptance. |
| Foundation / costly architecture lock-in | Independent design lenses or sealed council with distinct mandates; Lead records decision/counterargument/reversal conditions; Engineer then the independent review gate. Human decides owner-only trade-offs. |
| Large dependency in a different domain | Separate bounded lane or dependency Lead within authority; explicit contract, handback and integration owner. |

### Tiny procedure

Lead classifies a task as tiny only when scope and verification are clear, the
change is easy to reverse and it changes no authority, delegation, lifecycle or
integrity rules. Record the reason in one sentence. Reclassify before dependent
work when scope or risk grows; an assignment or protocol requiring independent
review takes precedence. This procedure reduces ceremony, not required gates.

1. Lead supplies one short inline brief: outcome, owned/excluded scope, authority,
   verification and report recipient. Record the formation in the same brief or
   timeline entry: operation, parent/child, workspace/cwd and ownership. No separate
   plan, brief file or formation file is required. Reuse policy text under the
   installed core's freshness rule; still verify current route/runtime prerequisites.
2. Delegate to one Peer Engineer through agent-scoped create_agent with the pinned
   workspace and notifyOnFinish, verifying parentage and placement. For corrections
   or a suitable verified child in the same ongoing assignment, follow installed
   session continuity. Add other dispositions only when the task no longer meets
   tiny conditions or a required gate calls for them.
3. Engineer returns the artifact/diff, candidate identity, actual checks with
   relevant outputs and exit codes, remaining risks and resources in the session.
   A separate report file is not required. Pause writes during Lead inspection.
4. Lead inspects the artifact and evidence, then returns a short
   ACCEPT/CHANGES_REQUESTED/BLOCKED verdict with candidate identity, proof and any
   unresolved risk/resource. Use the installed snapshot helper or an exact commit
   with all relevant working changes accounted for. Keep required handback routes.

Repositories may strengthen this procedure for their risks; keep the installed
core's authority, ownership, parentage and required-review invariants. A missing
or older protocol that does not define a tiny procedure does not silently inherit
these exemptions: record the gap and propose an update within Human authority.
Do not rewrite existing repository protocols during package installation/update.

For council, default to two distinct lenses, at most one challenge/response round
per material proposition, then Lead reconciles. Add another lens only for an
unresolved decision-changing question worth the cost. These are repo defaults,
not universal role requirements. Escalate foundation uncertainty before tests pin
an undecided API or representation. In a new domain, establish enough Human framing
to locate owner boundaries before foundational implementation.

Keep split-seat titles short: name the seat inside taskLabel —
`Peer — Reviewer — <task> / Spec` and `Peer — Reviewer — <task> / Std`, QC as
`Peer — Reviewer — <task> / QC` — never an "axis" suffix. Apply the
convention to new spawns; seats already running keep their titles.

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
catalog, the plugin-owned user-scope pool
($PASEO_HOME/slp-runtime/state/peer-pool.json, default ~/.paseo) is
the declared fallback. The Manager's Peer pool card authors it —
Human-approved provider/model/settings options and suitability descriptions.
Lead selects a ready Peer option for each task using suitableFor, avoidFor, notes
and budget. Record the rationale, option ID/hash and actual launch bundle
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
skills. Configure Peer quotaFallback.enabled/optionId in the pool; default
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
