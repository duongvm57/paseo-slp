# Review gates

A review gate is not one reviewer. When the assignment or protocol requires
independent review of a stable candidate, run parallel Peer seats on split
axes so no axis can mask another. A single reviewer is a degenerate gate —
acceptable only when the protocol explicitly allows it.

## Axes

Two default axes, each on its own fresh seat:

- **Spec** — does the candidate implement what the spec/assignment asked?
  Findings: requirements missing or partial; behaviour beyond the ask
  (scope creep); requirements that look implemented but are wrong. Quote
  the spec line per finding.
- **Standards** — does the candidate follow the repo's documented
  conventions? Sources: the repo's standards documents (AGENTS.md, style
  or contract docs) plus the smell baseline below. Distinguish hard
  violations (documented standards) from judgement calls (baseline
  smells); a documented repo standard overrides the baseline; skip
  whatever tooling already enforces.

When the routing catalog offers a ready option from a different provider
family than the writers, a third **cross-family** seat runs the same axes —
different model families have different blind spots. A blocked seat reports
BLOCKED; it is not permission to merge axes into one seat or to skip the
gate.

## Smell baseline

Fixed baseline applying even when the repo documents nothing — labelled
heuristics, never hard violations: Mysterious Name, Duplicated Code,
Feature Envy, Data Clumps, Primitive Obsession, Repeated Switches,
Shotgun Surgery, Divergent Change, Speculative Generality, Message
Chains, Middle Man, Refused Bequest.

## Seat briefs

Every seat gets a neutral brief: the frozen candidate identity (snapshot
hash or exact commit), its axis, the spec/standards source paths — and
nothing else. No prior findings, no Lead verdict, no writer identity.
The seat verifies the candidate identity before reviewing; a changed
snapshot invalidates the attempt.

Reports stay in-session, bounded: findings quoted against the axis source,
hard violations separated from judgement calls.

## Aggregation

Report axes side by side; never merge or rerank findings into one verdict
list — a candidate can pass one axis and fail the other, and merged
rankings let one axis mask the failure. Corrections route to the owning
lane; re-review returns to the same seat under session continuity. The
protocol may set seats and axes stricter than this floor; it cannot
loosen a required gate into one seat.
