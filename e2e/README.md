# Single-session E2E

In a session opened on this source checkout, ask **“chạy E2E toàn bộ package”**.
AGENTS.md routes the agent to `skills/paseo-slp-e2e/SKILL.md`. The coordinating
session executes the requested rows in `scenarios.mjs` using real Paseo actors and
returns one report. Say “chạy dogfood basic-codex” for just the basic Codex chain;
other rows remain NOT_RUN by scope. This entrypoint is for package development; it requires the source
checkout even if the skill was installed separately.

The collector below supplies fixtures, append-only evidence capture, sealing and
review validation. It does not create agents or implement SLP orchestration.
`npm run e2e` prints the session instructions and exits 2 (no live tests ran).
The agent continues through the skill. `npm run e2e -- --help` exits normally.
Live execution and skill discovery remain NOT_RUN until exercised on a real host.

## Commands

Use `npm run e2e -- plan` for the whole manifest, or append a scenario ID for one
row. All paths below are arguments, not shell snippets to interpolate from logs.

```bash
npm run e2e -- init .e2e-runs/run-001
npm run e2e -- begin .e2e-runs/run-001 basic-codex /absolute/attempt-config.json
npm run e2e -- fixture .e2e-runs/run-001/basic-codex/attempt-001
# Complete fixture protocol and verify saved profiles before launching any task actor;
# see Fixture setup below. Then capture actual launch and subsequent evidence.
npm run e2e -- collect .e2e-runs/run-001/basic-codex/attempt-001 launch /absolute/launch-receipt.json
# After handback: settle activity, collect final transcripts and actual receipts,
# then complete WORKSPACE_PROTOCOL.md's Before sealing audit.
npm run e2e -- seal .e2e-runs/run-001/basic-codex/attempt-001
npm run e2e -- review .e2e-runs/run-001/basic-codex/attempt-001 /absolute/independent-review.json
# If the same reviewer corrects its assessment against the frozen report,
# preserve review.json and append an explicitly bound addendum.
npm run e2e -- review-addendum .e2e-runs/run-001/basic-codex/attempt-001 /absolute/review-addendum.json
npm run e2e -- summary .e2e-runs/run-001
```

The coordinator creates the config from discovery and existing Human authority;
the Human does not need to fill out JSON. `begin` requires `operatorId`,
`authority.source`, positive integer `budget.maxAgents` and
`budget.maxWallTimeSeconds`, `host.id`, `host.version`, a `settings` object and
`confirmer: { id, evidence }`. The confirmer must be independent of the operator;
its evidence points to actual prelaunch approval. Include provider CLI versions,
installed package paths/hash, discovered full settings for each planned role,
total-suite budget, applicable grants, outcome check, stimuli, capability receipts
and preexisting resource inventory in that config or linked evidence. The skill
enforces these operational requirements; JSON shape validation alone does not
confirm that authorization, discovery or independent review occurred.

