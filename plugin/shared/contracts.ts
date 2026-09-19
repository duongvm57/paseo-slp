// Shared contracts for the paseo-slp manager plugin (Option A v1).
// Normative sources: docs/spec/paseo-plugin-implementation.md §3 (wire RPCs) and
// §7 (receipt/operation-intent journal schema). The seam interfaces at the
// bottom freeze the §12 module boundaries for the implementation lanes.
//
// Host-compiler boundary: shared/ modules may import only zod, react-family
// specifiers and @getpaseo/plugin SDK specifiers — no node builtins, and no
// type imports the plugin checkout cannot resolve. Keep this file pure.

import { z } from "zod";
import { defineRpc } from "@getpaseo/plugin";

// ---------------------------------------------------------------------------
// §3 wire schemas
// ---------------------------------------------------------------------------

export const Sha = z.string().regex(/^[0-9a-f]{64}$/);
export const Time = z.string().datetime({ offset: true });
export const Id = z.string().uuid();
export const Family = z.enum(["codex", "pi", "devin", "claude"]);
export const AbsolutePath = z.string().min(1).max(4096)
  .refine(s => !s.includes("\0") && /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(s));
export const Target = z.object({
  hostId: z.string().min(1).max(256),
  daemonHome: AbsolutePath,
}).strict();
export const Authority = z.object({
  exclusiveAdministrativeWindow: z.literal(true),
  verifiedHostHomeMapping: z.literal(true),
}).strict();
export const State = z.enum([
  "INACTIVE", "ACTIVATING", "ACTIVE", "DEACTIVATING", "RECOVERY_REQUIRED",
]);
export const OperationKind = z.enum(["activate", "reconcile", "deactivate"]);
export const Phase = z.enum([
  "accepted", "materialized", "prepared", "patch-dispatched", "verified", "terminal",
]);
export const Conflict = z.object({
  code: z.enum([
    "BUSY", "IDEMPOTENCY_CONFLICT", "TARGET_MISMATCH", "HOME_UNVERIFIED",
    "UNSUPPORTED_PLATFORM", "EXECUTABLE_UNAVAILABLE", "MCP_DISABLED",
    "RAW_LIVE_DIVERGENCE", "COLLISION", "OWNERSHIP_DRIFT", "SCHEMA_LOSS",
    "DEPENDENT_REFERENCE", "RUNTIME_INTEGRITY", "RECOVERY_REQUIRED",
    "PATCH_OUTCOME_UNKNOWN", "IO_FAILURE", "INVALID_REQUEST", "NOT_FOUND",
  ]),
  path: z.string().max(4096).nullable(),
  message: z.string().min(1).max(2048),
  expectedSha256: Sha.nullable(),
  actualSha256: Sha.nullable(),
}).strict();
export const OperationView = z.object({
  operationId: Id,
  kind: OperationKind,
  phase: Phase,
  outcome: z.enum(["pending", "succeeded", "no-op", "failed", "recovery-required"]),
  startedAt: Time,
  updatedAt: Time,
  completedAt: Time.nullable(),
}).strict();
export const StartOutput = z.object({
  schemaVersion: z.literal(1),
  accepted: z.boolean(),
  state: State,
  operation: OperationView.nullable(),
  conflicts: z.array(Conflict).max(64),
  pollAfterMs: z.number().int().min(0).max(5000),
}).strict();
const Start = z.object({
  schemaVersion: z.literal(1),
  target: Target,
  operationId: Id,
  authority: Authority,
}).strict();
/** Human-supplied preferences merged into an owned profile. Optional
 *  everywhere — the plugin never invents model, mode, or feature defaults.
 *  On first activation an absent field is simply not written; on an existing
 *  binding `activate` treats the object as an explicit edit — absent fields
 *  preserve the live value, `null` clears it, and `family` repoints the
 *  profile at that family's managed provider for the profile's role. */
