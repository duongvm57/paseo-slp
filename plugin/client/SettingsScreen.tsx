// Settings screen for the paseo-slp manager plugin (spec §2, §10).
// PluginSurfaceProps carry host.id/host.label only — the daemon home is
// administrator input, never a prop. No auto-activation: every mutation is an
// explicit button behind the two §4 authority acknowledgments, and status is
// fetched on demand, then polled every second only while an operation pends.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import {
  SettingsAction,
  SettingsGroup,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { activate, deactivate, reconcile, status } from "../shared/contracts.ts";
import type { FamilyName, StartResult, StatusResult, TargetValue } from "../shared/contracts.ts";
import {
  DISABLE_REMOVE_NOTICE,
  EXCLUSIVE_WINDOW_NOTICE,
  RESTORATION_NOTICE,
  RETAINED_RUNTIME_NOTICE,
  STATUS_POLL_MS,
  activationLabel,
  applyPatch,
  conflictLines,
  createTargetViews,
  emptyTargetView,
  errorMessage,
  familyHint,
  isDaemonHome,
  newOperationId,
  operationPending,
  operationRows,
  pollDelayAfterStatus,
  reconcileProblem,
  startPatch,
  stateHint,
  statusRows,
  targetKey,
  recoverPendingStart,
  visibleConflicts,
} from "./manager-state.ts";
import type { ReconcileAction, TargetView } from "./manager-state.ts";

const FAMILIES: readonly FamilyName[] = ["codex", "pi", "devin", "claude"];
const AUTHORITY = { exclusiveAdministrativeWindow: true, verifiedHostHomeMapping: true } as const;

