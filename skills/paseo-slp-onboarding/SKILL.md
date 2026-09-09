---
name: paseo-slp-onboarding
description: Set up or revise a repository's Paseo SLP protocol and routing catalog, including task gates, model suitability, reasoning choices and quota fallback. Use when asked to onboard, set up or reconfigure Paseo SLP for a repo; skip ordinary Peer implementation.
---

# Paseo SLP repo onboarding

Produce two Human-editable files inside .paseo-slp at the selected repository root:

- .paseo-slp/WORKSPACE_PROTOCOL.md: repo risks, topology, ownership, proof gates, budget,
  escalation and allowed fallback. This file is the authority for repo tactics.
- .paseo-slp/slp-routing.json: concrete provider/model/thinking options, suitability notes,
  priority and availability for this repo. Its policy summarizes routing choices
  within the protocol and assignment; it cannot expand their authority.

Keep one Peer role. Engineer, Architect, Reviewer and other dispositions belong to
the task prompt; Lead selects the runtime option independently for each assignment.

## Establish context

Resolve the intended repo root and Paseo host from the current request. Read its
AGENTS.md, existing protocol/routing, package scripts and relevant repo docs before
editing. Preserve Human choices and unrelated changes. For an update, work only on
the requested sections/options; initial setup is not permission to reset them.

Locate bin/slp.mjs in the installed SLP package, normally
~/.local/share/paseo-slp/bin/slp.mjs on the daemon machine, or the source checkout
explicitly supplied by Human. If absent, report the missing installation; repo
onboarding alone does not require changing the daemon, provider profiles or agents.
Read src/templates/WORKSPACE_PROTOCOL.md and src/references/provider-routing.md in
that package for current tactics and routing procedure.

Infer checks, architecture risks and conventions from the repo. Ask only for material
missing choices: cost/authority boundaries, available provider accounts and desired
model trade-offs. Reuse choices already provided. Discovery confirms IDs/settings,
not model quality or remaining quota. Distinguish Human preferences from measured
evidence; leave uncertain options disabled or availability=unknown.

## Set up the files

Use `node <slp-cli> init <absolute-repo>` to preview, then `--apply` within setup
authority. It creates only missing protocol and routing files under `.paseo-slp`.
Fill the templates for this repo; successful scaffolding is not completed onboarding.
Keep global role instructions out of the protocol. This skill is installed separately
at native project or user scope; do not copy it into `.paseo-slp`.

For an explicitly requested migration, add `--routing-from <absolute-json>` to init
to seed a missing catalog. Import once into the repo, then review its budget, tags
and quota assumptions. Existing catalogs are preserved; reconcile any requested
merge explicitly. Never import a host/global or another repo's file merely because
one exists. Worktrees use their own copies; include these files in the worktree's
starting candidate or copy the selected policy within authorized scope.

For a requested move from the former repo-root layout, inspect old and new paths
first. Move existing WORKSPACE_PROTOCOL.md and slp-routing.json into .paseo-slp,
preserving their contents, then run init for missing files. Reconcile collisions
without overwriting Human edits. Keep an existing native `.agents/skills` installation;
remove only obsolete `.paseo-slp/skills/paseo-slp-onboarding` copies that the Human
explicitly authorizes you to clean up. Other skills stay put.

Discover list_providers/list_models/inspect_provider through Paseo on the target host
when available. Otherwise discover the installed CLI's supported provider commands
or report the unavailable capability. Use exact IDs and supported thinking options.
Do not ask for credentials in chat or store secrets in repo files.

Catalog shape: version=1, policy (text), options (array). Each option needs:
id (unique lowercase slug), provider (codex or pi), roles (subset of supervisor,
lead, peer), model, enabled (boolean), availability (ready, quota-exhausted, paused
or unknown), priority (number; higher preferred for equally suitable work),
suitableFor/avoidFor (free-form string lists), and notes (strengths/trade-offs).
thinkingOptionId, modeId and features are optional provider-supported settings.
Use separate option IDs for different effort levels on the same model. Ready means
eligible for selection, not guaranteed remaining quota. Exclude exhausted options.

Write protocol criteria that explain when code/reasoning/review strengths matter,
the budget, independent-session requirements and whether fallback may be automatic.
Keep concrete model and quota edits in slp-routing.json. Tags guide Lead judgment;
they do not force a disposition-to-model mapping. Configure only the chosen repo.

## Verify and hand back

Run `node <slp-cli> routes <absolute-repo>` to validate and inspect the actual file.
Trace at least one likely task and one unavailable-quota case through protocol and
eligible options. With a staged/installed package and discovered workspace/provider
inventory, optional offline prepare can verify the chosen option/hash/settings;
this creates no agent. Live runs require a task that includes them.

Finish when both files express the supplied boundaries, every active option has a
known model/settings source, quota fallback has an explicit scope, and validation
passes. Report unresolved decisions if that bar cannot be met. Show the exact files
and explain how Human changes suitability/effort or sets enabled=false / quota-exhausted.
Changing these repo files needs no package reinstall or daemon reload. Separate
local setup checks from actual agent/workflow acceptance.