export const ProfilePrefs = z.object({
  family: Family.optional(),
  model: z.string().min(1).nullable().optional(),
  modeId: z.string().min(1).nullable().optional(),
  thinkingOptionId: z.string().min(1).nullable().optional(),
  featureValues: z.record(z.string(), z.unknown()).nullable().optional(),
}).strict();
export const ActivateInput = Start.extend({
  candidateSha256: Sha,
  adoptIdentical: z.boolean().default(false),
  nodePath: AbsolutePath.optional(),
  binaries: z.object({
    codex: AbsolutePath.optional(), pi: AbsolutePath.optional(),
    devin: AbsolutePath.optional(), claude: AbsolutePath.optional(),
  }).strict().default({}),
  initialProfileFamily: Family.optional(),
  profiles: z.object({
    supervisor: ProfilePrefs.optional(),
    lead: ProfilePrefs.optional(),
  }).strict().optional(),
}).strict();
export const ReconcileInput = Start.extend({
  action: z.enum(["inspect", "complete", "restore-before"]),
  interruptedOperationId: Id.optional(),
}).strict();
export const DeactivateInput = Start.extend({
  expectedBindingSha256: Sha,
}).strict();
export const StatusInput = z.object({
  schemaVersion: z.literal(1),
  target: Target,
  operationId: Id.optional(),
}).strict();
export const BindingView = z.object({
  bindingSha256: Sha,
  candidateSha256: Sha,
  payloadSha256: Sha,
  launchSetSha256: Sha,
  runtimePath: AbsolutePath,
  nodePath: AbsolutePath,
  baseline: z.enum(["fresh", "adopted-observed"]),
}).strict();
export const FamilyView = z.object({
  family: Family,
  availability: z.enum(["available", "unavailable", "unresolved"]),
  binaryPath: AbsolutePath.nullable(),
  observedVersion: z.string().nullable(),
}).strict();
/** Live tunable fields of one managed profile, read from daemon config —
 *  lets the surface prefill the bound-state profile editor with the same
 *  values the host's profile editor would show. Empty when no binding. */
