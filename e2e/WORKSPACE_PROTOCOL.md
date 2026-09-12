# Package dogfood protocol

This is the repository tactic for running the package's E2E suite. It does not
change global SLP roles or grant runtime authority. A run tests one frozen package
candidate on explicitly identified host/provider/model/effort configurations.

## Basic flow launch

For `basic-pi` and `basic-codex`, this section takes precedence over the
independent prelaunch confirmation and evidence-access launch gates below.
The objective is to exercise Supervisor → Lead → Peer on a real repair.

Use the current Paseo host and an independent fixture workspace. A separate daemon
or host selector is not required for basic flows; isolation requirements belong
to scenarios that explicitly test installation, global scope or host faults.
Preserve unrelated host resources and obtain runtime cutover authority if needed.

The coordinator checks the installed candidate/bindings, matching saved profiles
and provider availability, then writes the attempt config, creates the fixture,
completes its protocol and records the failing baseline. Use the checked-in public
contract and `e2e/check-outcome.mjs`; no paid confirmer or Human approval of a draft
is required. Launch the Supervisor as soon as these checks pass. Missing draft
fields are coordinator work to complete, not a reason to defer the scenario.

Record a bounded time/agent budget from the assignment. If Human supplied no
budget, use 45 minutes and at most six agents including coordinator, the three
SLP actors and final suite reviewer, with one spare slot. A new explicit request
to run again supplies a new default window; on resume retain elapsed history and
record the renewed window rather than silently rewriting it. An explicit Human
cap or stop remains binding. A future deadline is not a blocker: use remaining
time; at expiry settle activity and report unfinished work.

Collect available evidence during execution. An unavailable native transcript or
other observability path does not prevent the basic task launch: record the gap
and let final review mark the affected criteria BLOCKED. Do not fabricate proof
or claim PASS. Keep final outcome checks, independent acceptance review, frozen
evidence and resource settlement. Report task execution separately from evidence
qualification so an evidence gap cannot be mistaken for an unattempted workflow.

## One-session ownership

The coordinating session owns suite progress, evidence and the consolidated
handback. Paseo owns all live scenario actors, independent reviewers, workspaces
and wake sources. Actors use installed SLP entry paths; the coordinator gives the
initial assignment and declared external stimuli. Lead still selects runtime
options, creates its Peers, reconciles their evidence and owns task acceptance.
An external suite reviewer owns only the E2E verdict.

Use one writer for the run ledger. Persist each created resource's host ID, owner,
scenario/attempt, creation receipt and required settlement action immediately.
After interruption, read the ledger and inspect the recorded resources before
resuming; an unfinished attempt is resumed, not launched again. Do not infer
parentage from labels or relocate existing user agents into the suite.

## Preflight and authority

Resolve the Human's existing mandate once for the whole run: fixture locations,
isolated host installation/reload, project/global skill placement, agents,
worktrees, model/effort/budget, controlled faults, permission responses, stop,
recovery and resource cleanup. Reuse it for all scenarios it covers. Commit,
push, deployment and changes to unrelated repositories require their own grants.
Fixture worktree scenarios need an authorized fixture-only base commit; the
fixture helper itself only initializes Git and never commits.

Prefer an isolated test daemon/home with existing authorized provider access.
Discover how the actual host accepts configuration and tool calls; a directory
called “test home” does not prove process isolation. Global skill scenarios need
an isolated user scope or specific permission to change and restore the real
scope. Record existing sessions, config, workspaces, scripts, terminals, schedules
and observable task processes before mutations. Preserve unrelated resources.
Missing isolation/authority marks the affected rows BLOCKED; continue other rows
whose prerequisites are available.

The attempt config pins host/provider versions, actual model/thinking/mode/features,
candidate install paths, budget and the independent confirmer's prelaunch approval
of checklist/outcome check. Use fresh Human-configured role profiles; no model
defaults belong in this protocol. Bound total
run cost/agents/time as well as each attempt, counting reviewers and retries.
Where cost telemetry is absent, record that limit; agent/time caps do not prove a
monetary cap. Record startedAt and deadline before run preparation begins; include
setup, confirmation, retries, collection and review in elapsed time. Reserve time
and an agent slot for final review. Resume preserves the deadline; a new budget
requires Human authority. At the deadline stop launches and observation, then
finish authorized settlement and report any unperformed review as NOT_RUN.

### Prelaunch confirmation

