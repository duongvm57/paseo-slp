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

Ask, in one pass:

1. Does this repository pin its own Peer pool, or inherit the user-scope
   catalog (`$PASEO_HOME/slp-routing.json`, default `~/.paseo`)? Install
   scaffolds that file empty when absent — check whether it already holds
   real options before promising the fallback works.
2. If pinning: which discovered `slp-*-peer` provider/model/settings options
   to enable, their `priority`, and the `quotaFallback` policy.
3. Communication language — used for reports, assignments, handbacks between
   agents and replies to the Human.
4. Where the Supervisor notebook lives and how to retrieve it.

Present the options you actually discovered. Never invent model IDs,
capability claims or suitability guarantees.

## Step 3 — write the files

Preview with `node bin/slp.mjs init <absolute-repo>`, then rerun with
`--apply` under the granted setup authority. Init never overwrites. Then:

- Fill the frontmatter fields: `routing_intent` (pinned | inherit | empty +
  decider + date — never restate option IDs), `communication_language`,
  `supervisor_notebook`, `decided_by`, `decided_at`.
- Human chose **inherit** → delete the empty `slp-routing.json` init
  created. An empty catalog is authoritative and blocks delegation. Then
  check `$PASEO_HOME/slp-routing.json`: if it is still the empty install
  scaffold, ask whether to populate it with the same discovered options —
  writing outside the repo needs an explicit grant.
- Human chose **pinned** → populate `options` per the schema in
  `provider-routing.md`: `id`, `provider`, exact `model`, `enabled`,
  `availability`, `priority`, `suitableFor`/`avoidFor`, `notes`, and
  `quotaFallback` only under Human fallback authority.

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