export const ManagedProfileView = z.object({
  id: z.string(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  modeId: z.string().nullable(),
  thinkingOptionId: z.string().nullable(),
  featureValues: z.record(z.string(), z.unknown()).nullable(),
}).strict();
export const StatusOutput = z.object({
  schemaVersion: z.literal(1),
  target: Target,
  state: State,
  embeddedCandidateSha256: Sha,
  binding: BindingView.nullable(),
  managedProfiles: z.array(ManagedProfileView).max(2),
  families: z.array(FamilyView).length(4),
  operation: OperationView.nullable(),
  conflicts: z.array(Conflict).max(64),
  verifiedAt: Time.nullable(),
  retainedRuntimeCount: z.number().int().nonnegative(),
  /** Communication language injected into managed sessions — the content of
   *  slp-runtime/state/communication-language, or null when unset (seats then
   *  keep their model default; nothing is injected). */
  communicationLanguage: z.string().nullable(),
  liveAcceptance: z.literal("not-established-by-this-rpc"),
}).strict();
/** Plugin-owned state mutation: writes or removes the communication-language
 *  file under the target's slp-runtime/state. No authority gate — it touches
 *  no config.json entry, only a plugin-owned file, and takes effect at the
 *  next session entry without re-activation. */
export const SetLanguageInput = z.object({
  schemaVersion: z.literal(1),
  target: Target,
  /** null clears the setting (toggle off); a non-empty string sets it. */
  value: z.string().trim().min(1).max(256).nullable(),
}).strict();
export const SetLanguageOutput = z.object({
  schemaVersion: z.literal(1),
  value: z.string().nullable(),
}).strict();
/** One role's settings-driven provider choice (settings-driven-providers.md
 *  §5 Phase 1). `family` picks the managed `slp-<family>-<role>` provider the
 *  role's profile binds to; absent optional fields are simply not applied to
 *  the generated profile — the plugin invents no model/mode defaults. */
export const RoleChoice = z.object({
  family: Family,
  model: z.string().min(1).optional(),
  modeId: z.string().min(1).optional(),
  thinkingOptionId: z.string().min(1).optional(),
  featureValues: z.record(z.string(), z.unknown()).optional(),
}).strict();
/** Plugin-owned mutable state at slp-runtime/state/role-routing.json —
 *  strict, so unknown keys are rejected rather than silently widening the
 *  routing surface. Peers stay pool-driven and are not part of the schema. */
export const RoleRouting = z.object({
  schemaVersion: z.literal(1),
  supervisor: RoleChoice,
  lead: RoleChoice,
}).strict();
export const GetRoleRoutingInput = z.object({
  schemaVersion: z.literal(1),
  target: Target,
}).strict();
export const GetRoleRoutingOutput = z.object({
  schemaVersion: z.literal(1),
  /** The stored routing, or null when no routing file exists (activation
   *  then keeps the v1 all-twelve provider generation). */
  routing: RoleRouting.nullable(),
}).strict();
/** Plugin-owned state mutation, same shape as set-language: writes
 *  slp-runtime/state/role-routing.json under the target's stable root. No
 *  authority gate — it touches no config.json entry and takes effect at the
 *  next activation, which regenerates providers/profiles from the choice. */
export const SetRoleRoutingInput = z.object({
  schemaVersion: z.literal(1),
  target: Target,
  routing: RoleRouting,
}).strict();
export const SetRoleRoutingOutput = z.object({
  schemaVersion: z.literal(1),
  routing: RoleRouting,
}).strict();
export const LocalTargetInput = z.object({
  schemaVersion: z.literal(1),
}).strict();
export const LocalTargetOutput = z.object({
  // The daemon home the plugin process believes it serves: $PASEO_HOME when the
  // daemon exported it, else the platform default ~/.paseo. The client may
  // prefill from this but the verifiedHostHomeMapping acknowledgment stays a
  // human decision — detection is a suggestion, never proof.
  daemonHome: AbsolutePath,
  source: z.enum(["env", "default"]),
}).strict();
/** Read-only catalog query: the model/mode list a managed slp-<family>-*
 *  provider inherits from its base provider (`extends`), resolved live via
 *  PaseoApi.providers — available before any binding exists, which is exactly
 *  when the initial-profile picker needs it. */
export const CatalogInput = z.object({
  schemaVersion: z.literal(1),
  family: Family,
  // Feature listing runs on a draft agent config — cwd is required by the
  // host API; model/modeId refine which features a provider reports.
  cwd: AbsolutePath.optional(),
  model: z.string().min(1).optional(),
  modeId: z.string().min(1).optional(),
}).strict();
export const CatalogOption = z.object({
  id: z.string().min(1),
  label: z.string(),
}).strict();
/** Provider feature definition — the same descriptor the host's profile
 *  editor renders as a toggle or select. `value` is the provider default;
 *  profile-level overrides live in `featureValues`. */
export const CatalogFeature = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("toggle"),
    id: z.string().min(1),
    label: z.string(),
    description: z.string().optional(),
    tooltip: z.string().optional(),
    icon: z.string().optional(),
    value: z.boolean(),
  }).strict(),
  z.object({
    type: z.literal("select"),
    id: z.string().min(1),
    label: z.string(),
    description: z.string().optional(),
    tooltip: z.string().optional(),
    icon: z.string().optional(),
    value: z.string().nullable(),
    options: z.array(z.object({
      id: z.string().min(1),
      label: z.string(),
      description: z.string().optional(),
      isDefault: z.boolean().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }).strict()),
  }).strict(),
]);
export const CatalogOutput = z.object({
  schemaVersion: z.literal(1),
  models: z.array(CatalogOption),
  modes: z.array(CatalogOption),
  features: z.array(CatalogFeature),
  /** Non-fatal: a provider that cannot answer reports here instead of rejecting. */
  error: z.string().nullable(),
}).strict();
export const activate = defineRpc({ name: "activate", input: ActivateInput, output: StartOutput });
export const reconcile = defineRpc({ name: "reconcile", input: ReconcileInput, output: StartOutput });
export const deactivate = defineRpc({ name: "deactivate", input: DeactivateInput, output: StartOutput });
export const status = defineRpc({ name: "status", input: StatusInput, output: StatusOutput });
export const localTarget = defineRpc({ name: "local-target", input: LocalTargetInput, output: LocalTargetOutput });
export const catalog = defineRpc({ name: "catalog", input: CatalogInput, output: CatalogOutput });
export const setLanguage = defineRpc({ name: "set-language", input: SetLanguageInput, output: SetLanguageOutput });
export const getRoleRouting = defineRpc({ name: "get-role-routing", input: GetRoleRoutingInput, output: GetRoleRoutingOutput });
export const setRoleRouting = defineRpc({ name: "set-role-routing", input: SetRoleRoutingInput, output: SetRoleRoutingOutput });

// ---------------------------------------------------------------------------
// §7 receipt / operation-intent journal schemas (server-internal; the client
// bundle never imports them at runtime beyond shared-module presence).
// ---------------------------------------------------------------------------

