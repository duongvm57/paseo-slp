---
name: paseo-slp-e2e
description: Run or resume Paseo SLP live E2E dogfood from one coordinating session, for the requested scenarios or full suite, including fixture onboarding, evidence, independent review and cleanup. Use when asked to run E2E or dogfood this package; requires its source checkout.
---

# Run Paseo SLP E2E

The Human can say “run E2E package”. Own the whole run from this
conversation through a consolidated report. Start each new scenario attempt with
fresh Paseo task actors so prior-run coaching does not carry over. Within that
attempt, let Lead reuse Peers under the installed session continuity policy;
correction and re-review do not require new actors merely because the candidate
changed. Explicit scenario requirements for independent seats, replacement or
transport resume still apply. One user-facing session does not mean one actor.

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

## Basic flows

For `basic-pi`/`basic-codex`, follow **Basic flow launch** in
`e2e/WORKSPACE_PROTOCOL.md` instead of the prelaunch confirmer procedure below.
Use the current authorized host and a separate fixture; no isolated daemon or
paid prelaunch confirmer is required. The coordinator completes the config and
uses the checked-in public contract/outcome check. After candidate/profile checks,
fixture protocol and failing baseline, create the Supervisor. Missing draft fields
are preparation work; missing transcript access is a final evidence limitation,
not a task launch gate. Retain independent final review and honest evidence gaps.
Use the protocol's bounded default when Human gave no budget; record a renewed
window on an explicit new run request, preserving previous elapsed history.

## Execute

1. Resolve current authority, host, installed candidate, model/effort choices and
   budget from the Human assignment and existing repo settings. Reuse authorized
   choices. For basic-codex/basic-pi, first read the saved Supervisor/Lead profiles
   and the intended project Peer pool;
   both profiles and eligible pool options must match the basic row family.
   Resolve missing setup before task actors. Do not edit saved profiles to satisfy
   the row; prepare the fixture pool under the current project setup authority.
   Discover the actual Paseo tools/CLI, profiles and providers before
   constructing calls. Record missing capabilities and proof paths. Ask once for
   consequential missing authority/settings only if they prevent the requested
   run; continue independent preparation. This skill itself grants no permissions.
2. Initialize a run, or inspect its summary to resume. Initialization freezes the
   package identity, scenario manifest, checklist and harness identity. Complete
   the concrete prelaunch config before requesting independent confirmation;
   follow **Prelaunch confirmation** in e2e/WORKSPACE_PROTOCOL.md. Record the
   run deadline, resource baseline, permission policy and retention choice; pass
   `scope`/`budget`/`deadline` to `init` through run-config.json so `begin`
   enforces the bound on new launches.
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
   verify receipts before sealing. `status <attempt>` previews which collected
   records discharge their kind and which required kinds remain missing.
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

For ordinary tasks, Supervisor/Lead use saved profiles and Peer uses the project pool:

1. Read fresh Paseo profiles/providers and discover the exact models/settings.
   Only slp-supervisor/slp-lead saved profiles are required. Peer options belong in
   .paseo-slp/slp-routing.json with complete runtime bundles and suitability notes.
   Basic rows constrain both profiles and eligible Peer options to their family;
   mixed-peer uses options from both families without requiring saved Peer profiles.
2. Record raw inventories and proposed pool bytes in preflight. Basic configs use
   settings.source="profiles-and-peer-pool", settings.profiles, settings.providers
   and settings.peerPool (the catalog object). begin validates Supervisor/Lead and
   eligible Peer options; it does not choose the Peer's option for Lead.
3. Create the fixture and apply installed onboarding. Complete its protocol and
   populate the approved pool. Init's empty catalog is only a scaffold. Preserve
   unrelated fixture content and existing Human choices; never import another
   project's options implicitly. Capture the exact pool bytes/hash.
4. Verify installed identity, actual fixture workspace and failing baseline.
   Refresh profiles/providers/pool before launch, reconciling changed configuration.
   Create only Supervisor via Paseo from its saved profile. Supervisor discovers
   its Lead profile; Lead reads the project pool and chooses each Peer option.
5. Capture profile/create arguments for Supervisor/Lead and the fresh option ID,
   catalog hash, suitability rationale and actual bundle for each Peer. U2 compares
   launches against the corresponding source. Catalog availability alone is not
   PASS. Complete evidence, settlement and independent final review as above.

For routing scenarios, apply only their declared pool stimuli and record every
configuration version and subsequent launch. They test pool refresh/rejection,
not a different default delegation mechanism. Onboarding rows retain their absent-file
baseline and let fresh setup actors discover the skill and produce its expected
files; coordinator setup does not pre-satisfy onboarding assertions.
