// Supervision wire contracts + role predicates (spec docs/spec/supervision-
// integration.md §Configuration and authority). One explicit route per Lead
// ID — IDs are exact agent UUIDs, never inferred from title, cwd, workspace,
// or "nearest active Supervisor". The mode enum carries "notify" as reserved
// vocabulary: schema-valid and loadable from the file, but every evaluation
// point must treat it as inert — notification delivery is a later Human gate
// (spec step 4, not implemented in this package version).
import { z } from "zod";
import { defineRpc } from "@getpaseo/plugin";
import { Id, Sha, Target } from "./contracts.ts";
import { OWNED_PROVIDER_ID_RE, ROLES } from "./families.ts";
import type { RoleName } from "./families.ts";

// Exact SLP role predicates — derived from the shared family/role registry,
// never a parallel provider list (spec: "derive role from
// plugin/shared/families.ts, not a new provider list").
export function roleFromProviderId(provider: unknown): RoleName | null {
  if (typeof provider !== "string") return null;
  const match = provider.match(OWNED_PROVIDER_ID_RE);
  if (!match) return null;
  const role = match[2];
  return (ROLES as readonly string[]).includes(role) ? (role as RoleName) : null;
}
export const isSlpLead = (provider: unknown): boolean => roleFromProviderId(provider) === "lead";
export const isSlpSupervisor = (provider: unknown): boolean => roleFromProviderId(provider) === "supervisor";
export const isSlpPeer = (provider: unknown): boolean => roleFromProviderId(provider) === "peer";

export const SUPERVISION_PENDING_DELAY_DEFAULT_MS = 60_000;
// A pending-delay bound: anything past 24h would silently disable the
// pending-brief gate, so the schema rejects it instead of storing a disabled
// detector that looks configured.
export const SUPERVISION_PENDING_DELAY_MAX_MS = 86_400_000;

export const SupervisionMode = z.enum(["off", "shadow", "notify"]);
export type SupervisionMode = z.infer<typeof SupervisionMode>;

export const SupervisionRoute = z
  .object({
    leadAgentId: Id,
    leadWorkspaceId: z.string().min(1),
    supervisorAgentId: Id.nullable(),
    mode: SupervisionMode,
    pendingDelayMs: z.number().int().min(0).max(SUPERVISION_PENDING_DELAY_MAX_MS).default(SUPERVISION_PENDING_DELAY_DEFAULT_MS),
  })
  .strict()
  .check(ctx => {
    const route = ctx.value;
    if (route.mode === "notify" && route.supervisorAgentId === null) {
      ctx.issues.push({
        code: "custom",
        path: ["supervisorAgentId"],
        message: 'mode "notify" requires a Supervisor agent ID',
        input: route.supervisorAgentId,
      });
    }
    if (route.supervisorAgentId !== null && route.supervisorAgentId === route.leadAgentId) {
      ctx.issues.push({
        code: "custom",
        path: ["supervisorAgentId"],
        message: "supervisorAgentId must differ from leadAgentId",
        input: route.supervisorAgentId,
      });
    }
  });
export type SupervisionRoute = z.infer<typeof SupervisionRoute>;

// On-disk shape of <daemonHome>/slp-runtime/state/supervision.json.
// Duplicate leadAgentId is a file-level invariant enforced by the reader
// (broken file = off with a visible error) and by the writer.
export const SupervisionFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    routes: z.array(SupervisionRoute),
  })
  .strict();
export type SupervisionFile = z.infer<typeof SupervisionFileSchema>;

// ---------------------------------------------------------------------------
// Shadow-observer metadata (spec §Shadow evidence and operator surface) —
// METADATA ONLY: no message bodies, no keys. The bounded ring
// (state/supervision-cases.json, ≤200 entries or 30 days) survives restarts
// so a shadow pilot keeps its review trail.
// ---------------------------------------------------------------------------

/** UI-visible case states (spec: "distinguish observed, evaluated, unknown,
 *  suspected drift, and notification delivery uncertain"). The last exists
 *  in the vocabulary but is never emitted — notification delivery is not
 *  implemented in this build. */
export const SupervisionCaseState = z.enum([
  "observed",
  "evaluated",
  "unknown",
  "suspected_drift",
  "notification_uncertain",
]);
export type SupervisionCaseState = z.infer<typeof SupervisionCaseState>;

// Per-axis choice + confidence (spec §Shadow evidence: "Jev
// choice/confidence" — each axis carries both, never a bare choice).
const SupervisionAxis = z.object({
  choice: z.string(),
  confidence: z.number().min(0).max(1),
}).strict();

export const SupervisionAssessmentSummary = z.object({
  at: z.string(),
  model: z.string(),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }).nullable(),
  choices: z.object({
    leadBrief: SupervisionAxis,
    peerHandback: SupervisionAxis,
    leadHandling: SupervisionAxis,
  }).strict(),
}).strict();
export type SupervisionAssessmentSummary = z.infer<typeof SupervisionAssessmentSummary>;

