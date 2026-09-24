---
name: paseo-slp-onboarding
description: Set up or revise a repository's Paseo SLP protocol and Peer runtime pool, and verify its Supervisor/Lead profiles. Use when asked to onboard, set up or reconfigure SLP for a repo; skip ordinary Peer implementation.
---

# Paseo SLP repo onboarding

Configure tactics in .paseo-slp/workspace-protocol.md and Peer runtime options in
the plugin-owned user-scope pool
($PASEO_HOME/slp-runtime/state/peer-pool.json, default ~/.paseo — authored in
the SLP Manager's Peer pool card) or a repo-pinned .paseo-slp/slp-routing.json.
Supervisor/Lead use saved slp-supervisor/slp-lead
profiles. Peer uses the project pool, falling back to the user-scope pool
when the repository has none;
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

> Peers need a list of which provider/model they may run as. The shared
> user-scope pool lives at `~/.paseo/slp-runtime/state/peer-pool.json`
> (currently <state>) — every repo without its own catalog falls back to it,
> and the SLP Manager's Peer pool card edits it with seats seeded from the
> archetype list (each parked until it gets a real provider and model found
> on this host). Or this repo can pin its own `.paseo-slp/slp-routing.json`
> through `slp init <repo> --routing-from <file> --apply` — a repo catalog
> then ignores the shared pool permanently, even if the pool is later
> emptied. Which do you want?

For the shared pool, walk the seats in the Manager's Peer pool card: pick an
archetype per kind of work, choose the discovered provider/model/mode in its
pickers, and enable the seats the Human approves — the card's values come
from the live provider catalog, so a mistyped mode id cannot reach the file.
For a repo pool, build the same document as a file (the card's Copy pool
JSON supplies the shape) and import it with --routing-from. A populated
user-scope pool is the fallback default,
not this repository's configuration — its existence never substitutes for the
Human's choice.

The interview is complete when the Human has named where the list lives and,
for a list meant to work, picked discovered options seat by seat — or declared
the repo deliberately without a pool (then the repo pins an empty or
all-disabled catalog: an absent catalog would still read every seat the
shared pool holds, including seats authored for other repos). Record the resolved intent — `pinned`, `inherit` or `empty` —
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
   - `Engineer → Reviewer` with Lead verification — write, then the
     checkers: the gate's Spec and Standards seats check the work against
     the spec and the rules, and the Lead verifies execution — re-runs the
     established checks and pins the snapshot — on the same frozen
     candidate before and after the gate. For risky or hard-to-reverse
     work.
   - `Analyst → Architect → Engineer → Reviewer` with Lead verification —
     Analyst pins down what "done" means, Architect designs before code,
     then as the flow above; Tech Writer can update docs in its own scope.
     For vague-spec or load-bearing work.
   - **Other** — the Human describes a shape of their own.

   Verification is the Lead's own duty around the gate, not a review seat —
   the default gate has no QC seat. A cross-family second-opinion seat is
   optional and spawns only when the Lead calls for it; when no
   other-family option is routable, that seat is BLOCKED and the gate
   still runs on Spec and Standards.

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
     in parallel), Security Auditor (threat model), Performance Auditor
     (measure the claim), and any `…Auditor`
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
   disposition should use (a test-design or E2E skill for test-authoring
   seats, a writing skill for Tech Writer); which decisions stay Human-only.

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
authority. Init creates missing protocol
and a `.paseo-slp/notebook.md` Supervisor notebook scaffold without overwriting
existing files, and writes .paseo-slp/slp-routing.json only when
--routing-from names an explicitly chosen catalog. Fill the frontmatter `supervisor_notebook` field — the scaffolded path with
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
user-scope pool automatically. Any catalog file in the repo is authoritative
— init creates none, so a repo catalog exists only where --routing-from
imported one. For inherit, populate the user-scope pool in the Manager's Peer
pool card (a legacy `$PASEO_HOME/slp-routing.json` can be imported once from
the card; the plugin is that file's sole writer — never edit it by hand) or
report that the inherited pool is currently empty.

Populate a repo catalog only when the Human chose a pinned pool, before Peer
delegation. Interview the Human on which options to enable and the quota
fallback rather than copying a catalog verbatim; --routing-from imports an
explicitly selected source as a starting point for that decision, not as the
decision itself. Every option has:

- id: unique lowercase identifier; provider: pi, codex, devin or claude; exact
  discovered model. Devin options accept swe-2 models only. A disabled seat
  may park with a blank provider and model until the Human fills them.
- roles: ["peer"]; enabled: boolean; availability: ready, paused, quota-exhausted
  or unknown. Only enabled/ready options may launch.
- Optional thinkingOptionId, modeId and features, verified for that runtime.
- suitableFor and avoidFor: on the 12 reserved standard seats these are the
  package's closed `axis:value` tokens (read-only — docs/spec/routing-criteria.md);
  custom seats keep free-form lists Jev can read;
  notes: concrete guidance/tradeoffs for Lead, held back from Jev.

Configure quotaFallback: { enabled: false, optionId: null } by default. Enable it
only under Human fallback authority; optionId must designate one existing pool
option — a single designated fallback, not an ordered list. Choose it by
suitability and budget, not provider model lists. Preserve the existing
designation on updates. Missing settings mean no fallback.

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
`prepare <request.json> --emit create` prints the audit artifact
`{ modeId, modeIdSource, create }` — `create` is the exact create_agent
record.
Verify the wrapper/model/settings match the option. Include profiles
only if useful for discovery; they never select or override the Peer runtime.

A complete request carries: taskLabel, the role (and Peer disposition), the real
repository path and workspaceId, an assignment naming scope, authority, the
report-recipient agent ID and verification/handback expectations, plus one
binding source. Keep each seat's full brief in its own assignmentFile — the
prompt references it read-first and never inlines it. Before any create_agent
call, Lead records why the chosen topology fits the assignment (under armed
Jev routing that reason trail is the decision receipt's distribution, not
prose).
For repeated prepares, capture discovery once: `node <slp-cli> inventory
--paseo-home <absolute-home>` prints {providers, profiles} to stdout in the
shape prepare consumes — pass the file's absolute path as request.inventoryFile (inline arrays,
including [], still win). Under a managed runtime its providers are labeled
provenance configured and are refused as launch evidence; pass live
list_providers output from the same daemon inline as providers instead. Inventory
output proves configuration completeness, not provider readiness — never treat a
listed entry as healthy.

