# Anti-pattern investigation reference

Supervisor consults this at workflow audit and on material drift/failure signals;
Lead consults it for repeated corrections, architecture uncertainty or reasoning
drift. These are operational hypotheses distilled from operating guide §9, not
automatic diagnoses or independently validated detectors. Numerical examples and
response wording are heuristics. Repository thresholds belong to its protocol.

Select relevant patterns using observed evidence. Gather counterevidence, ask an
open question and reconcile the answer. Escalate only within authority. Independence
means evidence-backed judgment, not performative disagreement. Peers receive relevant
guards/questions through their assignment rather than this whole audit catalog.

| Guide / pattern | Signal and suspected mechanism | Evidence to inspect | Open question and bounded response |
|---|---|---|---|
| §9.1 Authority-gradient compliance | Unexamined agreement follows a brief containing the preferred verdict. | Original brief, premise checks, alternatives and counterexamples. | What evidence supports or challenges the premise? Reframe around outcome; allow confirm/partial/challenge/block without demanding opposition. |
| §9.2 Perfect-plan trap | File/API/lifecycle choices are fixed before exploration; workers inherit untested assumptions. | Plan decisions versus discovered contracts and Peer discretion. | Which choices are provisional? Restore outcome/constraint briefs and reopen rights. |
| §9.3 Parachute instead of brakes | Repeated symptom patches add complexity while one root mechanism persists. | Sequence of corrections, failures and ownership path. | What shared mechanism explains these failures? Pause incompatible patches and investigate that mechanism. |
| §9.4 Architecture lock-in | Each feature needs new exceptions protecting the original foundation. | Adapters, migration cost, alternatives and failure semantics. | Under what evidence would this architecture be replaced? Seek independent alternatives and reversal conditions. |
| §9.5 Architecture fog | Many abstractions conceal state ownership and transitions. | Concrete state owner, lifecycle, failure behavior and abstraction callers. | Which behavior disappears if this layer is removed? Make ownership explicit before adding wrappers. |
| §9.6 Moving-scope collision | Writers overlap or review observes changing files. | Actual checkout paths, owner map, write times and candidate identities. | Who owns this moving scope and which candidate is frozen? Isolate or serialize writers; restart invalidated review. |
| §9.7 Self-benchmark/self-acceptance | One author sets metric, implements and declares success with shared blind spots. | Who chose success criteria, benchmark provenance and independent evidence. | What outcome could this benchmark miss? Bind success to owner criteria and independent review where risk requires. |
| §9.8 Test-shaped proof | Tests match implementation while mocks erase relevant failures. | Decided behavior, mock boundaries, actual integration/failure path. | Under which wrong mechanism would this test fail? Add appropriate outcome evidence rather than coverage for its own sake. |
| §9.9 Overengineering | Infrastructure cost grows beyond a small edge case's impact. | Frequency, impact, maintenance burden, simpler fallback and reversal cost. | What cost/risk justifies this machinery? Compare simpler options before extending it. |
| §9.10 Polling/loop debt | Repeated unchanged status or identical retries consume attention; heartbeat becomes a worker. | Timeline deltas, retry prerequisite changes, wake prompts and resource IDs. | What new evidence makes another check useful? Inspect prerequisite/quota/auth/authority, then use event waits and bounded wakes. |
| §9.11 Ceremony capture | Seats, votes and reports grow without decision-changing evidence. | Mandates, independent propositions, cost and decisions changed. | Which unresolved proposition needs another seat? Reduce to the smallest useful topology and bounded debate. |
| §9.12 Framing capture | All alternatives inherit a possibly wrong problem frame. | Neutral problem statement, hidden assumptions and lane briefs. | Could the actual problem require an option outside this framing? Let a fresh Architect reconstruct it before seeing preferences. |
| §9.13 Forked independence | A reviewer inherits the Lead's framing and is labeled independent. | Session creation/parentage, initial context and report visibility. | What context did this reviewer inherit? Use a fresh neutral session; record leaks into sealed work. |
| §9.14 Lead attention dilution | Frequent explanatory detours displace coordination. | Conversation trajectory, lost decisions and dependency/owner map. | Which questions require Lead's project context now? Offer advisory/Supervisor synthesis and relay concise owner decisions. |
| §9.15 Skill pollution | Lead sinks into framework details or Peer starts orchestration. | Loaded skills/tools, assignment and resulting actions. | Which skill belongs to this outcome and authority? Keep macro skills with Lead, observation skills with Supervisor and micro skills with Peer. |
| §9.16 Status-as-acceptance | Idle/finished/tests-pass is promoted to a verdict without artifact inspection. | Exact candidate, diff, commands/results and acceptance owner. | Which artifact and evidence support this verdict? Recover the evidence chain or report the missing proof. |
| §9.17 Supervisor overreach | An observer implements, directs Peer or takes a technical verdict without mandate. | Human grant, owner map and intervention messages/diffs. | Which mandate covers this intervention? Return technical decisions to Lead or obtain bounded recovery authority. |
| §9.18 Tests mint contracts | Red tests invent fields/interfaces/adapters before contract decisions exist. | Contract/decision source, test history, mock shapes and production changes. | Where was this behavior/representation decided? Reopen ownership/API before contract-level tests pin the assumption. |
| §9.19 Context-branch contamination | Lead absorbs large new domains and loses the original trajectory. | Dependency origin, objective drift and missing integration decisions. | Can this dependency return a bounded contract/result? Separate a lane/Lead within authority and define handback. |
| §9.20 Verdict-first supervision | A diagnosis precedes evidence and induces confirmation-seeking. | Observation chronology, question wording and counterevidence. | What observations would disprove this hypothesis? Lead with evidence and an open question before recommending correction. |

Record observation, evidence, suspected mechanism, impact, question, response and
outcome using references/governance.md. Lead reports relevant causal evidence to the
assigned Supervisor; without one, keep it in the task handback. Only durable patterns
justify policy changes; keep unresolved hypotheses visible.