// Ring-row compatibility: fields added after the first persisted format are
// optional-with-default (never silently drop a readable older row — a strict
// rejection would reset the whole ring file on load). `.catch(null)` keeps
// an older lastAssessment shape readable as "no summary" instead of losing
// the entire observation.
export const SupervisionObservation = z.object({
  fingerprint: Sha,
  leadAgentId: Id,
  peerId: Id,
  peerTurnId: z.string().nullable(),
  /** Turn/message IDs where available (spec §Shadow evidence): the brief and
   *  handback message ids plus the observed send call ids AND the Lead turn
   *  ids that issued them — bounded, ids only, never bodies. sendTurnIds is
   *  index-aligned with sendCallIds. */
  messageIds: z.object({
    brief: z.string().nullable(),
    handback: z.string().nullable(),
    sendCallIds: z.array(z.string().max(200)).max(24),
    sendTurnIds: z.array(z.string().max(200).nullable()).max(24).default([]),
  }).strict().default({ brief: null, handback: null, sendCallIds: [], sendTurnIds: [] }),
  observedAt: z.string(),
  updatedAt: z.string(),
  state: SupervisionCaseState,
  /** Bounded local reason code when state is "unknown"/"suspected_drift" —
   *  never carries message text. */
  reason: z.string().max(400).nullable(),
  /** Visibility-limit flags (bounded vocabulary from capture.ts). */
  visibility: z.array(z.string().max(80)),
  counts: z.object({
    roomMessages: z.number().int().nonnegative().default(0),
    uncertainRoomMessages: z.number().int().nonnegative().default(0),
    otherRoomMessages: z.number().int().nonnegative().default(0),
    reportMessages: z.number().int().nonnegative().default(0),
    peerSends: z.number().int().nonnegative().default(0),
  }).strict().default({ roomMessages: 0, uncertainRoomMessages: 0, otherRoomMessages: 0, reportMessages: 0, peerSends: 0 }),
  assessmentsUsed: z.number().int().nonnegative().default(0),
  lastAssessment: SupervisionAssessmentSummary.nullable().catch(null).default(null),
}).strict();
export type SupervisionObservation = z.infer<typeof SupervisionObservation>;

/** Bounded observer diagnostics — dropped-event / ceiling reasons only. */
export const SupervisionDiagnostics = z.object({
  droppedEvents: z.number().int().nonnegative(),
  reasons: z.array(z.string().max(200)),
}).strict();
export type SupervisionDiagnostics = z.infer<typeof SupervisionDiagnostics>;

/** Per-route gate reason — null means the gate is green; a string is the
 *  paused reason the Manager must show (spec: a failed gate "pauses capture
 *  for that route and shows a reason in the Manager"). */
export const SupervisionGates = z.record(z.string(), z.string().nullable());
export type SupervisionGates = z.infer<typeof SupervisionGates>;

// routes: null = the file is invalid or the target is not the served daemon
// home — off with a visible error, never presented as an empty saved list.
// sha256: raw-file CAS token (null when no file exists).
// observations/gates/diagnostics: the live observer's shadow-only readout;
// null when the observer is not running for that home.
export const GetSupervisionOutput = z.object({
  schemaVersion: z.literal(1),
  routes: z.array(SupervisionRoute).nullable(),
  sha256: Sha.nullable(),
  observations: z.array(SupervisionObservation).nullable(),
  gates: SupervisionGates.nullable(),
  diagnostics: SupervisionDiagnostics.nullable(),
  error: z.string().nullable(),
}).strict();
export type GetSupervisionResult = z.infer<typeof GetSupervisionOutput>;

export const GetSupervisionInput = z.object({
  schemaVersion: z.literal(1),
  target: Target,
}).strict();
export const getSupervision = defineRpc({ name: "get-supervision", input: GetSupervisionInput, output: GetSupervisionOutput });
export type GetSupervisionRequest = z.input<typeof GetSupervisionInput>;

/** Whole-file overwrite of the route store. `expectedSha256` is the sha256
 *  get-supervision returned (null = expect the file to be absent); a
 *  mismatch is an IDEMPOTENCY_CONFLICT and the client must reload first.
 *  The server rechecks the token after the awaited agent validation so a
 *  concurrent save cannot land in between. */
export const SetSupervisionInput = z.object({
  schemaVersion: z.literal(1),
  target: Target,
  routes: z.array(SupervisionRoute),
  expectedSha256: Sha.nullable(),
}).strict();
export const setSupervision = defineRpc({ name: "set-supervision", input: SetSupervisionInput, output: GetSupervisionOutput });
export type SetSupervisionRequest = z.input<typeof SetSupervisionInput>;
export type SetSupervisionResult = z.infer<typeof GetSupervisionOutput>;
