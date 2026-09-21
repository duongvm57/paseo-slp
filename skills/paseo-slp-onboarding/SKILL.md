---
name: paseo-slp-onboarding
description: Set up or revise a repository's Paseo SLP protocol and Peer runtime pool, and verify its Supervisor/Lead profiles. Use when asked to onboard, set up or reconfigure SLP for a repo; skip ordinary Peer implementation.
---

# Paseo SLP repo onboarding

Configure tactics in .paseo-slp/workspace-protocol.md and Peer runtime options in
.paseo-slp/slp-routing.json. Supervisor/Lead use saved slp-supervisor/slp-lead
profiles. Peer uses the project pool, falling back to the user-scope catalog
($PASEO_HOME/slp-routing.json, default ~/.paseo) when the repository has none;
no saved slp-peer profile is
needed. Engineer, Architect and Reviewer are dispositions of the same Peer role.

## Establish context

Resolve the assigned repository and host. Read AGENTS.md, existing protocol/pool
and relevant project scripts/docs. Locate installed bin/slp.mjs and read its
src/templates/workspace-protocol.md and src/references/provider-routing.md.
Missing installation is a prerequisite; onboarding does not grant host installation
or saved-profile edits. Preserve existing Human choices and unrelated work.

Read Paseo list_profiles/list_providers and discover models/settings. Verify the
saved Supervisor/Lead profiles use matching installed role providers and selected
models. Ask Human to configure missing/incompatible fields in Paseo Agent profiles;
report exact IDs/mismatches, and hand the Human the fix steps: Settings → the host
running the work → Agents → Agent profiles → edit the profile → pick the matching
`slp-{family}-{role}` provider, Model, Thinking, Mode → Save. There is no CLI or
MCP write path for profiles — do not hand-edit the daemon config. Do not create or
require slp-peer.

For the Peer pool, discover slp-pi-peer/slp-codex-peer/slp-devin-peer/slp-claude-peer and their exact models,
thinking/mode/features. Then interview the Human: they decide; you supply
discovered facts and write what they pick. Ask in plain terms — name the files
and what each choice does. For example:

> Peers need a list of which provider/model they may run as. Init seeded this
> repo's `.paseo-slp/slp-routing.json` with task-type seats (lightweight-recon,
> standard-coding, deep-reasoning, independent-second-opinion,
> autonomous-long-running) — each disabled until it gets a real model found on
> this host. Or the repo can share your user-level list at
> `~/.paseo/slp-routing.json` (currently <state>) — every repo without its own
> list falls back to it, so choosing it means deleting the repo file. Which do
> you want?

For a repo pool, walk the seeded seats together: which discovered provider,
model and settings fill each seat, which seats to drop or add — the seed is a
starting set the Human reshapes freely. For the shared list, run the same walk
against `~/.paseo/slp-routing.json`; writing outside the repository needs an
explicit Human grant. A populated user-scope catalog is the fallback default,
not this repository's configuration — its existence never substitutes for the
Human's choice.

The interview is complete when the Human has named where the list lives and,
for a list meant to work, picked discovered options seat by seat — or declared
the repo deliberately without a pool (then strip the seeded seats, leaving
`options: []`). Record the resolved intent — `pinned`, `inherit` or `empty` —
in the protocol frontmatter `routing_intent` with who decided and when; the
catalog file carries the option IDs.
Within granted setup authority, populate the choices the Human made; otherwise
ask for the missing pool decision before delegation. Offer only providers,
models and settings that live discovery returned — never invent IDs, capability
claims or suitability guarantees. Existing saved Peer settings may be shown as
a migration suggestion but are not automatically imported or a launch fallback.
Never store credentials in the repository.

## Interview task classes and dispositions

The protocol's Task classes and gates table records which workflows this
repository wants: each row is a default shape for a kind of work — which
seats (Peer dispositions) run, in what order, with what write authority
and evidence gate. Rows describe the task's nature (bounded, hard to
reverse, vague spec), not file paths; Lead judges each task against its
row and may lighten or strengthen the seats — never below a required
gate, and a single seat only for the change classes the review-gate
rules list explicitly. Whoever runs onboarding
interviews the Human before writing it, in plain language, one question
at a time — the Human describes their workflow; you translate answers
into classes, dispositions and gates. Ask in the Human's words: show the
artifact a question is about (the table itself, a flow) and unpack a
term before relying on it.

