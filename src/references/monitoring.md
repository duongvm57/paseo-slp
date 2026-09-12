# Events, heartbeat and settlement

Supervisor and Lead read this before observing or waiting on work, and at settlement.
An event signals attention; a detector recognizes a possible pattern; a heartbeat
wakes a session periodically. Judgment and authority remain with Supervisor/Lead.
The package supplies policy, not a background detector or a second lifecycle runner.

## Establish the observation path

Record assigned project/task, observer and Lead IDs, scope, baseline resources,
material evidence cursor/checkpoint and the agreed reporting route. Discover the
host tools available in this session; surface missing capabilities before choosing
a fallback. Finish notifications, timeline visibility, heartbeat creation/deletion
and cross-session reporting are separate capabilities.

Use create_agent/send_agent_prompt with notifyOnFinish=true for completion, error
and permission wakes. While work is active, material signals include major design
decisions, ambiguity, reopen/dependency requests, changed assumptions, repeated
failures, stalled progress and stable candidates/findings. When a Supervisor is
assigned, Lead sends decision, evidence reference and needed attention to that
Supervisor's agent ID as a bounded report; a Peer reports to Lead the same way.
Resolve a recipient's ID from the assignment or from the child's
paseo.parent-agent-id label. Keep reports material: a verdict, handback, blocker or
changed assumption always warrants one, and an informational report needs no
acknowledgment prompt in reply.

If the host has no semantic event bridge, record that gap. Finish callbacks alone
do not prove mid-task detection. Explicit material reports and, when justified,
low-frequency heartbeat are available fallback choices. A cheap detector may emit
signals if provided by the host; it does not issue project verdicts. If no authorized
wake/report path meets the job's observation need, report the dependent work BLOCKED.

## Heartbeat safety net

Use a heartbeat when the task's duration/risk and incomplete event coverage warrant
periodic observation within the assignment. Cadence, timezone, expiry/run bounds and
observer ownership are repository/assignment choices; there is no universal 15-minute
rule. Before ending a turn with delegated work still outstanding, arm a bounded
task-local fallback wake and record it; cancel it once that child's report is in
hand. A finish notification you are waiting on promises a future turn without
guaranteeing one.

The observing session calls Paseo create_heartbeat with prompt and cron, plus
timezone, name, maxRuns and/or expiresIn as appropriate to the agreed boundary.
It prompts that same session; it does not target an arbitrary Lead/Supervisor ID.
Before creating, check the session's recorded task heartbeat receipt to avoid
duplicates. Record the returned ID, owner session, task scope, cadence, expiry and
stop condition durably in the timeline/notebook. Require a bounded lifetime for
task-local fallback wakes so an interrupted owner cannot leave them indefinite.

The prompt identifies the task/observed agents, last evidence checkpoint and asks
the observer to inspect only material delta, test hypotheses and escalate within
authority. It must not assign implementation or revive work after Human stop.
After a wake, advance the checkpoint if there is new evidence; with no material
change, take no intervention. Return to event-driven waiting instead of looping.

The exposed MCP surface has create_heartbeat and delete_heartbeat({id}); no heartbeat
list/update operation is assumed. Preserve receipts across handoff/compaction. To
change cadence, the owning session deletes its old heartbeat, confirms the result,
then creates a replacement if still needed. A missing receipt or deletion capability
is an explicit settlement gap, not grounds to invent an API or claim cleanup.

create_schedule starts a fresh agent on each cadence. It is not a substitute for
waking an existing observer. Use it only for assigned recurring fresh-agent work
after discovering and validating role loading, placement, parentage and settings;
the normal create_agent profile mapping cannot simply be assumed for schedules.
Record owned schedule IDs and stopping conditions when that separate path is used.

## On a signal

Inspect the indicated agent status/activity and only relevant timeline/Git/workspace
delta. Retrieve the actual report/candidate: curated activity may omit full evidence.
If a discovered host timeline path cannot recover it, report the evidence gap rather
than infer an outcome. If action is needed, use observation → evidence → hypothesis →
open question to Lead. Use references/anti-patterns.md for suspected drift and repeated
failures. Distinguish idle, external waiting, permissions, missing prerequisites and
actual lost momentum.

Before sending a corrective prompt, check current activity: an earlier tool error
does not establish a stall if the agent has moved on. A prompt to a running agent
may interrupt an in-flight mutation; do not use it as a routine status nudge.
Preparation commands, corrected requests and acceptance checks are progress.
Compare the latest activity with your prior checkpoint before diagnosing lost
momentum. A turn ending while a known child is running is an event-driven wait;
on the child's finish, let the owner retrieve evidence and complete acceptance.
Send a continuation only for an evidenced idle owner with actionable work and
no pending wait, or under an explicit recovery mandate. Record every prompt
separately with its timestamp and observed pre-send state, including prompts
that overlap progress; a later success does not prove the prompt was needed.
When intervention is necessary, preserve the pending operation and its uncertain
outcome in the recovery handback. For interrupted creation, apply delegation.md's
ownership reconciliation before asking for another child.
Identical retries with unchanged prerequisites add no evidence; inspect
quota/auth/tool/authority causes before repeating. Retry thresholds belong
to the protocol; numerical examples in the guide are heuristics.

## Settlement and stop

At task completion, cancellation, handoff or expiry review, reconcile the owner map
with the resource receipts: task descendants, pending permissions, terminals,
workspace scripts, schedules/heartbeats and processes. Human stop halts further
work and follow-ups; cancel owned task agents as authorized by common policy, and
stop the observer's own task-local wakes. Do not start a new cleanup agent after stop.

Each heartbeat owner deletes its recorded task heartbeat and records the receipt.
For another owner's heartbeat, arrange cleanup by that owner during normal handback;
after stop, if no authorized control path exists, report unknown settlement rather
than send a new work prompt. Retain expiry evidence without assuming expiry occurred.
Stop owned task schedules through discovered host controls. Preserve pre-existing
resources and portfolio monitoring whose assignment continues. Stop other owned
resources only within authority; report any that remain active or unknown.

Handback lists candidate/verdict separately from resource IDs, cleanup receipts,
continuing assignments and unknown settlement. Lifecycle idle and a deadline do not
prove cancellation, successful cleanup or technical acceptance.
