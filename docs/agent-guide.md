# Agent guide: setting up Paseo SLP for a repository

Read this when the Human asks you to set up, onboard or reconfigure SLP for
a repository. If the `paseo-slp-onboarding` skill is installed, it is the
canonical procedure — this file is the same workflow in standalone form.

## What you are setting up

- `.paseo-slp/WORKSPACE_PROTOCOL.md` — operating tactics for this repo's
  agent teams. Human-readable: risk levels, proof gates, budget, fallback
  authority, communication language, notebook location.
- `.paseo-slp/slp-routing.json` — the Peer runtime pool. Machine-readable
  catalog the Lead picks from per delegation.
- `.paseo-slp/notebook.md` — the Supervisor's durable notebook scaffold.

Supervisor/Lead runtimes come from the saved Paseo profiles `slp-supervisor`
and `slp-lead`. Peers take a runtime option from the pool — never create or
require a `slp-peer` profile.

## Preconditions

1. The package is installed: locate `bin/slp.mjs` (default
   `~/.local/share/paseo-slp/bin/slp.mjs`). If it is missing, tell the Human
   to run the installer — installation is not part of onboarding.
2. Read `src/templates/WORKSPACE_PROTOCOL.md` and
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

Ask, in one pass and in plain terms — name the files and what each choice
does; the Human decides, you supply discovered facts:

1. Where the Peer model list lives — this repo's
   `.paseo-slp/slp-routing.json` (init seeds it with disabled task-type seats
   the Human fills and reshapes), or the shared user file
   `$PASEO_HOME/slp-routing.json` (every repo without its own list falls back
   to it; install seeds the same skeleton there when absent — check whether
   it already holds real options before promising the fallback works). The
   Human may also keep this repo deliberately without a pool, which blocks
   Peer delegation until filled.
2. For a list meant to work: walk the seeded seats together — which
   discovered `slp-*-peer` provider/model/settings fill each seat, which
   seats to drop or add, their `priority`, and the `quotaFallback` policy.
3. Communication language — used for reports, assignments, handbacks between
   agents, replies to the Human, and the causal notebook.
4. Where the Supervisor notebook lives and how to retrieve it.

Present the options you actually discovered. Never invent model IDs,
capability claims or suitability guarantees.

## Step 3 — write the files

Preview with `node bin/slp.mjs init <absolute-repo>`, then rerun with
`--apply` under the granted setup authority. Init never overwrites. Then:

- Fill the frontmatter fields: `routing_intent` (pinned | inherit | empty +
  decider + date — never restate option IDs), `communication_language`,
  `supervisor_notebook`, `decided_by`, `decided_at`.
- Human chose the shared list → delete the seeded `slp-routing.json` init
  created; any repo catalog file is authoritative and blocks the fallback.
  Then check `$PASEO_HOME/slp-routing.json`: if it still holds only the
  seeded skeleton, ask whether to populate it with the same discovered
  options — writing outside the repo needs an explicit grant.
- Human chose a repo pool → fill the seeded seats per the schema in
  `provider-routing.md`: `id`, `provider`, exact discovered `model`,
  `enabled`, `availability`, `priority`, `suitableFor`/`avoidFor`, `notes`,
  and `quotaFallback` only under Human fallback authority.
- Human chose no pool → strip the seeded seats, leaving `options: []`.

## Step 4 — validate

- `node bin/slp.mjs routes <absolute-repo>` → catalog hash + eligible
  options.
- For each intended option, run `prepare` with `role: "peer"`, the
  repository/workspace, a short assignment and
  `route: {optionId, catalogSha256}`; verify the emitted provider/model/
  settings match the option.
- Report exactly which files changed and which decisions remain open.
  Local preparation is not E2E acceptance; live launches need separate
  task authority.
