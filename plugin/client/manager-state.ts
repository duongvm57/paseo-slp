// Pure view-state helpers for the SLP manager surface (spec §3, §9–§11).
// No react/host imports: this module is unit-tested directly under node, and
// the client bundle check proves it pulls in no server-only or node code.
import { AbsolutePath, Id } from "../shared/contracts.ts";
import { OWNED_PROVIDER_ID_RE, ownedProviderId } from "../shared/families.ts";
import type {
  CatalogResult,
  CatalogSelectOptionValue,
  ConflictValue,
  FamilyName,
  FamilyViewValue,
  OperationViewValue,
  RoleChoiceValue,
  RoleRoutingValue,
  StartResult,
  StateValue,
  StatusResult,
  TargetValue,
} from "../shared/contracts.ts";

export const STATUS_POLL_MS = 1000;
export const MAX_VISIBLE_CONFLICTS = 8;
export const MAX_VISIBLE_CONFLICTS_COMPACT = 4;
const MAX_MESSAGE = 240;
const MAX_ERROR = 500;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export const isDaemonHome = (value: string): boolean => AbsolutePath.safeParse(value).success;
export const isOperationId = (value: string): boolean => Id.safeParse(value).success;

export function newOperationId(): string {
  const crypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  // RFC 4122 v4 fallback for hosts without crypto.randomUUID.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.floor(Math.random() * 16);
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ---------------------------------------------------------------------------
// Per-target view state (two-host isolation: state never leaks across targets)
// ---------------------------------------------------------------------------

export const targetKey = (target: TargetValue): string => `${target.hostId} ${target.daemonHome}`;

export interface TargetView {
  status: StatusResult | null;
  busy: boolean;
  lastError: string | null;
  notice: string | null;
  /** Conflicts carried by the last start response — visible even when the
   * operation was accepted (e.g. reconcile inspect reporting drift). Kept on
   * the view so a clean follow-up status cannot clear an unseen report. */
  reportedConflicts: ConflictValue[] | null;
  /** Tracked pending operation; nextPollMs is the server's pollAfterMs for the
   * first poll, then STATUS_POLL_MS per status poll (spec §3). */
  pending: { operationId: string; nextPollMs: number } | null;
}

export const emptyTargetView = (): TargetView => ({
  status: null,
  busy: false,
  lastError: null,
  notice: null,
  reportedConflicts: null,
  pending: null,
});

export interface TargetViews {
  get(target: TargetValue): TargetView | undefined;
  set(target: TargetValue, view: TargetView): void;
}

export function createTargetViews(): TargetViews {
  const views = new Map<string, TargetView>();
  return {
    get: target => views.get(targetKey(target)),
    set: (target, view) => void views.set(targetKey(target), view),
  };
}

// Where a patch lands (stale-target race): it always merges into forTarget's
// own stored view — never whatever happens to be on screen — and the repaint
// applies only while forTarget is the displayed target. An RPC completing
// after the administrator edits the daemon home must not paint old-target
// data over the new target's view, nor merge the new view's fields into the
// old target's store entry.
export function applyPatch(
  store: TargetViews,
  forTarget: TargetValue,
  patch: Partial<TargetView>,
  currentKey: string | null,
): { view: TargetView; repaint: boolean } {
  const view = { ...(store.get(forTarget) ?? emptyTargetView()), ...patch };
  store.set(forTarget, view);
  return { view, repaint: targetKey(forTarget) === currentKey };
}

// ---------------------------------------------------------------------------
// Poll / timeout-retry logic
// ---------------------------------------------------------------------------

export const operationPending = (operation: OperationViewValue | null | undefined): boolean =>
  operation != null && operation.outcome === "pending";

// Delay before the first status poll after a start response: the server's
// pollAfterMs, and only while the accepted operation is pending. A rejected or
// terminal start stops the loop (returns 0).
export const pollDelayAfterStart = (start: StartResult): number =>
  operationPending(start.operation) ? start.pollAfterMs : 0;

// Status responses carry no pollAfterMs; poll every STATUS_POLL_MS while the
// tracked operation is pending and stop at terminal (spec §3, §10).
export const pollDelayAfterStatus = (view: StatusResult): number =>
  operationPending(view.operation) ? STATUS_POLL_MS : 0;

export type StartRecovery =
  | { kind: "poll" }
  | { kind: "retry" }
  | { kind: "settled"; operation: OperationViewValue }
  | { kind: "unresolved"; message: string };

// §3: a start-call timeout does not cancel the operation — the RPC promise
// keeps running server-side. Poll the original operationId and retry the
// identical request only when status reports it absent (operation:null with
// NOT_FOUND). A foreign pending operation is never hijacked.
export function recoverPendingStart(operationId: string, view: StatusResult): StartRecovery {
  const operation = view.operation;
  if (operation == null) return { kind: "retry" };
  if (operation.operationId !== operationId) {
    return { kind: "unresolved", message: `status returned operation ${operation.operationId}, not the dispatched ${operationId}` };
  }
  return operationPending(operation) ? { kind: "poll" } : { kind: "settled", operation };
}

// ---------------------------------------------------------------------------
// Formatting (bounded — a 64-entry conflict list never floods the surface)
// ---------------------------------------------------------------------------

const truncate = (text: string, max = MAX_MESSAGE): string =>
  text.length <= max ? text : `${text.slice(0, max)}…`;

export const shortenSha = (sha: string | null | undefined, keep = 12): string =>
  sha == null ? "none" : sha.length <= keep ? sha : `${sha.slice(0, keep)}…`;

export const errorMessage = (error: unknown): string =>
  truncate(error instanceof Error ? error.message : String(error), MAX_ERROR);

export function conflictLine(conflict: ConflictValue): string {
  const detail = [
    conflict.path,
    conflict.expectedSha256 ? `expected ${shortenSha(conflict.expectedSha256)}` : null,
    conflict.actualSha256 ? `actual ${shortenSha(conflict.actualSha256)}` : null,
  ].filter((part): part is string => part != null).join("; ");
  return `${conflict.code}: ${truncate(conflict.message)}${detail ? ` (${detail})` : ""}`;
}

export function conflictLines(conflicts: readonly ConflictValue[], max = MAX_VISIBLE_CONFLICTS): string[] {
  const lines = conflicts.slice(0, Math.max(0, max)).map(conflictLine);
  const omitted = conflicts.length - lines.length;
  if (omitted > 0) lines.push(`…and ${omitted} more conflict${omitted === 1 ? "" : "s"}`);
  return lines;
}

// ---------------------------------------------------------------------------
// Conflicts the operator must see — merged and deduped
// ---------------------------------------------------------------------------

// OperationView gains a `conflicts` array from the server (status(opId) reports
// the op's journal findings); read it defensively until the schema ships.
type OperationViewWithConflicts = OperationViewValue & { conflicts?: readonly ConflictValue[] | null };

const operationConflicts = (status: StatusResult | null | undefined): readonly ConflictValue[] =>
  (status?.operation as OperationViewWithConflicts | null | undefined)?.conflicts ?? [];

// Everything the operator must see: the last start response's report
// (reportedConflicts), op-level results arriving after acceptance via
// status(opId) polling — a succeeded inspect can still carry drift conflicts —
// and the status-level conflicts. Deduped on the full conflict identity.
export function visibleConflicts(view: TargetView): ConflictValue[] {
  const merged = [
    ...(view.reportedConflicts ?? []),
    ...operationConflicts(view.status),
    ...(view.status?.conflicts ?? []),
  ];
  const seen = new Set<string>();
  return merged.filter(conflict => {
    const key = `${conflict.code} ${conflict.path} ${conflict.expectedSha256} ${conflict.actualSha256} ${conflict.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Status / operation rows (compact vs wide)
// ---------------------------------------------------------------------------

export interface StatusRow {
  label: string;
  value: string;
}

// §10: the field is literal — report exactly what it means.
export const liveAcceptanceLabel = (value: StatusResult["liveAcceptance"]): string =>
  value === "not-established-by-this-rpc" ? "not established by this RPC" : value;

export function stateHint(state: StateValue): string {
  switch (state) {
    case "RECOVERY_REQUIRED":
      return "Interrupted or divergent state — run Reconcile (Inspect) before any mutation";
    case "ACTIVATING":
    case "DEACTIVATING":
      return "Operation in progress";
    default:
      return "";
  }
}

export function statusRows(view: StatusResult, options: { compact?: boolean } = {}): StatusRow[] {
  const sha = (value: string) => shortenSha(value, options.compact ? 8 : 12);
  const rows: StatusRow[] = [
    { label: "State", value: view.state },
    // The server canonicalizes target.daemonHome — show it in every layout so
    // an administrator who typed a symlinked path sees the real home before
    // any mutation (spec §4 required pre-op display).
    { label: "Daemon home (canonical)", value: view.target.daemonHome },
    { label: "Embedded candidate", value: sha(view.embeddedCandidateSha256) },
    { label: "Active candidate", value: view.binding ? sha(view.binding.candidateSha256) : "none" },
  ];
  const binding = view.binding;
  if (binding) {
    rows.push({ label: "Binding", value: sha(binding.bindingSha256) });
    if (!options.compact) {
      rows.push(
        { label: "Runtime", value: binding.runtimePath },
        { label: "Node", value: binding.nodePath },
        { label: "Launch set", value: sha(binding.launchSetSha256) },
        { label: "Payload", value: sha(binding.payloadSha256) },
        { label: "Baseline", value: binding.baseline },
      );
    }
  }
  rows.push(
    { label: "Retained runtimes", value: String(view.retainedRuntimeCount) },
    { label: "Communication language", value: view.communicationLanguage ?? "unset (model default)" },
    // §9: this timestamp is the last verified check, not a live read.
    { label: "Last verified", value: view.verifiedAt ?? "never" },
    { label: "Live acceptance", value: liveAcceptanceLabel(view.liveAcceptance) },
  );
  return rows;
}

export function operationRows(operation: OperationViewValue): StatusRow[] {
  return [
    { label: "Operation", value: operation.operationId },
    { label: "Kind", value: operation.kind },
    { label: "Phase", value: operation.phase },
    { label: "Outcome", value: operation.outcome },
    { label: "Started", value: operation.startedAt },
    { label: "Updated", value: operation.updatedAt },
    ...(operation.completedAt ? [{ label: "Completed", value: operation.completedAt }] : []),
  ];
}

export function familyHint(family: FamilyViewValue, options: { compact?: boolean } = {}): string {
  if (family.availability === "unresolved") return "unresolved";
  if (family.availability === "unavailable") return "unavailable";
  const version = family.observedVersion ? ` (${family.observedVersion})` : "";
  return options.compact ? `available${version}` : `available — ${family.binaryPath ?? "?"}${version}`;
}

// ---------------------------------------------------------------------------
// Action derivation
// ---------------------------------------------------------------------------

export type ActivationKind = "activate" | "reverify" | "rebind";
export function activationKind(view: StatusResult | null): ActivationKind {
  if (!view?.binding) return "activate";
  // §3: a different candidate is an explicit rebind; an identical target with a
  // different operation id runs verification and ends no-op.
  return view.binding.candidateSha256 === view.embeddedCandidateSha256 ? "reverify" : "rebind";
}
export const activationLabel = (view: StatusResult | null): string =>
  ({ activate: "Activate", reverify: "Re-verify binding", rebind: "Rebind" })[activationKind(view)];

// ---------------------------------------------------------------------------
// Role routing (Phase 1 settings-driven provider generation)
// ---------------------------------------------------------------------------

/** Stable identity for a flat featureValues record — the divergence check
 *  must not trip on key order between the stored routing and live config. */
const featureValuesKey = (value: Record<string, unknown> | null | undefined): string =>
  value == null ? "null" : JSON.stringify(Object.keys(value).sort().map(key => [key, value[key]]));

/** Does the stored routing diverge from the live binding's managed profiles?
 *  The provider binding is the primary signal; a set routing field that
 *  differs from the live profile value also counts. Absent optional fields
 *  are not applied by generation, so they can never diverge. True means a
 *  re-activation is required to make the binding match the routing — the
 *  surface reports it but never auto-activates. */
export function routingDiverges(
  routing: RoleRoutingValue | null,
  managedProfiles: StatusResult["managedProfiles"],
): boolean {
  if (routing === null) return false;
  for (const role of ["supervisor", "lead"] as const) {
    const choice = routing[role];
    const live = managedProfiles.find(profile => profile.id === `slp-${role}`);
    if (!live) continue;
    if (live.provider !== ownedProviderId(choice.family, role)) return true;
    if (choice.model !== undefined && live.model !== choice.model) return true;
    if (choice.modeId !== undefined && live.modeId !== choice.modeId) return true;
    if (choice.thinkingOptionId !== undefined && live.thinkingOptionId !== choice.thinkingOptionId) return true;
    if (
      choice.featureValues !== undefined &&
      featureValuesKey(live.featureValues) !== featureValuesKey(choice.featureValues)
    ) return true;
  }
  return false;
}

/** Family parsed out of a managed `slp-<family>-<role>` provider id, or null
 *  for anything else — used to prefill routing pickers from live profiles. */
export function familyFromProviderId(provider: string | null | undefined): string | null {
  return OWNED_PROVIDER_ID_RE.exec(provider ?? "")?.[1] ?? null;
}

/** The picked model's declared thinking options and default, resolved from
 *  a family catalog (§9 corrected finding). null means unresolvable — no
 *  catalog, no picked model, or a picked model the catalog doesn't list —
 *  the picker's established free-text fallback. A resolved model declaring
 *  no options returns `{options: [], defaultId: null}` (the devin case:
 *  thinking is baked into model ids, so free text would invite garbage).
 *  The model id trims like featureKeyFor's — surrounding whitespace is not
 *  part of the catalog key. */
export function thinkingOptionsFor(
  catalog: CatalogResult | null | undefined,
  modelId: string,
): { options: CatalogSelectOptionValue[]; defaultId: string | null } | null {
  const entry = catalog?.models.find(model => model.id === modelId.trim());
  if (!entry) return null;
  return { options: entry.thinkingOptions ?? [], defaultId: entry.defaultThinkingOptionId ?? null };
}

// ---------------------------------------------------------------------------
// Routing form → stored RoleChoice — the single build path the Save gate and
// saveRouting share, so an enabled button can never write something the gate
// did not compare (spec §9).
// ---------------------------------------------------------------------------

export type RoutingRole = "supervisor" | "lead";

/** The routing card's editable copy of one RoleChoice: `features` is the raw
 *  JSON base shown when a provider declares no feature defs (and the source of
 *  undeclared keys when it does); `feature` holds the per-definition control
 *  values, "" meaning unset. */
export interface RoutingRoleForm {
  family: FamilyName;
  model: string;
  modeId: string;
  thinkingOptionId: string;
  features: string;
  feature: Record<string, string>;
}

/** Merge the declared feature controls over the raw JSON base: controls win
 *  for keys the provider declares, undeclared keys are preserved from the
 *  base, and an empty control value drops the key — the stored routing then
 *  carries no explicit value for it (RoleChoice absent-key = unset). */
const mergeFeatureValues = (
  defs: CatalogResult["features"],
  base: Record<string, unknown>,
  controlValues: Record<string, string>,
): Record<string, unknown> => {
  const merged = { ...base };
  for (const def of defs) {
    const raw = controlValues[def.id] ?? "";
    if (raw === "") delete merged[def.id];
    else merged[def.id] = def.type === "toggle" ? raw === "true" : raw;
  }
  return merged;
};

export type RoleChoiceBuild = { choice: Record<string, unknown> } | { error: string };

/** Form → storable RoleChoice. `stored` spreads first so a field the schema
 *  later adds passes through untouched; an empty form field deletes the key
 *  (absent = unset — the live value is preserved at activation, never `null`),
 *  and malformed feature JSON returns an error rather than throwing
 *  mid-dispatch. */
export function buildRoleChoice(
  role: RoutingRole,
  form: RoutingRoleForm,
  stored: RoleChoiceValue | undefined,
  defs: CatalogResult["features"],
): RoleChoiceBuild {
  const label = role === "supervisor" ? "SLP Supervisor" : "SLP Lead";
  const choice: Record<string, unknown> = { ...(stored ?? {}), family: form.family };
  const model = form.model.trim();
  const modeId = form.modeId.trim();
  const thinkingOptionId = form.thinkingOptionId.trim();
  if (model) choice.model = model;
  else delete choice.model;
  if (modeId) choice.modeId = modeId;
  else delete choice.modeId;
  if (thinkingOptionId) choice.thinkingOptionId = thinkingOptionId;
  else delete choice.thinkingOptionId;
  const featuresRaw = form.features.trim();
  let featuresJson: Record<string, unknown> = {};
  if (featuresRaw) {
    try {
      const parsed: unknown = JSON.parse(featuresRaw);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { error: `${label}: feature values must be a JSON object` };
      }
      featuresJson = parsed as Record<string, unknown>;
    } catch {
      return { error: `${label}: feature values are not valid JSON` };
    }
  }
  if (defs.length > 0) {
    choice.featureValues = mergeFeatureValues(defs, featuresJson, form.feature);
  } else if (featuresRaw) {
    choice.featureValues = featuresJson;
  } else {
    delete choice.featureValues;
  }
  return { choice };
}

/** Diff-gate equality between two stored-shape choices: field equality on
 *  family/model/modeId/thinkingOptionId — an absent key is unset on both
 *  sides — plus the order-stable featureValuesKey on featureValues, so `{}`
 *  vs absent still differs (an explicit clear is a real change). */
export function roleChoiceEquals(
  a: RoleChoiceValue | Record<string, unknown> | null | undefined,
  b: RoleChoiceValue | Record<string, unknown> | null | undefined,
): boolean {
  if (a == null || b == null) return a == b;
  return (
    a.family === b.family &&
    a.model === b.model &&
    a.modeId === b.modeId &&
    a.thinkingOptionId === b.thinkingOptionId &&
    featureValuesKey(a.featureValues as Record<string, unknown> | null | undefined) ===
      featureValuesKey(b.featureValues as Record<string, unknown> | null | undefined)
  );
}

/** One gate predicate for a built choice against the stored one. A malformed
 *  feature JSON (an error build) counts as differing so the button stays
 *  pressable and the save path surfaces the build error; an absent stored
 *  choice never equals a built one — the form always carries a family, so
 *  there is always something to persist. */
export const routingChoiceDiffers = (
  build: RoleChoiceBuild,
  stored: RoleChoiceValue | null | undefined,
): boolean => "error" in build || !roleChoiceEquals(build.choice, stored);

/** Explicit family switch on the Role profiles card — not a single-field
 *  write. Dependent picks re-validate against the NEW family's catalog under
 *  keep-if-present rules: a value the new catalog does not list clears to ""
 *  (picker placeholder / provider default — no family marks a model
 *  `isDefault`, so there is nothing to auto-pick). Resolution order: the
 *  model keeps or clears first (same trim semantics as thinkingOptionsFor's
 *  catalog key), then the thinking option resolves against the KEPT model —
 *  a kept option must still be declared by that model. `features`/`feature`
 *  always clear: feature ids are per-provider, and undeclared raw-JSON keys
 *  would persist silently into the new family's routing. An unloaded
 *  (undefined) or errored catalog lists nothing, so everything dependent
 *  clears — deliberate (B20): re-pressing the active chip clears features,
 *  and a not-yet-loaded catalog clears without re-prefill on arrival,
 *  because a deferred re-prefill would race with edits made during the
 *  load. Stored prefill is unaffected — this runs only on an explicit user
 *  pick; the pickers' "(stored)" escape hatches still cover stored values the
 *  catalog doesn't list. */
export function applyFamilyChange(
  form: RoutingRoleForm,
  family: FamilyName,
  catalog: CatalogResult | undefined,
): RoutingRoleForm {
  const model = catalog?.models.some(entry => entry.id === form.model.trim()) ? form.model : "";
  const modeId = catalog?.modes.some(mode => mode.id === form.modeId.trim()) ? form.modeId : "";
  const thinking = thinkingOptionsFor(catalog, model);
  const thinkingOptionId =
    thinking != null && thinking.options.some(option => option.id === form.thinkingOptionId.trim())
      ? form.thinkingOptionId
      : "";
  return { family, model, modeId, thinkingOptionId, features: "", feature: {} };
}

// The view patch a start response produces. Conflicts are surfaced whenever
// they are present — accepted or not (an accepted reconcile inspect can still
// report drift) — and kept in reportedConflicts so a clean follow-up status
// cannot clear a report the operator has not seen.
export function startPatch(start: StartResult): Partial<TargetView> {
  const operation = start.operation;
  return {
    busy: false,
    pending: operation != null && operation.outcome === "pending"
      ? { operationId: operation.operationId, nextPollMs: pollDelayAfterStart(start) }
      : null,
    reportedConflicts: start.conflicts.length ? start.conflicts : null,
    ...(start.accepted
      ? {}
      : { lastError: start.conflicts.length
            ? conflictLines(start.conflicts).join("\n")
            : "operation rejected before acceptance" }),
  };
}

export type ReconcileAction = "inspect" | "complete" | "restore-before";
// §3: complete/restore-before without interruptedOperationId is INVALID_REQUEST
// before acceptance — catch it client-side.
export function reconcileProblem(action: ReconcileAction, interruptedOperationId: string): string | null {
  if (action === "inspect") return null;
  return isOperationId(interruptedOperationId.trim())
    ? null
    : `reconcile ${action} requires the interrupted operation ID`;
}

// ---------------------------------------------------------------------------
// Mandatory disclosures (quoted from spec §9/§11 — shown before any mutation)
// ---------------------------------------------------------------------------

export const EXCLUSIVE_WINDOW_NOTICE =
  "SLP management operations are administrator-only and require an exclusive administrative edit window for the selected daemon. Do not edit daemon configuration through the app, another plugin, a CLI, or a file while activate, reconcile, or deactivate is in progress. The plugin serializes its own operations and verifies persisted and live results. Paseo 0.8.0 provides no compare-and-swap for these patches; this plugin cannot guarantee preservation against concurrent external writers. A detected mismatch stops automatic mutation and requires reconciliation.";

export const RESTORATION_NOTICE =
  "Deactivation restores shared configuration semantics, not original JSON bytes or absent-key shape: it removes unchanged owned provider/profile entries and restores the recorded effective injectIntoAgents value; an originally absent value may become explicit false and an absent profile array may become empty. It never patches mcp.enabled, which must already be enabled. Entries adopted without a surviving receipt keep their observed baseline — the original pre-install shared values are unknown.";

export const RETAINED_RUNTIME_NOTICE =
  "Deactivate detaches configuration but retains every runtime and launcher directory; they remain available to existing sessions, and deletion requires separate maintenance authority after dependencies have ended.";

export const DISABLE_REMOVE_NOTICE =
  "Disabling or removing this plugin is not SLP deactivation. Raw removal leaves verified stable transports operational and correctly roled, with ownership recoverable by reinstalling the same plugin ID and reconciling its retained receipt. Deactivate before removing the manager when detachment is intended.";
