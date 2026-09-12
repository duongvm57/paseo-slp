import { evidenceKinds } from './evidence.mjs';

// The seven acceptance criteria of docs/review-checklist.md, as code.
// `evidence` names the kinds that can actually support each criterion; it is
// derived from the checklist rows and the `| Kind | Required contents |` table
// in e2e/README.md, and is the mapping a reviewer previously had to hold in
// their head. Every one of the nine kinds supports at least one criterion.
export const criteria = [
  { id: 'U1', title: 'Outcome', evidence: ['checks', 'artifacts'] },
  { id: 'U2', title: 'Entry/instructions', evidence: ['preflight', 'launch', 'instructions'] },
  { id: 'U3', title: 'Topology/ownership', evidence: ['timeline', 'launch'] },
  { id: 'U4', title: 'Acceptance', evidence: ['artifacts', 'timeline'] },
  { id: 'U5', title: 'Human attention', evidence: ['interventions', 'coordinator'] },
  { id: 'U6', title: 'Honest handback', evidence: ['coordinator', 'timeline'] },
  { id: 'U7', title: 'Settlement', evidence: ['resources'] },
];

export const criterionIds = criteria.map(item => item.id);
export const criterionEvidence = Object.fromEntries(criteria.map(item => [item.id, item.evidence]));

// The mapping is only meaningful if both vocabularies stay in step.
for (const item of criteria) {
  for (const kind of item.evidence) {
    if (!evidenceKinds.includes(kind)) throw new Error(`Criterion ${item.id} names unknown evidence kind ${kind}`);
  }
}
const supported = new Set(criteria.flatMap(item => item.evidence));
for (const kind of evidenceKinds) {
  if (!supported.has(kind)) throw new Error(`Evidence kind ${kind} supports no acceptance criterion`);
}
