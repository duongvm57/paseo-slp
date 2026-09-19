# Duplicate Peer after interrupted creation

Observed run: `20260912-full-manifest-live-001/basic-pi/attempt-001`.
This is a trace-based diagnosis, not a deterministic reproduction or a passing
retest. Existing run evidence and verdicts remain unchanged.

## Timeline (UTC, 2026-09-12)

| Time | Native session event |
|---|---|
| 07:20:28.819 | Lead requests first Peer creation. |
| 07:20:36.176 | Supervisor sends corrective prompt based on an earlier provider validation error. |
| 07:20:36.241 | Lead receives `This operation was aborted` for creation. |
| 07:20:55.539 | Lead's inventory contains Supervisor and Lead only. |
| 07:21:05.457 | First Peer starts reading the fixture. |
| 07:21:10.967 | Lead interprets the empty inventory as proof of no side effect and requests a replacement. |
| 07:21:18.880 | First Peer edits lines.mjs to multiply unitCents by quantity. |
| 07:21:39.477 | First Peer creates contract.test.mjs. |
| 07:21:59.658 | Second Peer reads the test while the first Peer is still working. |
| 07:22:12.481 | First Peer corrects the 101-cent discount expectation to 51. |
| 07:22:32.410 | Second Peer attempts the same edit from stale content. |
| 07:22:32.427 | Second Peer's edit fails: exact old text not found. |

## Findings

The first creation had a side effect despite its aborted response. The Lead did
check inventory, but absence there was not proof of cancellation. Two Peers held
overlapping write authority. There was a real stale edit attempt, not evidence
of two successful overwrites: the second tool rejected the edit. Its later claim
that its edit applied despite the error is contradicted by the first Peer's earlier
successful edit. The first Peer also corrected two arithmetic errors in its own
tests; the production repair was already correct.

The Supervisor's corrective prompt precedes the abort by 65 ms while create was
pending. This supports an interruption hypothesis, but host request/abort tracing
is needed to prove causation. The source package does not implement Paseo's
create cancellation or inventory publication. No host source was changed.

## Repair

`src/delegation.md` now reserves ownership after an ambiguous create result and
requires resolution of the original operation before replacement. Empty inventory
alone is insufficient. `src/references/monitoring.md` now requires checking current
progress before corrective prompts and carrying pending mutations into recovery.
These address the observed decision errors without changing E2E assertions.

## Validation and limits

The native trace establishes the failure, but replaying it does not exercise a
fixed policy. There is no deterministic abort/delayed-publication injection seam
in this package. A live regression must arrange a create whose response is aborted
while the child is still starting, then observe the parent reconcile the same
child without granting duplicate ownership. A normal successful basic run cannot
validate that fault case. These source policy edits are not installed, and no live
retest or host fix is claimed. Local package tests only check packaging/transport
and collector contracts, not agent behavior.

## Native provenance

All sessions below reside under
`/home/duongvm/.pi/agent/sessions/--home-duongvm-projects-paseo-slp-.e2e-runs-20260912-full-manifest-live-001-basic-pi-attempt-001-workspace--/`.

- Supervisor d93860f9-23e9-47bf-855b-ba5d5480a716:
  `2026-09-12T07-16-47-376Z_01a09479-d490-7412-8d7c-f99a5681ca97.jsonl`
- Lead 16efb23e-e3c8-45e5-8c36-317316bdbc50:
  `2026-09-12T07-18-23-920Z_01a0947b-4daf-7502-82f2-a67da97526d3.jsonl`
- First Peer fa306878-2238-4c5d-a14b-0c1745c0f1d5:
  `2026-09-12T07-20-43-746Z_01a0947d-6fe1-762d-b020-3b4b515be3bb.jsonl`
- Second Peer 8b905ce8-437d-44a8-95b9-f591612327c4:
  `2026-09-12T07-21-29-000Z_01a0947e-20a6-7256-bd5d-f5c459ccdeb4.jsonl`
