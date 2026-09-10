---
name: paseo-slp-e2e
description: Run or resume Paseo SLP live E2E dogfood from one coordinating session, for the requested scenarios or full suite, including fixture onboarding, evidence, independent review and cleanup. Use when asked to run E2E or dogfood this package; requires its source checkout.
---

# Run Paseo SLP E2E

The Human can say “run E2E package”. Own the whole run from this
conversation through a consolidated report. Use fresh Paseo children for scenario
actors and independent reviewers. One user-facing session does not mean one actor.

Locate the paseo-slp source checkout from the assignment/current workspace. Read
its AGENTS.md, docs/contract.md, docs/review-checklist.md and
e2e/WORKSPACE_PROTOCOL.md. The source checkout is required because the suite tests
the package and includes development fixtures; an installed runtime alone is not
the suite. Read e2e/scenarios.mjs for the authoritative scenario inventory and
e2e/README.md for collector commands and evidence formats.

Honor the requested scenario scope. For “only basic-codex”, execute that row and
record the others NOT_RUN with reason “outside Human-requested scope”. A request
for the full suite selects the whole manifest. Record the selection in preflight;
report selected-row results separately from the full-manifest summary. A single
basic flow does not require running the separate onboarding acceptance scenarios.

## Execute

1. Resolve current authority, host, installed candidate, model/effort choices and
   budget from the Human assignment and existing repo settings. Reuse authorized
   choices. For basic-codex/basic-pi, first read the three saved SLP profiles;
   Human must configure matching role providers, models and settings. Ask for any
   missing/mismatched profile before starting paid confirmation or task actors.
   Never modify profiles or substitute fixture catalog options to satisfy the row.
   Discover the actual Paseo tools/CLI, profiles and providers before
   constructing calls. Record missing capabilities and proof paths. Ask once for
   consequential missing authority/settings only if they prevent the requested
   run; continue independent preparation. This skill itself grants no permissions.
2. Initialize a run, or inspect its summary to resume. Initialization freezes the
   package identity, scenario manifest, checklist and harness identity. Complete
   the concrete prelaunch config before requesting independent confirmation;
   follow **Prelaunch confirmation** in e2e/WORKSPACE_PROTOCOL.md. Record the
   run deadline, resource baseline, permission policy and retention choice.
   For a full run, start with isolated onboarding/install trials and the
   Codex/Pi basic flows (Human configures profiles for each family); for a scoped run, prepare only its required prerequisites.
3. For every selected row, create an attempt and independent fixture. Complete
   **Prepare the task repository** below before launching the task's root actor.
   Give that actor the task, authority and applicable scenario constraints. Let the
   SLP actors choose routes, spawn descendants, handle dependencies and accept
   their work through Paseo. The coordinator collects evidence and applies only
   the manifest's declared stimuli; it does not perform the workflow for them.
4. Capture actual launch/settings/instructions, timelines, artifact bytes and
   checks, interventions and resource receipts throughout the attempt. Use event
   notifications for normal waiting. Checkpoint owned resource IDs immediately.
   After the final handback, run independent outcome checks against a stable task
   candidate and settle task activity. Re-read actor lifecycle state after finish;
   resolve an active/finished mismatch before writing the version 1 resource
   settlement. Apply **Before sealing** in
   e2e/WORKSPACE_PROTOCOL.md: collect final transcript copies through handback and
   settlement, collect the coordinator's native session with `collect-coordinator`,
   freeze the settlement with `collect-resources`, reconcile interventions, and
   verify receipts before sealing.
   Keep agents/workspace visible for Human inspection unless archive was requested.
5. Have a fresh independent Paseo reviewer evaluate the frozen evidence against
   every scenario assertion and U1–U7. Supply the objective and evidence, not a
   proposed verdict. Import the separate review. A task's SLP Reviewer and the
   suite's acceptance reviewer have different responsibilities. Missing evidence
   is BLOCKED, observed noncompliance is FAIL, and untouched cases stay NOT_RUN.
6. Continue through all selected runnable rows, including unrelated selected rows
   after failures.
   Record BLOCKED for unmet prerequisites/dependency gates and NOT_RUN with a
   reason for a budget boundary or Human stop. Resume only unfinished work within
   the mandate. Preserve failed attempts; package repairs require a new run and
   candidate, with affected scenarios rerun. Finish with the complete summary,
   evidence/review paths, all attempts, intervention counts and unsettled resources.

Completion means every planned row has been accounted for and owned resources
have receipts or explicit unresolved status. Never stop after a smoke test and
call the full suite successful. Missing live capability is a reported limitation,
not an invitation to substitute a mocked PASS. Local collector/fixture checks are
not live SLP acceptance. A raw `npm run e2e` prints the session entry instructions;
the coordinating agent must then carry out this workflow.

## Prepare the task repository

The source checkout hosts the coordinator; the fixture hosts the SLP task.
Missing .paseo-slp files in the package checkout are normal. Use the fixture's
absolute root. e2e/WORKSPACE_PROTOCOL.md governs testing, not the fixture's role tactics.

For ordinary profile-based task scenarios:

1. Read fresh Paseo list_profiles/list_providers and discover each saved profile's
   model/settings. For basic-pi/basic-codex, all three slp-{role} profiles must use
   the scenario's matching custom role providers. Human sets these in Paseo Agent
   profiles before testing. Missing/wrong-family profiles or missing models are
   setup blockers: name the profile and ask Human to configure it. A model named
   in chat is not permission to override a saved profile or edit host settings.
2. Record raw discovery receipts and exact profile bundles in preflight. Basic
   attempt configs use settings.source="profiles", settings.profiles and
   settings.providers arrays; begin validates them against the frozen scenario.
   Follow prelaunch confirmation in e2e/WORKSPACE_PROTOCOL.md.
3. Use the fixture helper and installed onboarding workflow within setup authority.
   Complete .paseo-slp/WORKSPACE_PROTOCOL.md with scope, topology, checks, budget
   and settlement. An empty catalog from init is valid for profile-based work;
   preserve it instead of generating runtime overrides. Capture setup bytes.
4. Verify the installed candidate and fixture workspace, and prove baseline failure.
   Refresh profiles before launch; if settings changed since approval, reconcile
   preflight first. Create only the Supervisor via Paseo using its saved profile.
   Optional prepare uses fresh profiles/providers inventories, without binding or
   catalog overrides. Supervisor/Lead read their child profiles themselves.
5. Capture each parent's selected profile, exact create request/response and actual
   child settings. Require them to match under U2. Finish ordinary evidence,
   settlement and independent review as above; profile discovery alone is not PASS.

For explicitly selected catalog/routing scenarios, prepare only their required
catalog and declared stimuli. Label their runtime source separately; they cannot
substitute for basic profile acceptance. Onboarding rows retain their absent-file
baseline and let fresh setup actors discover the skill and produce its expected
files; coordinator setup does not pre-satisfy onboarding assertions.
