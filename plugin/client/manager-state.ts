// Pure view-state helpers for the SLP manager settings screen (spec §3, §9–§11).
// No react/host imports: this module is unit-tested directly under node, and
// the client bundle check proves it pulls in no server-only or node code.
import { AbsolutePath, Id } from "../shared/contracts.ts";
import type {
  ConflictValue,
  FamilyViewValue,
  OperationViewValue,
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
      return "interrupted or divergent state — run Reconcile (inspect) before any mutation";
    case "ACTIVATING":
    case "DEACTIVATING":
      return "operation in progress";
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