export const Json = z.json();
export const ProviderId = z.string().regex(/^slp-(codex|pi|devin|claude)-(supervisor|lead|peer)$/);
export const Presence = <T extends z.ZodType>(value: T) => z.discriminatedUnion("present", [
  z.object({ present: z.literal(false) }).strict(),
  z.object({ present: z.literal(true), value }).strict(),
]);
export const FlagBefore = z.object({ raw: Presence(z.boolean()), effective: z.boolean() }).strict();
export const Profile = z.object({
  id: z.string(), name: z.string(), provider: z.string(),
  icon: z.string().optional(), color: z.string().optional(),
  model: z.string().optional(), modeId: z.string().optional(),
  thinkingOptionId: z.string().optional(),
  featureValues: z.record(z.string(), Json).optional(),
  notes: z.string().optional(),
}).catchall(Json);
export const OwnedProvider = z.object({
  extends: z.enum(["codex", "pi", "acp", "claude"]),
  label: z.string(),
  // argv of one or two absolute elements. Every generated entry is
  // single-element — the launch-set launcher argv[0] (the host's argv0
  // --version probe drops the tail); two-element commands were emitted only
  // by the transitional [node, gate] thin-alias shape, and max(2) keeps
  // receipts written by that build readable.
  command: z.array(AbsolutePath).min(1).max(2),
  env: z.record(z.string(), z.string()), enabled: z.boolean(),
}).strict();
export const OwnedProfileSlot = z.object({
  index: z.number().int().nonnegative(), value: Profile,
}).strict();
export const Projection = z.object({
  providers: z.record(ProviderId, Presence(OwnedProvider)),
  profilesPresent: z.boolean(),
  profiles: z.array(OwnedProfileSlot).max(2),
  injectIntoAgents: Presence(z.boolean()),
}).strict();
export const Snapshot = z.object({
  rawConfigSha256: Sha,
  owned: Projection,
  ownedSha256: Sha,
  allProfilesSha256: Sha,
  unrelatedPersistedSha256: Sha,
  effectiveEnabled: z.boolean(),
  effectiveInjection: z.boolean(),
}).strict();
export const Binary = z.discriminatedUnion("available", [
  z.object({ available: z.literal(true), path: AbsolutePath, version: z.string().min(1) }).strict(),
  z.object({ available: z.literal(false), path: z.null(), version: z.null() }).strict(),
]);
export const LauncherFile = z.object({
  path: AbsolutePath, sha256: Sha, mode: z.number().int().min(0).max(511),
}).strict();
export const Binding = z.object({
  bindingSha256: Sha,
  candidateSha256: Sha,
  payloadSha256: Sha,
  runtimePath: AbsolutePath,
  launchSetSha256: Sha,
  launchManifestSha256: Sha,
  // Legacy bindings record all twelve launchers; Phase 2 bindings record
  // only the devin wrapper launchers (hook families run the sentinel gate
  // straight from the candidate, no generated launcher). Both validate.
  launcherFiles: z.array(LauncherFile).min(1),
  node: z.object({ path: AbsolutePath, version: z.string().min(1) }).strict(),
  binaries: z.object({ codex: Binary, pi: Binary, devin: Binary, claude: Binary }).strict(),
  baseline: z.enum(["fresh", "adopted-observed"]),
  beforeActivation: Snapshot,
  mcpBefore: z.object({ enabled: FlagBefore, injectIntoAgents: FlagBefore }).strict(),
  owned: Projection,
  postPatchPersistedShapeSha256: Sha,
  activatedAt: Time,
  verifiedAt: Time,
}).strict();
export const Plan = z.object({
  before: Snapshot,
  afterOwned: Projection,
  afterOwnedSha256: Sha,
  afterAllProfilesSha256: Sha,
  previousBinding: Binding.nullable(),
  nextBinding: Binding.nullable(),
  restoreInjectionTo: z.boolean().nullable(),
}).strict();
export const Intent = z.object({
  operationId: Id,
  requestSha256: Sha,
  kind: OperationKind,
  bootId: Id,
  phase: Phase,
  outcome: z.enum(["pending", "succeeded", "no-op", "failed", "recovery-required"]),
  candidateSha256: Sha.nullable(),
  recoveryOf: Id.nullable(),
  recoveryAction: z.enum(["inspect", "complete", "restore-before"]).nullable(),
  acceptedAt: Time,
  updatedAt: Time,
  completedAt: Time.nullable(),
  plan: Plan.nullable(),
  /** Receipt state to restore if this op fails without an ambiguous patch
   *  settlement — recorded at acceptance. Absent on intents journaled by
   *  older builds; readers fall back per op kind. */
  priorState: State.optional(),
  patchAttempts: z.array(z.object({
    requestId: Id,
    dispatchedAt: Time,
    settledAt: Time.nullable(),
    result: z.enum(["pending", "returned", "threw", "outcome-unknown"]),
  }).strict()),
  conflicts: z.array(Conflict).max(64),
}).strict();
export const Receipt = z.object({
  schemaVersion: z.literal(1),
  pluginId: z.literal("paseo-slp"),
  target: Target,
  stableRoot: AbsolutePath,
  revision: z.number().int().nonnegative(),
  state: State,
  createdAt: Time,
  updatedAt: Time,
  binding: Binding.nullable(),
  lastDeactivatedBindingSha256: Sha.nullable(),
  activeOperationId: Id.nullable(),
  retained: z.array(z.object({
    candidateSha256: Sha, payloadSha256: Sha, runtimePath: AbsolutePath,
    launchSetSha256: Sha.nullable(), retainedAt: Time,
  }).strict()),
  operations: z.array(Intent),
}).strict();