Complete the draft before independent confirmation; see
[Prelaunch confirmation](WORKSPACE_PROTOCOL.md#prelaunch-confirmation) for its scope.
For basic-codex/basic-pi, Human must first configure all three saved SLP profiles
with the scenario's matching custom role providers and chosen models/settings.
The coordinator reads these profiles; it does not edit them or replace them with
fixture catalog options. The basic config requires settings.source="profiles",
settings.profiles from list_profiles and settings.providers from list_providers.
begin derives settings.roles from those inventories and rejects a missing profile,
missing model or wrong provider family before creating the attempt. Record the run's start
and deadline including preparation and review, permission-response authority, and
resource retention choice. Dogfood keeps agents/workspace visible for Human
inspection by default while settling task activity; archive only when requested.

`fixture` creates an exclusive `workspace/` Git repo with a real code defect,
public task contract/test and an unrelated Human note. It does not create protocol,
routing, skill installation or a commit. For ordinary task scenarios the
coordinator performs **Fixture setup** below; this does not depend on an earlier
onboarding test PASS. The onboarding scenarios separately exercise fresh-session
skill discovery and creation/update of those files. Run the check before launch to capture a
failing baseline and after repair against the stable candidate:

```bash
node e2e/check-outcome.mjs /absolute/fixture-workspace
```

Record command, cwd, timestamps, stdout/stderr and exit status as evidence. Keep
acceptance vectors out of the actors' checkout. Worktree scenarios additionally
need an authorized fixture base commit and actual Paseo worktree receipts.

## Fixture setup

The task uses `<attempt>/workspace/.paseo-slp/WORKSPACE_PROTOCOL.md` and
`<attempt>/workspace/.paseo-slp/slp-routing.json`. The coordinating session's package
repo needs neither file. With `fixtureRoot` resolved to that absolute workspace
path and `<installed>` verified against the pinned host candidate:

```text
node <installed>/bin/slp.mjs init <fixtureRoot> --apply
Read and apply <installed>/skills/paseo-slp-onboarding/SKILL.md:
  fill the fixture protocol from the task authority/topology/proof/budget;
  verify the saved Human-configured role profiles through live discovery.
  leave the generated catalog empty for profile-based tasks.
```

These are ordered setup steps, not a shell script: `init` leaves a template and an
empty optional catalog. Complete the protocol; saved profiles supply runtime settings. The exact completion gate and
root launch binding are in [WORKSPACE_PROTOCOL.md](WORKSPACE_PROTOCOL.md#fixture-setup-and-launch-gate).
Record fixture files, exact saved profiles, discovery receipts and validation output with
`collect ... preflight <source-file>` before creating the task's Supervisor.
For `onboarding-*` rows, let the fresh setup actor create/update the files instead.

## Evidence

`collect <attempt> <kind> <source-file>` copies the exact bytes into a new record
under `evidence/`, base64 encoded with a content hash and capture timestamp.
It is a point-in-time copy: later events in the original transcript do not appear
in that record. After final handback and settlement, collect fresh transcript
copies and identify them as final in the evidence index; retain earlier checkpoints.
For coordinator evidence use `collect-coordinator <attempt>
<native-session.jsonl> <native-session-id>`. Version 2 requires a real path outside
the E2E run directory, the session ID in the filename, and the same session marker
inside the JSONL records. It copies the transcript text into an envelope with the
attempt's operator ID, source path, native session ID and computed transcript hash.
The collector does not redact input or discover the session for you. Use a fresh,
run-only coordinator context so its native transcript is safe to freeze. If a native
transcript must be redacted or cannot be accessed, preserve the derived export as
additional evidence and declare the coordinator gap; do not present a run-authored
ledger as native evidence. `collect ... coordinator` cannot satisfy this gate.
Reviewer inspection must still establish relevant requests/responses, completeness
through settlement and authentic host provenance. Older sealed runs retain their
frozen evidence format and historical judgments.
The source should carry actual event time, host/tool source, actor IDs and request
or receipt correlation. Export host records through discovered supported tools;
do not store credentials from host config. If redaction removes required proof,
record the limitation. Decode `bytes` as base64 to inspect the original artifact.

| Kind | Required contents |
|---|---|
| preflight | Capabilities, actual authority, versions, candidate/install bindings, budget, independent prelaunch approval and baseline inventory. |
| launch | Root launch and every parent spawn request/response, profile/catalog bytes/hashes and settings at start/resume/handoff. |
| instructions | Actual session initial/resume instructions and triggered reference reads correlated to installed bytes and provider command. |
| timeline | Full relevant host events, parentage, messages, reports, faults, notifications and owner decisions. |
| coordinator | Raw coordinator requests/responses from setup through root launch, observation and settlement, with source provenance and event times. Reconcile these bytes with the interventions ledger for U5; a curated summary does not substitute. |
| artifacts | Before/after snapshots **and artifact bytes/diffs**, stable candidate identities, sealed reports and integrated result. |
| checks | Exact independent outcome and actor verification commands, exit statuses and outputs on identified candidates. |
| interventions | Declared stimuli, operator assistance/decisions or explicit zero, duration and assistance count. |
| resources | Version 1 structured settlement: creation/owner IDs, terminal actor states, empty pending-permission arrays, settlement operations/receipts, final inventories and late-wake observations. |

Collect each resource receipt as soon as it is returned. Before sealing, write the
final version 1 settlement and use `collect-resources <attempt> <settlement.json>`.
It contains `capturedAt`, `workspace.status`, `taskActors`, and `settlement` with
`observed`, `actions`, and an empty `unresolved` array. Every retained actor has an
ID, role, terminal status, and an empty `pendingPermissions` array. A status that
still contains `running`, `working`, `pending`, or `unknown`, or any unresolved
entry, cannot satisfy the resources gate. A no-actor branch sets
`settlement.noActorsCreated: true` and supplies `noActorsReason`.

Ordinary `seal` refuses an empty evidence index or any required kind without a
valid payload, including `coordinator` and `resources`. It checks before writing
either seal file, so a rejected attempt remains open for collection. These gates
do not judge event completeness; the before-seal audit and independent review
still inspect the decoded bytes.

If proof is unavailable after stop/failure settlement, collect the available
receipts and explicitly declare every missing kind in a file:

```json
{ "gaps": [{ "kind": "coordinator", "reason": "Concrete unavailable host path and attempted discovery" }] }
```

Run `seal <attempt> /absolute/gaps.json` to freeze that incomplete attempt.
Unknown, duplicate, already-present or unexplained gaps are rejected, and a report
with declared gaps cannot receive PASS. No option allows a report with zero
collected records. Use `defer` for an unattempted scenario with no receipts.

`seal` hashes the
attempt config, frozen run manifest and all collected evidence, and records the
current fixture snapshot. A snapshot contains hashes, not the original bytes;
capture artifacts before destructive cleanup. Evidence and attempt config become
immutable to collector commands. Later byte changes are rejected during review
and summary. These are integrity checks, not adversarial storage or tool isolation.

## Independent review

Create a fresh Paseo reviewer with the frozen evidence and checklist. It writes a
separate JSON file. Importing it never edits `report.json`. The review contains:

- `reviewerId`, all scenario actors in `participantIds`, and
  `independenceEvidence` locating the reviewer's actual session/neutral brief.
- `reportSha256` returned by `seal`.
- `criteria` with exactly U1 through U7, and `assertions` in the same order as the
  scenario manifest. Each item is `{ status, reason, evidence }`, where status is
  PASS/FAIL/BLOCKED and evidence lists relative `evidence/0001-…json` paths in the
  frozen report. PASS/FAIL require referenced evidence; BLOCKED explains the gap.

The collector derives the attempt status: FAIL takes precedence over BLOCKED,
then PASS. PASS requires all evidence kinds as well as all criteria/assertions.
The independent reviewer decides whether the evidence actually proves the claim.
Do not generate a passing review by filling every field with PASS.

The suite coordinator preserves the reviewer's launch, completed review and
settlement receipts in the scenario directory beside `review.json`; these are
suite resources and must be included in the final handback. If a factual
correction is needed after the first assessment, use `review-addendum`: it binds
the original review hash, writes an append-only `review-addendum-NNN.json`, and
`summary` uses the latest validated assessment while retaining the original.
The frozen scenario timeline includes its own SLP Reviewer where applicable, a
different actor.

For an unavailable scenario, create a reason file containing
`{ "status": "BLOCKED", "reason": "specific gap", "missing": ["capability or authority"] }`
and run `defer <run> <scenario-id> <reason-file>`. Use NOT_RUN for budget/stop
deferrals. Deferrals do not erase existing attempts or authorize new actions.
Keep incomplete attempts visible; collect/settle/seal/review them before retrying.

`summary` returns every row and attempt. An observed failure stays FAIL for the
candidate; blocked retries remain visible; declared repetitions must be satisfied.
Exit codes are 0 for all PASS, 1 for any FAIL, and 2 for BLOCKED/NOT_RUN. The JSON
is an evidence index and status matrix, not a substitute for the Human handback
required in WORKSPACE_PROTOCOL.md. Preserve its output as the run's final report.

Before `seal`, use [Before sealing](WORKSPACE_PROTOCOL.md#before-sealing) to check
the decoded evidence for the completed chain, real check outputs, all operator
interventions and actual settlement receipts. Evidence kind presence alone does not
prove completeness. Keep task outcome and the independent E2E verdict separate;
supplements created after seal do not change the frozen report or its prior review.
