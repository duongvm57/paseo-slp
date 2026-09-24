# Agent guide: setting up Paseo SLP for a repository

Read this when the Human asks you to set up, onboard or reconfigure SLP for
a repository. If the `paseo-slp-onboarding` skill is installed, it is the
canonical procedure — this file is the same workflow in standalone form.

## What you are setting up

- `.paseo-slp/workspace-protocol.md` — operating tactics for this repo's
  agent teams. Human-readable: risk levels, proof gates, budget, fallback
  authority, notebook location.
- `.paseo-slp/slp-routing.json` — optional, a deliberate repo pin of the Peer
  runtime pool, created only by `init --routing-from`. The default pool is the
  user-scope `slp-runtime/state/peer-pool.json` the Manager's Peer pool card
  owns — the Lead picks from whichever scope applies, per delegation.
- `.paseo-slp/notebook.md` — the Supervisor's durable notebook scaffold.

Supervisor/Lead runtimes come from the saved Paseo profiles `slp-supervisor`
and `slp-lead`. Peers take a runtime option from the pool — never create or
require a `slp-peer` profile.

## Preconditions

1. The package is installed: locate `bin/slp.mjs` (default
   `~/.local/share/paseo-slp/bin/slp.mjs`). If it is missing, tell the Human
   to run the installer — installation is not part of onboarding.
2. Read `src/templates/workspace-protocol.md` and
   `src/references/provider-routing.md` from that install.
3. Read the repo's `AGENTS.md` and any existing `.paseo-slp/` files. Preserve
   existing Human choices and unrelated work.

## Step 1 — verify Supervisor/Lead profiles

Call Paseo `list_profiles`/`list_providers`, or run
`node bin/slp.mjs inventory`. Confirm `slp-supervisor` and `slp-lead` exist
and use installed `slp-*-{supervisor,lead}` providers with valid models.
Report exact mismatches and hand the Human the fix steps: Settings → the
host running the work → Agents → Agent profiles → edit the profile → pick
the matching `slp-{family}-{role}` provider, Model, Thinking, Mode → Save.
There is no CLI or MCP write path for profiles — do not hand-edit the
daemon config.

## Step 2 — interview the Human

Ask in plain terms — name the files and what each choice does; the Human
decides, you supply discovered facts. Two passes: routing, then workflow
shapes.

### Routing

1. Where the Peer model list lives — the shared user-scope pool
   `$PASEO_HOME/slp-runtime/state/peer-pool.json`, authored in the SLP
   Manager's Peer pool card (its model/mode values come from the live
   provider catalog; every repo without its own catalog falls back to it —
   check whether it already holds real options before promising the
   fallback works), or a repo-pinned `.paseo-slp/slp-routing.json` that
   exists only where `init --routing-from` imported an explicitly chosen
   file — any repo catalog is authoritative and blocks the fallback. The
   Human may also keep this repo deliberately without a pool, which blocks
   Peer delegation until the shared pool is filled.
2. For a pool meant to work: walk the seats together in the Manager — which
   discovered `slp-*-peer` provider/model/settings fill each seat, which
   seats to drop or add, and the `quotaFallback` policy.
3. Communication language — used for everything a seat writes for other
   seats: prompts and inline fields in delegation requests, reports,
   assignments, briefs, handbacks and the causal notebook. Direct
   conversational replies to the Human mirror the Human's current language
   instead.
4. Where the Supervisor notebook lives and how to retrieve it.
5. Jev-assisted routing — optional and per-daemon, not a repo file: the SLP
   Manager's Jev (OpenRouter) card holds the toggles and key. Default off;
   when the Human arms it, Peer delegation requires a `route-decide` receipt
   (see `src/references/provider-routing.md`). Onboarding does not create or
   edit it.

Present the options you actually discovered. Never invent model IDs,
capability claims or suitability guarantees.

### Workflow shapes

The protocol's Task classes and gates table records which workflows this
repository wants: each row is a default shape for a kind of work — which
seats (Peer dispositions) run, in what order, with what write authority
and evidence gate. Rows describe the task's nature (bounded, hard to
reverse, vague spec), not file paths; Lead judges each task against its
row and may lighten or strengthen the seats — never below a required
gate, and a single seat only for the change classes the review-gate
rules list explicitly. The template rows are
examples — grill the Human one group at a time
in plain language; the Human describes their workflow and you translate
answers into classes, dispositions and gates. Ask in the Human's words:
show the artifact a question is about (the table itself, a flow) and
unpack a term before relying on it.

Offer the basic flows as choices — the Human picks one per kind of work,
or one default for the whole repo with exceptions only where risk or
evidence type differs, adapts any of them, or describes their own. They
are starting shapes, not a limit on which dispositions may appear:

- `Engineer → Reviewer` — one agent writes it and proves it works;
  `Reviewer` is shorthand for a split-axis gate: a Spec seat checks the
  work against the spec and a Standards seat checks it against the rules,
  in parallel. The default for bounded work.
- `Engineer → Reviewer` with Lead verification — write, then the
  checkers: the Spec and Standards seats above, and the Lead verifies
  execution — re-runs the established checks and pins the snapshot — on
  the same frozen candidate before and after the gate. For risky or
  hard-to-reverse work.