Init writes no catalog, so a repository stays on the user-scope pool until
--routing-from pins it — an empty or ineligible pool then blocks only Peer
delegation. Report no
eligible option as unresolved setup, not success. Preserve existing pool entries
and Human preferences on updates; edit only the authorized scope. --routing-from
imports an explicitly selected source only into a missing catalog. The user-scope
pool is the only declared fallback, resolved automatically when the repository
has none; never read another repository's catalog. No automatic import from retired
profile bindings occurs during host upgrade.

## Optional beads work tracker

The work tracker is opt-in and off by default; onboarding only sets it up when
the Human asks for durable task state. It needs the Human-installed `bd` CLI
(beads) — check `bd version`; when absent, hand the Human the install commands
(`brew install beads`, `npm i -g @beads/bd`, or the upstream `install.sh`)
rather than installing it silently — SLP detects but never installs,
initializes, upgrades or configures beads itself. Each participating repository
is initialized once under explicit authority with
`bd init --skip-agents --skip-hooks` [verify exact flag names against the
installed `bd`] — a per-repo step, never run by an SLP seat during a task.

Enable it in the SLP Manager's Work tracker card (the card probes `bd` and
shows the detected version/path or the install hint). The toggle writes
`slp-runtime/state/work-tracker.json`; disabling is the same switch. Once
enabled, every managed seat sees a `Work tracker:` line at session entry and
reads `src/references/work-tracking.md` for the procedure: probe first, a
missing or uninitialized `bd` is a recorded gap rather than a block, the
assignment remains the authority, and beads state is evidence — never the
control plane. Seats write under their own `BEADS_ACTOR` (hook-family seats
receive it automatically; Devin seats pass `--actor` per command).

## Verify and hand back

Record actual profile/provider discovery, pool validation, eligible choices and
exact changed files. Confirm protocol describes who may maintain the pool and
whether/how Lead may select quota alternatives. Distinguish no option from no
provider access. Report unresolved decisions precisely. Live launches require
separate task authority; local preparation is not E2E acceptance.

For layout migrations, reconcile collisions before moving files. Install this
skill separately in native project/user scope, not inside .paseo-slp.
