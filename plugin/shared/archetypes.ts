// plugin/shared/archetypes.ts — the seat archetypes the Peer-pool editor's
// "Add seat" picker seeds from. Pure data — the shared-module boundary allows
// only zod/react/@getpaseo/plugin imports, and this file needs none.
//
// Every archetype ships a parked seat: blank provider, blank model,
// enabled:false, availability:"ready" (the only state the form writes) and
// roles:["peer"] — the Human fills provider/model from live catalog
// discovery before enabling. suitableFor/avoidFor are the fields Jev sees;
// notes stays local (Vietnamese-allowed — Jev never receives it). Ids are
// seat names for KINDS of work, not dispositions: disposition is an open
// vocabulary the assignment supplies, so this list is a starting set the
// Human reshapes freely.

export interface SeatArchetype {
  id: string;
  provider: "" | string;
  roles: string[];
  model: string;
  enabled: boolean;
  availability: string;
  suitableFor: string[];
  avoidFor: string[];
  notes: string;
}

const seat = (id: string, suitableFor: string[], avoidFor: string[], notes: string): SeatArchetype => ({
  id,
  provider: "",
  roles: ["peer"],
  model: "",
  enabled: false,
  availability: "ready",
  suitableFor,
  avoidFor,
  notes,
});

export const PEER_SEAT_ARCHETYPES: readonly SeatArchetype[] = [
  seat("lightweight-recon",
    ["recon", "inventory", "triage", "read-only-reporting", "summarize"],
    ["writes", "design", "review"],
    "Cheap/fast seat: read-only exploration and reporting where a small or low-effort model is enough. Fill provider and model from discovery."),
  seat("standard-coding",
    ["implementation", "bounded-fix", "tests", "refactor", "mechanical-change"],
    ["open-design", "deep-debugging", "contract-analysis"],
    "Default work seat: a coding-capable model at normal effort for well-bounded implementation tasks."),
  seat("deep-reasoning",
    ["architecture", "design", "contract-analysis", "falsification", "deep-debugging", "review"],
    ["routine-inventory", "mechanical-change"],
    "Heavy seat: a stronger model or a higher reasoning effort for design, root-cause work and review where mistakes are expensive."),
  seat("independent-second-opinion",
    ["independent-review", "second-opinion", "audit", "falsification"],
    [],
    "Deliberately a different provider family than the implementation seats, so a reviewer is not the same model grading itself. Pick any available non-default family."),
  seat("autonomous-long-running",
    ["long-running-task", "autonomous-execution", "multi-step-workflow"],
    ["quick-lookup"],
    "Seat for long autonomous runs. A Devin-family seat requires a swe-2 model id — fill the exact variant from discovery."),
  seat("test-authoring",
    ["test-writing", "case-design", "spec-to-testcases", "edge-case-hunting"],
    ["implementation", "architecture"],
    "Seat that writes and runs tests against a frozen candidate — the QC checker role, not the implementer."),
  seat("spec-docs-writing",
    ["documentation", "spec-writing", "changelog", "user-facing-prose", "translation"],
    ["implementation", "debugging"],
    "Tech-writer seat: prose quality and accuracy matter more than deep codebase reasoning."),
  seat("security-review",
    ["security-review", "threat-model", "auth-surface-audit", "secrets-hygiene", "dependency-review"],
    ["feature-implementation", "mechanical-change"],
    "Adversarial review seat: strong reasoning plus a security lens for auth boundaries, injection and data exposure."),
  seat("debugging-root-cause",
    ["root-cause-analysis", "regression-hunt", "flaky-test", "performance-regression", "heisenbug"],
    ["greenfield-implementation", "prose-writing"],
    "Diagnosis seat: patience and evidence discipline for bugs whose mechanism is unknown — reproduces before touching code."),
  seat("mechanical-refactor",
    ["large-mechanical-refactor", "codemod", "rename-sweep", "api-migration", "deprecation-cleanup"],
    ["design-decisions", "novel-logic"],
    "Throughput seat: wide, repetitive, well-specified change where consistency matters more than judgment."),
  seat("research-spike",
    ["research-spike", "feasibility-probe", "api-survey", "technology-comparison", "throwaway-prototype"],
    ["production-implementation"],
    "Scout seat: time-boxed exploration that ends in a report or throwaway code — never the production implementation."),
  seat("data-migration",
    ["data-migration", "schema-evolution", "backfill", "etl-transform", "format-conversion"],
    ["interactive-feature-work"],
    "Data/migration seat: careful ordered transforms with rollback evidence and validation gates between steps."),
];
