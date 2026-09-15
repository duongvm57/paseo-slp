// Canonical entry point for the collector. The implementation is split by
// layer — runs (storage) < ledger (evidence) < integrity (seal/review) <
// report (read models) < gate (creation gates) — this facade preserves the
// single import surface the CLI, tests and docs already use.
export { sourceRoot, fixture, defer } from './runs.mjs';
export { collect, collectCoordinator, collectResources } from './ledger.mjs';
export { seal, review, reviewAddendum } from './integrity.mjs';
export { summary, attemptStatus, listRuns } from './report.mjs';
export { initialize, begin } from './gate.mjs';