1. Offer the basic flows as choices — the Human picks one per kind of
   work, or one default for the whole repo with exceptions only where risk
   or evidence type differs, adapts any of them, or describes their own.
   They are starting shapes, not a limit on which dispositions may appear:

   - `Engineer → Reviewer` — one agent writes it and proves it works; the
     review gate then tries to break the finished result. "Reviewer" is
     shorthand for the split-axis gate: fresh independent Spec and
     Standards seats in parallel, never one merged seat. The default for
     bounded work.
   - `Engineer → Reviewer + QC` — write, then the checkers run in
     parallel: the gate's Spec and Standards seats check the work against
     the spec and the rules, while QC designs cases from the requirement
     and runs them on the same finished version. For risky or
     hard-to-reverse work.
   - `Analyst → Architect → Engineer → Reviewer + QC` — Analyst pins down
     what "done" means, Architect designs before code, then as the flow
     above; Tech Writer can update docs in its own scope. For vague-spec
     or load-bearing work.
   - **Other** — the Human describes a shape of their own.

2. Offer the full disposition menu, grouped by the judgment each kind
   supplies — the assignment defines the job, so name the job a person
   would hold. The menu is a catalog, not a ceiling: Lead may name any
   other disposition an assignment needs, on any flow:

   - **Design, before code:** Scout (codebase recon), Researcher (external
     sources), Analyst (acceptance criteria), Architect (ownership and
     lifecycle design), Design Lens (one sealed-council mandate), Advisor
     (second opinion), Product Designer (interface/UX contract).
   - **Write, own scope:** Engineer (implement and prove), Feature Owner
     (a whole vertical slice), Shadow Implementer (a parallel alternative),
     Migrator, Tech Writer (docs only), Integrator (merges — Lead keeps the
     decision), Dependency Lead (a large branch under contract), Release
     Engineer, Prototyper (throwaway code to answer a design question),
     Debugger (root mechanism for hard bugs).
   - **Falsify the frozen candidate:** Reviewer (Spec and Standards seats
     in parallel), Security Auditor (threat model), QC (cases from the
     spec), Performance Auditor (measure the claim), and any `…Auditor`
     domain lens (accessibility, i18n, compliance).
   - **Audit the evidence chain:** Proof Auditor — did the commands run,
     does the output prove the claim, is the candidate identity real.

   One writer per moving scope; every checking seat runs on the same frozen
   candidate and reruns when it changes; a seat exists to change a verdict.
   Remind the Human each seat costs tokens and attention — keep only seats
   that can change a verdict.

3. Grill one group at a time, each option on its own line, restating every
   decision in plain words before continuing: what work actually lands
   here and which kinds carry real risk; which shape fits each kind — or
   whether one default covers the repo; which domain skills each chosen
   disposition should use (a test-design or E2E skill for QC, a writing
   skill for Tech Writer); which decisions stay Human-only.

4. Record the confirmed shapes — a repo default plus exceptions, or
   per-class rows — in the Task classes and gates table and each
   disposition's intended skills in the protocol's skills notes, so Lead
   names them in the assignment. The table states defaults and triggers,
   not obligations; spawn-time dispositions stay free-form.

The interview is complete when every work kind the Human named has a shape
and gate, each chosen disposition has its skills noted, and the Human has
heard the table is theirs to revise.

## Set up protocol and pool

Use `node <slp-cli> init <absolute-repo>` to preview, then --apply within setup
authority. Init creates missing protocol, seeds the task-type skeleton catalog
and a `.paseo-slp/notebook.md` Supervisor notebook scaffold without overwriting
existing files. Fill the frontmatter `supervisor_notebook` field — the scaffolded path with
its owner, or `timeline:<agentId>` plus a retrieval note the Human can follow.
Complete tactics: record the task classes and dispositions confirmed in the
interview, plus ownership, topology, proof, budget, allowed operations,
escalation and settlement. Keep role bytes out of the protocol.

Write the protocol only through a confirmed diff: present the exact complete
diff with material consequences, obtain direct Human confirmation, verify the
file is unchanged since the confirmed base, write the canonical file, then
re-read it and verify the bytes match the confirmed target. Drift or a byte
mismatch is a blocker, not a partial write. For a revision, bump the
frontmatter version and refresh last_reviewed in the same diff.