// ---------------------------------------------------------------------------
// Derived wire/journal types
// ---------------------------------------------------------------------------

export type Sha256 = z.infer<typeof Sha>;
export type FamilyName = z.infer<typeof Family>;
export type StateValue = z.infer<typeof State>;
export type OperationKindValue = z.infer<typeof OperationKind>;
export type PhaseValue = z.infer<typeof Phase>;
export type ConflictValue = z.infer<typeof Conflict>;
export type ConflictCode = ConflictValue["code"];
export type OperationViewValue = z.infer<typeof OperationView>;
export type TargetValue = z.infer<typeof Target>;
export type AuthorityValue = z.infer<typeof Authority>;
export type ActivateRequest = z.infer<typeof ActivateInput>;
export type ProfilePrefsValue = z.infer<typeof ProfilePrefs>;
export type CatalogOptionValue = z.infer<typeof CatalogOption>;
export type CatalogRequest = z.infer<typeof CatalogInput>;
export type CatalogResult = z.infer<typeof CatalogOutput>;
export type ReconcileRequest = z.infer<typeof ReconcileInput>;
export type DeactivateRequest = z.infer<typeof DeactivateInput>;
export type StatusRequest = z.infer<typeof StatusInput>;
export type SetLanguageRequest = z.infer<typeof SetLanguageInput>;
export type SetLanguageResult = z.infer<typeof SetLanguageOutput>;
export type RoleChoiceValue = z.infer<typeof RoleChoice>;
export type RoleRoutingValue = z.infer<typeof RoleRouting>;
export type GetRoleRoutingRequest = z.infer<typeof GetRoleRoutingInput>;
export type GetRoleRoutingResult = z.infer<typeof GetRoleRoutingOutput>;
export type SetRoleRoutingRequest = z.infer<typeof SetRoleRoutingInput>;
export type SetRoleRoutingResult = z.infer<typeof SetRoleRoutingOutput>;
export type StartResult = z.infer<typeof StartOutput>;
export type StatusResult = z.infer<typeof StatusOutput>;
export type BindingViewValue = z.infer<typeof BindingView>;
export type FamilyViewValue = z.infer<typeof FamilyView>;
export type ReceiptValue = z.infer<typeof Receipt>;
export type IntentValue = z.infer<typeof Intent>;
export type PlanValue = z.infer<typeof Plan>;
export type BindingValue = z.infer<typeof Binding>;
export type SnapshotValue = z.infer<typeof Snapshot>;
export type ProjectionValue = z.infer<typeof Projection>;
export type OwnedProviderValue = z.infer<typeof OwnedProvider>;
export type ProfileValue = z.infer<typeof Profile>;
export type OwnedProfileSlotValue = z.infer<typeof OwnedProfileSlot>;
export type BinaryValue = z.infer<typeof Binary>;
export type LauncherFileValue = z.infer<typeof LauncherFile>;

// ---------------------------------------------------------------------------
// §12 frozen module seams (server-internal; type-only below this point).
// Lanes implement against these signatures; Lead owns this file.
// ---------------------------------------------------------------------------

/** §3 wire bounds applied at construction: a conflict field that exceeds the
 * schema would fail Receipt/RPC validation downstream, so normalize before the
 * value can be persisted or returned. */