Give the confirmer the frozen checklist, public task contract, external check
implementation and a completed draft containing candidate/binding, actual host
discovery, role settings, budget/deadline, evidence paths and cleanup/retention.
It judges whether the proposed check and procedure can test the assignment.
The fixture is created after approval and `begin`; its failing baseline and final
profile/settings verification are subsequent launch gates. Spawn parentage, proof, verdict and
cleanup are postlaunch evidence, not prerequisites for approving this plan.
Correct an incomplete draft and have the same confirmer reassess the corrections.

Compare the installed candidate with the frozen source and verify host bindings.
Task settings must match the Human-configured saved role profiles. For basic-pi,
Human sets slp-supervisor, slp-lead and slp-peer to the corresponding slp-pi-{role}
providers; for basic-codex, to slp-codex-{role}. Human selects the model and optional
thinking/mode/features for each profile in Paseo Settings → Agents → Agent profiles.
A scenario name or a model mentioned in chat does not authorize coordinator edits
to those profiles. If a profile is missing, incomplete or in the wrong family,
request that Human configure it and record the exact mismatch. Stop before creating
a confirmer or task actor until this prerequisite is met. Full-suite requests
need Human configuration at each family transition, or explicitly authorized
isolated hosts with the corresponding Human-configured profiles.

For these basic rows, begin requires settings.source="profiles", settings.profiles
(the list_profiles array) and settings.providers (the list_providers array).
It validates all three saved role bundles against the scenario family and records
settings.roles derived from those profiles. This is a local consistency gate;
raw discovery receipts, freshness and actual launch settings still need review.
Candidate alignment uses upgrade/reload only under current runtime authority.

Before task launch, inspect the selected modes and permission behavior for the
role's required reads, delegation and fixture writes. Record the authorized
permission-response policy; mode names alone do not prove permission-free use.
Resolve known setup gaps within existing authority. Preserve explicit mode choices
and host safeguards; record any remaining gate rather than silently broadening
access. Any permission response during observation remains an intervention.

## Execution and evidence gate

Honor a Human-selected subset; record unselected rows NOT_RUN with the scope reason.
For full-suite runs, run isolated setup/onboarding and basic-codex/basic-pi first. Advanced
rows list their basic-flow dependencies in the manifest. These gates apply to
the same candidate and host setup. A gate failure blocks dependent rows; direct
Lead, transport, routing and independently runnable notification checks may
continue within the selected scope. Every row remains in the report. Report a
scoped basic run as such, without implying the full suite passed.

Before a paid launch, prove an available collection path for its required
evidence. Inventory tool declarations and inspect actual read-only output to
establish access. Required U2 evidence includes provider command, installed bytes,
actual initial/resume input, launch settings, parent create arguments and the
triggered reference reads. Curated activity summaries and agent self-reports do
not replace those records. Record a host gap before choosing an authorized
fallback. An inaccessible instruction/timeline/resource path leaves the matching
criterion BLOCKED even when the task result is correct.

Use fresh fixture copies. Basic repairs use the quantity defect; integration,
council and dependency trials use independent line-total and discount defects.
Keep external acceptance vectors outside actor workspaces and confirm the public
contract before launch. The coordinator can configure initial eligibility and
scenario constraints, but must not precreate Lead's descendants, choose its
per-spawn routes or supply the code fix. Dependency and sealed-review cases must
use observable scope/visibility boundaries. Record actual boundary violations;
policy instructions alone do not prove filesystem/tool isolation.

### Fixture setup and launch gate

The coordinator runs in the package checkout; task actors run in a separate
fixture Git root. A package checkout with no `.paseo-slp` files is valid. Never
initialize it as a substitute for the fixture or copy this test protocol into
the fixture as its role protocol. The fixture helper creates only the code task.
The E2E skill's **Prepare the task repository** procedure supplies the missing
onboarding step, even when only a basic scenario is selected.

Complete the fixture's `.paseo-slp/WORKSPACE_PROTOCOL.md` from the installed
template and current assignment. Set the actual root/owner, writable and excluded
scope, task class, topology/proof gates, concrete time/agent budget, allowed
operations, quota fallback boundary, observation and cleanup policy. For
`basic-codex`/`basic-pi`, require Supervisor → Lead → an Engineer Peer for this
test, followed by proof, Lead inspection/verdict and Supervisor handback. This is
a fixture tactic, not a global prohibition on Lead direct work. Preserve the
public task contract and Human note; use bounded event-driven observation and
create heartbeat only when the selected scenario and mandate require it.
Include this task acceptance tactic in the fixture protocol: for each changed
behavior, Lead derives an expected result from the public task contract and
checks it against the stable candidate independently of the Peer's expected
values. Record the input, contract-based calculation, actual result and verdict.
If the contract supports conflicting interpretations, resolve that premise before
acceptance. Re-running the Peer's tests alone does not establish their oracle.
For a newly generated fixture, replace the template with the resolved tactics
directly; there is no need to retain unused template sections. Existing Human
protocol/routing choices on resume remain authoritative.