- `Analyst → Architect → Engineer → Reviewer` with Lead verification —
  Analyst pins down what "done" means, Architect designs before code,
  then as the flow above; Tech Writer can update docs in its own scope.
  For vague-spec or load-bearing work.
- **Other** — the Human describes a shape of their own.

Verification is the Lead's own duty around the gate, not a review seat —
the default gate has no QC seat. A cross-family second-opinion seat is
optional and spawns only when the Lead calls for it; when no other-family
option is routable, that seat is BLOCKED and the gate still runs on Spec
and Standards.

Offer the full disposition menu, grouped by the judgment each kind
supplies — the assignment defines the job, so name the job a person would
hold. The menu is a catalog, not a ceiling: Lead may name any other
disposition an assignment needs, on any flow:

- **Design, before code:** Scout (codebase recon), Researcher (external
  sources), Analyst (acceptance criteria), Architect (ownership and
  lifecycle design), Design Lens (one sealed-council mandate), Advisor
  (second opinion), Product Designer (interface/UX contract).
- **Write, own scope:** Engineer (implement and prove), Feature Owner (a
  whole vertical slice), Shadow Implementer (a parallel alternative),
  Migrator, Tech Writer (docs only), Integrator (merges — Lead keeps the
  decision), Dependency Lead (a large branch under contract), Release
  Engineer, Prototyper (throwaway code to answer a design question),
  Debugger (root mechanism for hard bugs).
- **Falsify the frozen candidate:** Reviewer (Spec and Standards seats in
  parallel), Security Auditor (threat model), Performance Auditor
  (measure the claim), and any `…Auditor` domain lens (accessibility,
  i18n, compliance).
- **Audit the evidence chain:** Proof Auditor — did the commands run, does
  the output prove the claim, is the candidate identity real.

One writer per moving scope; every checking seat runs on the same frozen
candidate and reruns when it changes; a seat exists to change a verdict.
Remind the Human each seat costs tokens and attention — keep only seats
that can change a verdict.

Then grill one group at a time, each option on its own line, restating
every decision in plain words before continuing: what work actually lands
here and which kinds carry real risk; which shape fits each kind — or
whether one default covers the repo; which domain skills each chosen
disposition should use (a test-design or E2E skill for test-authoring
seats, a writing skill for Tech Writer); which decisions stay Human-only.

The interview is complete when every work kind the Human named has a shape
and gate, each chosen disposition has its skills noted, and the Human has
heard the table is theirs to revise.

## Step 3 — write the files

Preview with `node bin/slp.mjs init <absolute-repo>`, then rerun with
`--apply` under the granted setup authority. Init never overwrites. Then:

- Fill the frontmatter fields: `routing_intent` (pinned | inherit | empty +
  decider + date — never restate option IDs),   `supervisor_notebook`, `decided_by`, `decided_at`.
- Record the confirmed shapes — a repo default plus exceptions, or
  per-class rows — in the Task classes and gates table, and each
  disposition's intended skills in the protocol's skills notes so Lead can
  name them in the assignment. The table states defaults and triggers, not
  obligations; spawn-time dispositions stay free-form.
- Human chose the shared pool → fill the seats in the SLP Manager's Peer
  pool card (a legacy `$PASEO_HOME/slp-routing.json` can be imported once
  from there; the card writes `state/peer-pool.json` only). The plugin owns
  that file — editing it by hand or through another tool bypasses the
  catalog pickers.
- Human chose a repo pool → build the catalog file per the schema in
  `provider-routing.md` (`id`, `provider`, exact discovered `model`,
  `enabled`, `availability`, `suitableFor`/`avoidFor` (the closed
  `axis:value` vocabulary on the 12 reserved standard-seat ids, free-form on
  custom seats — docs/spec/routing-criteria.md), `notes`, and
  `quotaFallback` only under Human fallback authority), then
  `slp init <repo> --routing-from <file> --apply`. The Manager's Copy pool
  JSON button supplies the document shape; pasting it into a repo pins that
  repo off the shared pool permanently.
- Human chose no pool → nothing to write: init creates no catalog, and the
  shared pool simply needs no seats for this repo's work.

Write the protocol only through a confirmed diff: present the exact
complete diff with material consequences, obtain direct Human
confirmation, verify the file is unchanged since the confirmed base, write
the canonical file, then re-read it and verify the bytes match the
confirmed target. Drift or a byte mismatch is a blocker, not a partial
write. For a revision, bump the frontmatter version and refresh
`last_reviewed` in the same diff.

## Step 4 — validate

- `node bin/slp.mjs routes <absolute-repo>` → catalog hash + the raw catalog
  (eligibility is judged per option against `enabled`/`availability`/`roles`).
- For each intended option, run `prepare` with `role: "peer"`, the
  repository/workspace, a short assignment and
  `route: {optionId, catalogSha256}`; verify the emitted provider/model/
  settings match the option.
- Report exactly which files changed and which decisions remain open.
  Local preparation is not E2E acceptance; live launches need separate
  task authority.