const CONFLICT_MESSAGE_MAX = 2048;
const CONFLICT_PATH_MAX = 4096;
const CONFLICT_TRUNCATION = "…[truncated]";

export function normalizeConflict(conflict: ConflictValue): ConflictValue {
  const message =
    conflict.message.length > CONFLICT_MESSAGE_MAX
      ? `${conflict.message.slice(0, CONFLICT_MESSAGE_MAX - CONFLICT_TRUNCATION.length)}${CONFLICT_TRUNCATION}`
      : conflict.message;
  const path =
    conflict.path !== null && conflict.path.length > CONFLICT_PATH_MAX
      ? `${conflict.path.slice(0, CONFLICT_PATH_MAX - 1)}…`
      : conflict.path;
  return {
    ...conflict,
    path,
    message: message.length > 0 ? message : "conflict detail unavailable",
  };
}

/** Typed conflict vocabulary shared by every lane. Throw this for any failure
 * that maps to a declared §3 conflict code; the manager converts it. */
export class OperationConflict extends Error {
  readonly code: ConflictCode;
  readonly path: string | null;
  readonly expectedSha256: string | null;
  readonly actualSha256: string | null;
  constructor(
    code: ConflictCode,
    message: string,
    detail?: { path?: string | null; expectedSha256?: string | null; actualSha256?: string | null },
  ) {
    super(message);
    this.name = "OperationConflict";
    this.code = code;
    this.path = detail?.path ?? null;
    this.expectedSha256 = detail?.expectedSha256 ?? null;
    this.actualSha256 = detail?.actualSha256 ?? null;
  }
  toConflict(): ConflictValue {
    return normalizeConflict({
      code: this.code,
      path: this.path,
      message: this.message,
      expectedSha256: this.expectedSha256,
      actualSha256: this.actualSha256,
    });
  }
}

/** Export contract of plugin/server/generated/runtime-payload.ts. The
 * generated module must export `embeddedPayload` satisfying this type. */
export interface EmbeddedPayload {
  schemaVersion: 1;
  candidate: { sha256: string; files: { path: string; sha256: string }[] };
  payloadSha256: string;
  files: { path: string; sha256: string; mode: number; base64: string }[];
}

/** server/materializer.ts — immutable candidate install-unit publication (§5). */
export interface MaterializeResult {
  candidateSha256: Sha256;
  payloadSha256: Sha256;
  /** Absolute path of the published <stable-root>/<candidate-sha> directory. */
  runtimePath: string;
  /** true when an existing verified directory was reused, false when staged. */
  reused: boolean;
}
export interface Materializer {
  /** Stage, verify and publish the embedded candidate under stableRoot.
   * Returns the published identity; throws OperationConflict on integrity or
   * IO failures. Records nothing in the journal — the manager owns intent. */
  materialize(stableRoot: string, operationId: string): Promise<MaterializeResult>;
  /** Re-verify a previously published candidate directory (status/reconcile/
   * deactivate paths). `candidateSha256` is the recorded candidate identity
   * and `payloadSha256` the recorded payload identity — the embedded sha pair
   * verifies against the embedded payload; a foreign pair (binding/retained
   * evidence) verifies self-consistency anchored on the directory's
   * installed.json, whose mode record must hash to `payloadSha256`. Throws
   * OperationConflict (RUNTIME_INTEGRITY) on any deviation. */
  verifyPublished(runtimePath: string, candidateSha256: string, payloadSha256: string): Promise<void>;
  /** Remove only this operation's unpublished staging under stableRoot.
   * Never touches published directories or other operations' staging. */
  discardStaging(stableRoot: string, operationId: string): Promise<void>;
}
export type MaterializerFactory = (payload: EmbeddedPayload) => Materializer;