The default pool decision is inherit: a repository with no catalog resolves the
user-scope catalog automatically. Any catalog file in the repo is authoritative
— when the Human chooses inherit, remove the seeded slp-routing.json so the
fallback engages. Then check the user-scope file: if it still holds only the
seeded skeleton, offer to populate it from the same discovered options (with
the Human's grant to write outside the repository) or report that the
inherited pool is currently empty.

Populate the project catalog only when the Human chose a pinned pool, before Peer
delegation. Interview the Human on which options to enable, priority and quota
fallback rather than copying a catalog verbatim; --routing-from imports an
explicitly selected source as a starting point for that decision, not as the
decision itself. Every option has:

- id: unique lowercase identifier; provider: pi, codex, devin or claude; exact
  discovered model. Devin options accept swe-2 models only.
- roles: ["peer"]; enabled: boolean; availability: ready, paused, quota-exhausted
  or unknown. Only enabled/ready options may launch.
- Optional thinkingOptionId, modeId and features, verified for that runtime.
- priority: numeric preference; suitableFor and avoidFor: lists of task descriptions;
  notes: concrete guidance/tradeoffs for Lead. Priority is not automatic selection.

Configure quotaFallback: { enabled: false, optionIds: [] } by default. Enable it
only under Human fallback authority; optionIds must reference existing pool options.
Choose allowed fallback options by suitability and budget, not provider model lists.
Preserve existing fallback preferences on updates. Missing settings mean no fallback.

The catalog envelope is version: 1, a nonempty policy describing selection/budget
boundaries, and options: an array of these bundles. Lead chooses an option per
assignment; do not hard-code Engineer/Architect/Reviewer to one model. Multiple
options may use the same provider with different model/settings, or different
providers. Every Peer wrapper loads the same policy.

Validate with `node <slp-cli> routes <absolute-repo>`. It returns the catalog hash
and complete options. For each intended eligible option, use prepare with
role: "peer", repository, workspaceId, assignment, fresh providers, and
route: { optionId, catalogSha256 } to inspect launch arguments without creating
an agent — or `prepare <request.json> --check` to get every failing stage named
in one report (missing profile/provider/model, stale hash) with exit 1 on
failure. `prepare --schema` prints the request contract from a source checkout;
`prepare <request.json> --emit create` prints the exact create_agent record.
Verify the wrapper/model/settings match the option. Include profiles
only if useful for discovery; they never select or override the Peer runtime.

A complete request carries: taskLabel, the role (and Peer disposition), the real
repository path and workspaceId, an assignment naming scope, authority, the
report-recipient agent ID and verification/handback expectations, plus one
binding source. Keep each seat's full brief in its own assignmentFile — the
prompt references it read-first and never inlines it. Before any create_agent
call, Lead records why the chosen topology fits the assignment.
For repeated prepares, capture discovery once: `node <slp-cli> inventory
--paseo-home <absolute-home>` prints {providers, profiles} to stdout in the
shape prepare consumes — pass the file's absolute path as request.inventoryFile (inline arrays,
including [], still win). Under a managed runtime its providers are labeled
provenance configured and are refused as launch evidence; pass live
list_providers output from the same daemon inline as providers instead. Inventory
output proves configuration completeness, not provider readiness — never treat a
listed entry as healthy.

An empty catalog is valid init output but incomplete Peer onboarding — it also
remains authoritative and shadows the user-scope catalog until removed. Report no
eligible option as unresolved setup, not success. Preserve existing pool entries
and Human preferences on updates; edit only the authorized scope. --routing-from
imports an explicitly selected source only into a missing catalog. The user-scope
catalog is the only declared fallback, resolved automatically when the repository
has none; never read another repository's catalog. No automatic import from retired
profile bindings occurs during host upgrade.

## Verify and hand back

Record actual profile/provider discovery, pool validation, eligible choices and
exact changed files. Confirm protocol describes who may maintain the pool and
whether/how Lead may select quota alternatives. Distinguish no option from no
provider access. Report unresolved decisions precisely. Live launches require
separate task authority; local preparation is not E2E acceptance.

For layout migrations, reconcile collisions before moving files. Install this
skill separately in native project/user scope, not inside .paseo-slp.