export function SettingsScreen({ host, layout }: PluginSurfaceProps) {
  const compact = layout.compact;
  const callStatus = useRpc(status);
  const callActivate = useRpc(activate);
  const callReconcile = useRpc(reconcile);
  const callDeactivate = useRpc(deactivate);

  const [homeInput, setHomeInput] = useState("");
  const [exclusiveWindow, setExclusiveWindow] = useState(false);
  const [mappingConfirmed, setMappingConfirmed] = useState(false);
  const [adoptIdentical, setAdoptIdentical] = useState(false);
  const [nodePath, setNodePath] = useState("");
  const [binaries, setBinaries] = useState<Record<FamilyName, string>>({ codex: "", pi: "", devin: "", claude: "" });
  const [profileFamily, setProfileFamily] = useState<"auto" | FamilyName>("auto");
  const [reconcileAction, setReconcileAction] = useState<ReconcileAction>("inspect");
  const [interruptedId, setInterruptedId] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showMaintenance, setShowMaintenance] = useState(false);
  const [store] = useState(createTargetViews);
  const [view, setView] = useState<TargetView>(emptyTargetView);

  const home = homeInput.trim();
  const target: TargetValue | null = isDaemonHome(home) ? { hostId: host.id, daemonHome: home } : null;
  const key = target ? targetKey(target) : null;
  const keyRef = useRef<string | null>(key);

  // Two-host isolation: each (hostId, daemonHome) keeps its own view state in
  // the store; switching the target swaps in that target's snapshot.
  useEffect(() => {
    keyRef.current = key;
    setView(target ? store.get(target) ?? emptyTargetView() : emptyTargetView());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key captures target
  }, [key]);

  // Bind every patch to the target the request was issued for: a late RPC
  // updates that target's stored view but repaints only while it is still the
  // displayed target — never old-target data over the new target's view.
  const update = useCallback((patch: Partial<TargetView>, forTarget: TargetValue) => {
    const { view, repaint } = applyPatch(store, forTarget, patch, keyRef.current);
    if (repaint) setView(view);
  }, [store]);

  const refresh = useCallback(async (forTarget: TargetValue, operationId?: string): Promise<StatusResult | null> => {
    try {
      const next = await callStatus({ schemaVersion: 1, target: forTarget, ...(operationId ? { operationId } : {}) });
      update({ status: next, lastError: null }, forTarget);
      return next;
    } catch (error) {
      update({ lastError: errorMessage(error) }, forTarget);
      return null;
    }
  }, [callStatus, update]);

  // Poll the tracked operation until it reaches a terminal outcome. The first
  // delay is the server's pollAfterMs; later polls run every STATUS_POLL_MS.
  const pending = view.pending;
  useEffect(() => {
    if (!target || !pending) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (ms: number) => { timer = setTimeout(tick, ms); };
    const tick = async () => {
      const next = await refresh(target, pending.operationId);
      if (cancelled) return;
      if (next == null) { schedule(STATUS_POLL_MS); return; }
      if (operationPending(next.operation)) { schedule(pollDelayAfterStatus(next)); return; }
      update({ pending: null }, target);
    };
    schedule(pending.nextPollMs);
    return () => { cancelled = true; if (timer !== undefined) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-arm only on target/operation change
  }, [key, pending?.operationId]);

  const runOperation = useCallback(async (invoke: () => Promise<StartResult>, operationId: string) => {
    if (!target || view.busy) return;
    update({ busy: true, lastError: null, notice: null }, target);
    const finish = (start: StartResult) => {
      // startPatch keeps start.conflicts visible whether or not the response
      // was accepted — an accepted reconcile inspect can still report drift.
      update(startPatch(start), target);
      void refresh(target);
    };
    try {
      finish(await invoke());
    } catch (error) {
      // §3: an invoke timeout does not cancel server-side work. Poll the
      // original operationId and retry the identical request only when status
      // reports it absent — never assume the timeout cancelled anything.
      let probe: StatusResult | null = null;
      try {
        probe = await callStatus({ schemaVersion: 1, target, operationId });
      } catch { /* probe failure reported below */ }
      if (probe == null) {
        update({ busy: false, lastError: `${errorMessage(error)} (status probe failed as well)` }, target);
        return;
      }
      update({ status: probe }, target);
      const recovery = recoverPendingStart(operationId, probe);
      if (recovery.kind === "retry") {
        try {
          finish(await invoke());
        } catch (again) {
          update({ busy: false, lastError: errorMessage(again) }, target);
        }
      } else if (recovery.kind === "poll") {
        update({
          busy: false,
          pending: { operationId, nextPollMs: STATUS_POLL_MS },
          notice: "start call did not return; the operation was accepted — tracking it",
        }, target);
      } else if (recovery.kind === "settled") {
        update({ busy: false, pending: null }, target);
      } else {
        update({ busy: false, lastError: recovery.message }, target);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key captures target
  }, [key, view.busy, update, callStatus, refresh]);

  const canMutate = target != null && exclusiveWindow && mappingConfirmed && !view.busy;
  const statusView = view.status;
  // Conflicts from the last start response, the tracked operation's own
  // status(opId) results, and the status itself — merged and deduped; an
  // accepted or succeeded operation's conflicts stay visible.
  const conflictList = visibleConflicts(view);

  const runActivate = () => {
    if (!target || !statusView) return;
    const selectedBinaries = Object.fromEntries(
      FAMILIES.map(family => [family, binaries[family].trim()] as const).filter(([, path]) => path !== ""),
    );
    const input: Parameters<typeof callActivate>[0] = {
      schemaVersion: 1,
      target,
      operationId: newOperationId(),
      authority: AUTHORITY,
      candidateSha256: statusView.embeddedCandidateSha256,
      adoptIdentical,
      ...(nodePath.trim() ? { nodePath: nodePath.trim() } : {}),
      binaries: selectedBinaries,
      ...(!statusView.binding && profileFamily !== "auto" ? { initialProfileFamily: profileFamily } : {}),
    };
    void runOperation(() => callActivate(input), input.operationId);
  };

  const runReconcile = () => {
    // §4: canonical home + candidate must be displayed before any operation —
    // reconcile is gated on a loaded status like activate/deactivate.
    if (!target || !statusView) return;
    const problem = reconcileProblem(reconcileAction, interruptedId);
    if (problem) { update({ lastError: problem }, target); return; }
    const input: Parameters<typeof callReconcile>[0] = {
      schemaVersion: 1,
      target,
      operationId: newOperationId(),
      authority: AUTHORITY,
      action: reconcileAction,
      ...(reconcileAction !== "inspect" ? { interruptedOperationId: interruptedId.trim() } : {}),
    };
    void runOperation(() => callReconcile(input), input.operationId);
  };

  const runDeactivate = () => {
    const binding = statusView?.binding;
    if (!target || !binding) return;
    const input: Parameters<typeof callDeactivate>[0] = {
      schemaVersion: 1,
      target,
      operationId: newOperationId(),
      authority: AUTHORITY,
      expectedBindingSha256: binding.bindingSha256,
    };
    void runOperation(() => callDeactivate(input), input.operationId);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: compact ? 12 : 24, gap: compact ? 12 : 16 }}>
      <SettingsGroup
        title="SLP runtime manager"
        info={`Selected host: ${host.label} (${host.id}). The host API exposes no daemon-home mapping — the administrator supplies and confirms it.`}
      >
        <SettingsSection
          title="1 · Target"
          info="Enter the daemon home, then Load status to inspect before changing anything."
        >
          <SettingsInput
            label="Daemon home"
            hint="Absolute path on the selected host, e.g. /home/user/.paseo"
            placeholder="/absolute/path/to/paseo-home"
            initialValue={homeInput}
            onChangeText={setHomeInput}
            error={home.length > 0 && !isDaemonHome(home) ? "Enter an absolute path" : null}
          />
          <SettingsAction
            label="Status"
            hint="Read-only fetch; nothing mutates."
            actionLabel="Load status"
            onPress={() => { if (target) void refresh(target); }}
            disabled={!target || view.busy}
          />
        </SettingsSection>

        <SettingsSection
          title="Status"
          info={statusView ? stateHint(statusView.state) || undefined : "Not loaded — enter the daemon home and Load status."}
        >
          {statusView
            ? statusRows(statusView, { compact }).map(row => (
                <SettingsRow key={row.label} label={row.label} hint={row.value} />
              ))
            : null}
          {statusView?.operation
            ? operationRows(statusView.operation).map(row => (
                <SettingsRow key={row.label} label={row.label} hint={row.value} />
              ))
            : null}
          {view.pending ? <SettingsRow label="Polling" hint={`operation ${view.pending.operationId}`} /> : null}
          {view.busy ? <SettingsRow label="Busy" hint="start call in flight" /> : null}
          {view.notice ? <SettingsRow label="Note" hint={view.notice} /> : null}
          {view.lastError ? <SettingsRow label="Error" error={view.lastError} /> : null}
        </SettingsSection>

        {statusView ? (
          <SettingsSection
            title="Provider families"
            info="An unavailable family gets enabled:false providers and a launcher that fails closed."
          >
            {statusView.families.map(family => (
              <SettingsRow key={family.family} label={family.family} hint={familyHint(family, { compact })} />
            ))}
          </SettingsSection>
        ) : null}

        {conflictList.length > 0 ? (
          <SettingsSection title="Conflicts">
            {conflictLines(conflictList, compact ? 4 : 8).map((line, index) => (
              <SettingsRow key={index} label={`#${index + 1}`} hint={line} />
            ))}
          </SettingsSection>
        ) : null}

        <SettingsSection title="2 · Authority" info={EXCLUSIVE_WINDOW_NOTICE}>
          <SettingsRow label="Semantic restoration" hint={RESTORATION_NOTICE} />
          <SettingsRow label="Retained runtimes" hint={RETAINED_RUNTIME_NOTICE} />
          <SettingsRow label="Disable/remove ≠ deactivate" hint={DISABLE_REMOVE_NOTICE} />
          <SettingsSwitch
            label="Exclusive administrative edit window"
            hint="No other daemon config edits while an operation runs"
            value={exclusiveWindow}
            onValueChange={setExclusiveWindow}
          />
          <SettingsSwitch
            label="Verified host/home mapping"
            hint={target ? `${target.daemonHome} belongs to ${host.label}` : "Enter the daemon home first"}
            value={mappingConfirmed}
            onValueChange={setMappingConfirmed}
            disabled={!target}
          />
        </SettingsSection>

        <SettingsSection title="3 · Activate" info="Explicit operations only — nothing runs on mount or reload.">
          <SettingsAction
            label={statusView ? activationLabel(statusView) : "Activate"}
            hint="Materializes the embedded candidate, verifies it, and patches the daemon config in one serialized operation."
            actionLabel={statusView ? activationLabel(statusView) : "Activate"}
            onPress={runActivate}
            disabled={!canMutate || !statusView}
          />
          {!statusView?.binding ? (
            <SettingsSelect
              label="Initial profile family"
              hint="Applies only to a new binding"
              value={profileFamily}
              options={[
                { label: "Automatic (first available)", value: "auto" },
                ...FAMILIES.map(family => ({ label: family, value: family })),
              ]}
              onValueChange={value => setProfileFamily(value as "auto" | FamilyName)}
              disabled={!canMutate}
            />
          ) : null}
        </SettingsSection>

        <SettingsSwitch
          label="Advanced options"
          hint="Binary overrides and crash-recovery adoption — leave off unless a probe failed or you are recovering an interrupted install"
          value={showAdvanced}
          onValueChange={setShowAdvanced}
        />
        {showAdvanced ? (
          <SettingsSection title="Advanced">
            <SettingsSwitch
              label="Adopt identical entries"
              hint="Adopt byte-identical existing SLP entries — recovery after a crash between patch and receipt"
              value={adoptIdentical}
              onValueChange={setAdoptIdentical}
              disabled={!canMutate}
            />
            <SettingsInput
              label="Node path (optional)"
              hint="Verified absolute ordinary-Node path; an invalid value fails instead of falling back"
              placeholder="/usr/bin/node"
              initialValue={nodePath}
              onChangeText={setNodePath}
              disabled={!canMutate}
            />
            {FAMILIES.map(family => (
              <SettingsInput
                key={family}
                label={`${family} binary (optional)`}
                placeholder={`/absolute/path/to/${family}`}
                initialValue={binaries[family]}
                onChangeText={text => setBinaries(previous => ({ ...previous, [family]: text }))}
                disabled={!canMutate}
              />
            ))}
          </SettingsSection>
        ) : null}

        <SettingsSwitch
          label="Maintenance"
          hint="Reconcile drift/interrupted operations, or detach SLP from this daemon"
          value={showMaintenance}
          onValueChange={setShowMaintenance}
        />
        {showMaintenance ? (
          <SettingsSection title="Maintenance">
            <SettingsSelect
              label="Reconcile action"
              hint="inspect is read-only; complete/restore-before finish an interrupted operation"
              value={reconcileAction}
              options={[
                { label: "inspect", value: "inspect" },
                { label: "complete", value: "complete" },
                { label: "restore-before", value: "restore-before" },
              ]}
              onValueChange={value => setReconcileAction(value as ReconcileAction)}
              disabled={!canMutate}
            />
            {reconcileAction !== "inspect" ? (
              <SettingsInput
                label="Interrupted operation ID"
                hint="Required for complete/restore-before"
                placeholder="uuid"
                initialValue={interruptedId}
                onChangeText={setInterruptedId}
                disabled={!canMutate}
              />
            ) : null}
            <SettingsAction
              label="Reconcile"
              actionLabel="Run reconcile"
              onPress={runReconcile}
              disabled={!canMutate || !statusView}
            />
            <SettingsAction
              label="Deactivate"
              hint="Detaches owned config entries and restores the recorded injection value; runtime files are retained."
              actionLabel="Deactivate"
              onPress={runDeactivate}
              disabled={!canMutate || !statusView?.binding}
            />
          </SettingsSection>
        ) : null}
      </SettingsGroup>
    </ScrollView>
  );
}