For profile-based tasks, the fixture protocol records which saved role profiles
supply runtime settings. An empty catalog created by init is valid; do not populate
it to replace profile settings. Preserve existing catalog bytes. Only explicitly
selected routing/catalog scenarios prepare catalog options according to their
manifest stimulus; that branch does not qualify profile launches.

Before root launch, capture fixture protocol bytes and raw profile/provider/model
and capability discovery receipts. Refresh each saved profile and compare it with
the approved preflight bundle. If Human changed it, update the preflight confirmation
before launching rather than using stale bytes. Preserve prior receipts on resume.
A missing model or unsupported setting is a profile setup blocker for Human.

Verify the task workspace's actual path equals fixtureRoot on the target host.
Create only the Supervisor with its saved profile's provider/model and settings,
using Paseo create_agent. Optional prepare takes repository, workspaceId, assignment,
role and fresh profiles/providers inventories; omit binding and route overrides.
It returns create arguments and creates no agent. Record profile ID, exact saved
profile, create request/response and actual runtime settings. Supervisor and Lead
refresh their own child role profiles before each delegation. U2 must trace every
launch back to the corresponding Human-configured profile; matching a custom
provider alone does not establish profile usage.

Onboarding scenarios deliberately start with their declared absent/existing-file
baseline and test fresh-session skill discovery. Let those setup actors produce
the files; coordinator initialization must not pre-satisfy their assertions.
Neither this exception nor an installation trial permits a subsequent code task
to launch with unresolved repo protocol or required profile settings. Negative routing rows may remove
or invalidate config after recording a valid baseline, at the declared trigger.

For each row pin the outcome appropriate to the branch. Repair/integration uses
the external checkout contract. Onboarding uses discovery and preserved config;
installation uses live loading and config preservation. Stop tests succeed by
honoring the stop and settling resources, and may leave the code task unfinished.
Negative routing tests expect explicit rejection without a spawn, followed by an
authorized positive control. An expected rejected action is not itself suite FAIL.

Capture raw evidence as it becomes available. Append each operator action with
timestamp, actor/request ID, action/response, authority, phase (setup, observation,
settlement) and source receipt. Include permission approvals/denials and corrective
prompts even when authorized or sent by another coordinating session. Reconcile
the ledger with coordinator transcripts before reporting duration and counts;
unknown counts remain unknown. Authorized permission handling is still intervention,
and task success with assistance is distinct from an unassisted workflow.
Predeclared Human decisions, stop stimuli and fault injection are part of a test;
coaching a stalled role, doing its work or editing the candidate to rescue the
attempt is assistance and prevents an unassisted PASS. Keep that attempt and use
a fresh one after a repair. Unexpected product decisions return to Human within
the original mandate, without repeatedly asking routine setup questions.

## Faults, waiting and settlement

Declare the trigger, target and injection layer before each fault test. Quota JSON
changes test catalog selection only. A quota simulation must enter the discovered
provider/host error boundary and expose the corresponding real host signal;
label it simulated. Genuine provider quota behavior remains unqualified unless
actually observed. An unavailable injection facility blocks that scenario.

Use Paseo's finish/error/permission notifications; collect evidence when signalled.
Heartbeat trials use actual timed delivery to the caller/owner with maxRuns or
expiry and owner-scoped deletion receipts. Discover the host's actual semantics.
Neither a manual prompt nor a new-agent schedule substitutes for a heartbeat.
Record gaps in list/delete/access capabilities instead of assuming a schedule
inventory lists heartbeats.

A time budget ending closes observation, not lifecycle. Execute only authorized
stop/cleanup. Settle descendants, pending permissions, scripts, terminals,
task-owned processes and wake sources, then collect after-state and a bounded
late-wake observation for applicable rows. Preserve receipts even if cleanup fails.
For this repository's dogfood, retain agents and workspace visibly for Human
inspection by default. Carry this retention choice in the fixture protocol and
root assignment so descendants follow it. Cleanup means settling activity and
wake sources; archive requires an explicit request. Retained agents are intentional
resources: record IDs, owner, stopped/finished activity and absence of pending
task work, callbacks or processes. Idle alone is insufficient. When archive is
requested, save artifact bytes first and collect its actual receipt before seal.
Unknown settlement is U7 BLOCKED; observed abandoned resources are U7 FAIL.
Freeze the final evidence after settlement. The suite reviewer is a suite-owned
resource outside the scenario tree: record its launch/result/settlement beside
its separate review before the suite handback, and account for the coordinator's
own wake sources. Review must not mutate the scenario's frozen report.