/** server/executables.ts — Node + family binary resolution and probes (§6). */
export type BinaryResolution = BinaryValue;
export interface ResolvedNode {
  /** Verified absolute ordinary-Node path; never Electron/plugin/shim paths. */
  path: string;
  version: string;
}
export interface ExecutableResolution {
  node: ResolvedNode;
  binaries: Record<FamilyName, BinaryResolution>;
}
export interface ExecutableRequest {
  /** Canonical daemon home (realpath already applied by caller). */
  daemonHome: string;
  /** <daemon-home>/slp-runtime; resolved executables must lie outside it and
   * outside managed plugin checkouts. */
  stableRoot: string;
  /** Administrator-supplied Node path; an invalid value is an error, never a
   * fallback trigger. */
  nodePath?: string;
  /** Administrator-supplied per-family binary paths. */
  binaries?: Partial<Record<FamilyName, string>>;
  /** Previous binding's verified resolution, when rebinding/reconciling. */
  prior?: {
    node?: { path: string; version?: string } | null;
    binaries?: Partial<Record<FamilyName, BinaryResolution>> | null;
  } | null;
}
export interface ExecutableResolver {
  /** Resolution order per §6: explicit input → prior verified → PATH probe.
   * Every positive result is probe-verified; failures yield available:false
   * binaries or throw OperationConflict(EXECUTABLE_UNAVAILABLE) for Node. */
  resolve(request: ExecutableRequest): Promise<ExecutableResolution>;
}
export type ExecutableResolverFactory = () => ExecutableResolver;

/** server/launchers.ts — immutable launch-set generation/publication (§6). */
export interface LaunchSetRequest {
  daemonHome: string;
  stableRoot: string;
  operationId: string;
  candidate: { sha256: Sha256; runtimePath: string };
  node: ResolvedNode;
  binaries: Record<FamilyName, BinaryResolution>;
}
export interface LaunchSet {
  launchSetSha256: Sha256;
  /** sha256 of the exact launch.json bytes. */
  launchManifestSha256: Sha256;
  /** <stableRoot>/launchers/<launchSetSha256> */
  directory: string;
  /** The generated launcher files (Phase 2: the three devin wrapper
   *  launchers), with recorded sha256/mode. */
  files: LauncherFileValue[];
}
export interface LauncherBuilder {
  /** Build launch.json deterministically, stage the POSIX launchers, verify
   * bytes/modes, publish by rename. Throws OperationConflict on failure. */
  publish(request: LaunchSetRequest): Promise<LaunchSet>;
  /** Re-verify a published launch set: manifest digest, every launcher
   * bytes/modes. Throws OperationConflict(RUNTIME_INTEGRITY) on deviation. */
  verify(directory: string): Promise<LaunchSet>;
}
export type LauncherBuilderFactory = () => LauncherBuilder;

/** Narrowed connected-API surface the manager may use (§2): config get/patch
 * only. The SDK PaseoApi is structurally assignable to this. */
export interface DaemonConfigConnection {
  get(requestId?: string): Promise<{ requestId: string; config: Record<string, unknown> }>;
  patch(patch: Record<string, unknown>, requestId?: string): Promise<{ requestId: string; config: Record<string, unknown> }>;
}
export interface ConnectedDaemon {
  config: DaemonConfigConnection;
}

/** server/manager.ts — sole owner of the mutation mutex, state transitions and
 * connected SDK calls (§3, §8–9). index.server.ts wires the real deps; tests
 * may inject honest doubles. */
export interface ManagerDeps {
  payload: EmbeddedPayload;
  materializer: Materializer;
  executables: ExecutableResolver;
  launchers: LauncherBuilder;
  /** Deterministic seams for tests; production wiring leaves them absent. */
  now?: () => Date;
  uuid?: () => string;
  platform?: string;
}
export interface Manager {
  activate(input: ActivateRequest, daemon: ConnectedDaemon): Promise<StartResult>;
  reconcile(input: ReconcileRequest, daemon: ConnectedDaemon): Promise<StartResult>;
  deactivate(input: DeactivateRequest, daemon: ConnectedDaemon): Promise<StartResult>;
  status(input: StatusRequest, daemon: ConnectedDaemon): Promise<StatusResult>;
  /** Write or clear the plugin-owned communication-language file. No journal,
   *  no mutex — it is one atomic file under slp-runtime/state that only the
   *  role bundle reads, at session entry. */
  setLanguage(input: SetLanguageRequest): Promise<SetLanguageResult>;
  /** Read the plugin-owned role-routing file; null when unset or legacy. */
  getRoleRouting(input: GetRoleRoutingRequest): Promise<GetRoleRoutingResult>;
  /** Validate and atomically persist the role routing — one file under
   *  slp-runtime/state that only the next activation consumes. No journal,
   *  no mutex, no authority gate (same class of write as set-language). */
  setRoleRouting(input: SetRoleRoutingRequest): Promise<SetRoleRoutingResult>;
  /** Stop accepting work and close owned resources. Does not deactivate SLP
   * or remove files; recovery stays journal-driven. */
  close(): void;
}
export type ManagerFactory = (deps: ManagerDeps) => Manager;
