# Draft first E2E review — NOT CONFIRMED

Derived from supplied guide §11 .
Human or a reviewer independent of the package implementer confirms this and a
job-specific outcome check before launch. Record confirmer and frozen file
identity in the request. Implementer has not signed this checklist or a PASS.

| Criterion | Evidence needed |
|---|---|
| U1 Outcome | Real objective and independently chosen check; baseline, final artifact, exact output and exit status on a stable work snapshot. |
| U2 Entry/instructions | Source + installed identity, actual installed file paths, root launch arguments, each parent's create_agent arguments and child's actual initial input. Compare full common/role/procedure bytes and bindings; titles or self-claims cannot prove loading. Record source-code reads needed to rescue normal usage. |
| U3 Topology/ownership | Host ParentAgentId and workspace inventory show Supervisor → Lead → Peer; assignment/trace identify the Peer as sole writer; artifacts preserve unrelated changes. No native second control plane. |
| U4 Acceptance | Peer proof, Lead's actual inspection and verdict refer to the same unchanged work snapshot; distinguish package candidate identity from job candidate identity. Findings remain visible. |
| U5 Human attention | Operator intervention log, launch-to-handback duration, routine assistance count and real owner decisions. No coaching, approval on behalf of agents, restart or candidate edits during observation. |
| U6 Honest handback | Supervisor relays Lead verdict, actual checks, unresolved assumptions, authority limits and missing evidence. Idle and check success alone are insufficient. |
| U7 Settlement | Host evidence for task descendants, pending permissions, workspace scripts, terminals, schedules/heartbeats and task processes. Idle alone does not prove callbacks/processes settled. Preserve pre-existing resources. |

Record review and outcome check as NOT_RUN until performed. Reviewer writes a separate
review file referencing frozen evidence hashes; never edits report.json. Use
PASS only when all seven have evidence, FAIL for observed violations, BLOCKED
for missing prerequisite/proof. A timeout is the end of observation, not an
implicit cancel. If curated CLI logs omit launch input or final report, obtain
actual host timeline evidence in the independent review; otherwise U2/U4 remain
BLOCKED. Role candidates seen in text are only search hints.

Record stop/recovery/concurrency as unverified unless actually exercised. One
successful job qualifies only that job, provider and candidate.