### Before sealing

Apply this audit after task handback (or stop/failure settlement), before `seal`:

1. Copy each actor's raw transcript again after its last relevant event. Keep
   earlier copies as checkpoints. Correlate agent/runtime IDs, capture time and
   final event with the host record; verify that final copies include each parent
   spawn request/response, Peer proof, Lead inspection/verdict and Supervisor
   handback where required. For stop/failure, capture that branch's final report.
2. Collect the coordinator's relevant raw requests/responses as kind `coordinator`, including root
   launch, operator interventions and settlement. Preserve source provenance;
   use a fresh run-only coordinator context so its native transcript is safe to
   freeze. Agent ID labels or a curated summary do not replace host parentage and
   actual spawn evidence. Use `collect-coordinator <attempt>
   <native-session.jsonl> <native-session-id>` to embed the native transcript bytes,
   then decode the collected record to inspect them. Version 2 rejects sources
   inside the run directory and requires the session ID in both filename and JSONL.
   If native bytes are unavailable or require redaction, declare the gap rather
   than reconstructing a transcript from the ledger.
3. Bind actor checks, external outcome checks, artifact bytes and before/after
   verification snapshots to the stable task candidate. Record actual commands,
   outputs and exit codes; a hand-written success summary is not a check receipt.
4. Reconcile intervention counts and elapsed time, and collect actual resource
   settlement receipts plus the retained-resource inventory. After a finish event,
   read each actor again until the host exposes a terminal state. If it still shows
   an active turn, use the authorized lifecycle settlement operation and re-read it;
   do not combine `running` and `finished` into a synthetic terminal label. Freeze
   the reconciled version 1 receipt with `collect-resources`. An unresolved entry,
   active/unknown actor state, cleanup plan or path to a live log cannot satisfy U7.
5. Index the required events to collected files for each assertion and U1–U7.
   Inspect decoded collected bytes, not only original source files or evidence
   kind names. Fill accessible gaps before sealing; if proof is unavailable,
   collect the available receipts and use `seal <attempt> <gaps.json>` with
   `{ "gaps": [{ "kind": "missing-kind", "reason": "concrete host gap" }] }`
   for every missing kind. The incomplete report cannot receive PASS.

`seal` requires a nonempty evidence index and a nonempty payload for every
required kind, including valid `coordinator` and `resources` receipts, unless that kind has an explicit
unavailability declaration. Rejection leaves the attempt open for collection.
These are integrity and structural checks, not event completeness or a verdict. The reviewer must be able to reach
its judgment from these frozen bytes. After sealing, keep new evidence in a
clearly labelled supplement; never rewrite the report or imply an earlier review
covered later evidence. A later reassessment needs a separately identified evidence
set and independent review under remaining authority and budget.

## Acceptance and reruns

For non-basic scenarios, Human or a fresh independent reviewer confirms the
outcome check and frozen docs/review-checklist.md before launch. At completion, a fresh Paseo reviewer gets
the objective, public contract, frozen evidence, assertions and checklist, with a
neutral brief. It verifies participant/parentage evidence and the unchanged task
candidate. Reviewer assertions are judgments; the collector checks integrity and
completeness and cannot certify their truth.

PASS requires every U1–U7 criterion and scenario assertion supported by evidence.
FAIL means observed violation. BLOCKED means missing prerequisites or proof.
NOT_RUN means unattempted/unreviewed, or budget/stop prevented execution. Record
the reason, source and scope for each deferral. Default repetitions are declared
per row; they are bounded trials, not a statistical reliability claim. Any failed
attempt keeps the row FAIL for this candidate even if a retry passes.

Seal task evidence and keep independent reviews separate. Package, skill, harness
or acceptance changes require a new run identity. The previous run remains intact;
record impacted scenarios, rerun them and identify any older unaffected evidence
explicitly rather than marking unexecuted rows PASS in the new run. Hand back the
whole matrix, attempts, exact evidence/review artifacts, checks, interventions,
budget use, and all unsettled resources. Textual policy coverage stays separate
from observed live behavior.
