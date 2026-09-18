// Management surface for the paseo-slp plugin (spec §2, §10).
// PluginSurfaceProps carry host.id/host.label only — the daemon home is
// administrator input, never a prop. No auto-activation: every mutation is an
// explicit press behind the two §4 authority acknowledgments, and status is
// fetched on demand, then polled every second only while an operation pends.
//
// The layout is a guided top-down flow — target, status, authority, activate —
// with recovery and override controls collapsed behind their own headers so
// the default view shows only what an activation needs.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { activate, deactivate, reconcile, status, localTarget } from "../shared/contracts.ts";
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
const FAMILY_LABEL: Record<FamilyName, string> = { codex: "Codex", pi: "Pi", devin: "Devin", claude: "Claude Code" };
const AUTHORITY = { exclusiveAdministrativeWindow: true, verifiedHostHomeMapping: true } as const;

type Colors = PluginTheme["colors"];

// ---------------------------------------------------------------------------
// Small themed primitives — the surface uses plain React Native views rather
// than the settings-form kit so the flow can read like a wizard.
// ---------------------------------------------------------------------------

function Card({ colors, title, subtitle, children }: {
  colors: Colors;
  title?: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <View style={[styles.card, { backgroundColor: colors.surface1, borderColor: colors.border }]}>
      {title ? <Text style={[styles.cardTitle, { color: colors.foreground }]}>{title}</Text> : null}
      {subtitle ? <Text style={[styles.muted, { color: colors.foregroundMuted }]}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}

function Button({ colors, label, onPress, disabled, kind = "ghost" }: {
  colors: Colors;
  label: string;
  onPress(): void;
  disabled?: boolean;
  kind?: "primary" | "ghost" | "danger";
}) {
  const base = kind === "primary"
    ? { backgroundColor: colors.accent, borderColor: colors.accent }
    : kind === "danger"
      ? { backgroundColor: "transparent", borderColor: colors.statusDanger }
      : { backgroundColor: colors.surface2, borderColor: colors.border };
  const textColor = kind === "primary"
    ? colors.accentForeground
    : kind === "danger"
      ? colors.statusDanger
      : colors.foreground;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        base,
        disabled && styles.buttonDisabled,
        pressed && !disabled && { opacity: 0.75 },
      ]}
    >
      <Text style={[styles.buttonLabel, { color: textColor }]}>{label}</Text>
    </Pressable>
  );
}

function CheckRow({ colors, checked, onToggle, title, hint, disabled }: {
  colors: Colors;
  checked: boolean;
  onToggle(next: boolean): void;
  title: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={() => onToggle(!checked)}
      disabled={disabled}
      style={({ pressed }) => [styles.checkRow, disabled && { opacity: 0.45 }, pressed && !disabled && { opacity: 0.75 }]}
    >
      <View style={[
        styles.checkbox,
        { borderColor: checked ? colors.accent : colors.border },
        checked && { backgroundColor: colors.accent },
      ]}>
        {checked ? <Text style={[styles.checkmark, { color: colors.accentForeground }]}>✓</Text> : null}
      </View>
      <View style={styles.checkText}>
        <Text style={[styles.checkTitle, { color: colors.foreground }]}>{title}</Text>
        {hint ? <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>{hint}</Text> : null}
      </View>
    </Pressable>
  );
}

function ChipSelect<T extends string>({ colors, value, options, onChange, disabled }: {
  colors: Colors;
  value: T;
  options: readonly { label: string; value: T }[];
  onChange(next: T): void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.chipRow}>
      {options.map(option => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            disabled={disabled}
            style={({ pressed }) => [
              styles.chip,
              { borderColor: active ? colors.accent : colors.border },
              active && { backgroundColor: colors.accent },
              disabled && { opacity: 0.45 },
              pressed && !disabled && { opacity: 0.75 },
            ]}
          >
            <Text style={[styles.chipLabel, { color: active ? colors.accentForeground : colors.foreground }]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Field({ colors, label, hint, value, onChangeText, placeholder, disabled }: {
  colors: Colors;
  label: string;
  hint?: string;
  value: string;
  onChangeText(text: string): void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.foreground }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.foregroundMuted}
        editable={!disabled}
        autoCapitalize="none"
        autoCorrect={false}
        style={[
          styles.input,
          { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.surface0 },
          disabled && { opacity: 0.5 },
        ]}
      />
      {hint ? <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>{hint}</Text> : null}
    </View>
  );
}

function Collapse({ colors, title, subtitle, open, onToggle, children }: {
  colors: Colors;
  title: string;
  subtitle?: string;
  open: boolean;
  onToggle(next: boolean): void;
  children: ReactNode;
}) {
  return (
    <View style={[styles.card, { backgroundColor: colors.surface1, borderColor: colors.border }]}>
      <Pressable
        onPress={() => onToggle(!open)}
        style={({ pressed }) => [styles.collapseHeader, pressed && { opacity: 0.75 }]}
      >
        <Text style={[styles.collapseChevron, { color: colors.foregroundMuted }]}>{open ? "▾" : "▸"}</Text>
        <View style={styles.collapseHeaderText}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>{title}</Text>
          {subtitle ? <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>{subtitle}</Text> : null}
        </View>
      </Pressable>
      {open ? <View style={styles.collapseBody}>{children}</View> : null}
    </View>
  );
}

function KV({ colors, label, value }: { colors: Colors; label: string; value: string }) {
  return (
    <View style={styles.kvRow}>
      <Text style={[styles.kvLabel, { color: colors.foregroundMuted }]}>{label}</Text>
      <Text style={[styles.kvValue, { color: colors.foreground }]} selectable>{value}</Text>
    </View>
  );
}

const STATE_TONE: Record<string, keyof Colors> = {
  ACTIVE: "statusSuccess",
  ACTIVATING: "accent",
  DEACTIVATING: "accent",
  RECOVERY_REQUIRED: "statusWarning",
};
function StatePill({ colors, state }: { colors: Colors; state: string | null }) {
  const tone = state ? STATE_TONE[state] ?? "foregroundMuted" : "foregroundMuted";
  const color = colors[tone];
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <Text style={[styles.pillLabel, { color }]}>{state ?? "unknown"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  pageTitle: { fontSize: 22, fontWeight: "700" },
  card: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 10 },
  cardTitle: { fontSize: 15, fontWeight: "600" },
  muted: { fontSize: 13, lineHeight: 18 },
  mutedSmall: { fontSize: 12, lineHeight: 16 },
  button: { borderWidth: 1, borderRadius: 9, paddingVertical: 9, paddingHorizontal: 16, alignItems: "center", alignSelf: "flex-start" },
  buttonDisabled: { opacity: 0.4 },
  buttonLabel: { fontSize: 14, fontWeight: "600" },
  checkRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  checkbox: { width: 20, height: 20, borderWidth: 1.5, borderRadius: 5, alignItems: "center", justifyContent: "center", marginTop: 1 },
  checkmark: { fontSize: 13, fontWeight: "700" },
  checkText: { flex: 1, gap: 2 },
  checkTitle: { fontSize: 14, fontWeight: "500" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 12 },
  chipLabel: { fontSize: 13, fontWeight: "500" },
  field: { gap: 5 },
  fieldLabel: { fontSize: 13, fontWeight: "500" },
  input: { borderWidth: 1, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10, fontSize: 14 },
  collapseHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  collapseChevron: { fontSize: 14, width: 14 },
  collapseHeaderText: { flex: 1, gap: 2 },
  collapseBody: { gap: 10, paddingTop: 2 },
  kvRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  kvLabel: { fontSize: 13 },
  kvValue: { fontSize: 13, flexShrink: 1, textAlign: "right" },
  pill: { borderWidth: 1.5, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10 },
  pillLabel: { fontSize: 12, fontWeight: "700", letterSpacing: 0.4 },
  conflictBox: { borderWidth: 1, borderRadius: 8, padding: 10, gap: 6 },
  divider: { borderTopWidth: 1, marginVertical: 2 },
});

// ---------------------------------------------------------------------------
// Surface
// ---------------------------------------------------------------------------

export function ManagerSurface({ host, layout, theme }: PluginSurfaceProps) {
  const colors = theme.colors;
  const compact = layout.compact;
  const callStatus = useRpc(status);
  const callActivate = useRpc(activate);
  const callReconcile = useRpc(reconcile);
  const callDeactivate = useRpc(deactivate);
  const callLocalTarget = useRpc(localTarget);

  const [detectedHome, setDetectedHome] = useState<string | null>(null);
  const [homeOverride, setHomeOverride] = useState("");
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

  const home = homeOverride.trim() !== "" ? homeOverride.trim() : (detectedHome ?? "");
  const target: TargetValue | null = isDaemonHome(home) ? { hostId: host.id, daemonHome: home } : null;
  const key = target ? targetKey(target) : null;
  const keyRef = useRef<string | null>(key);
  const autoLoadedFor = useRef<string | null>(null);

  // Prefill the daemon home from the plugin process's own environment
  // (PASEO_HOME else ~/.paseo). A suggestion only — the §4 mapping
  // acknowledgment remains a human decision, and Advanced can override it.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const detected = await callLocalTarget({ schemaVersion: 1 });
        if (!cancelled) setDetectedHome(detected.daemonHome);
      } catch { /* detection unavailable — the field stays empty for manual input */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

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

  // Once a target is known (detected or typed), fetch status automatically —
  // read-only, so no authority acknowledgment is needed to inspect.
  useEffect(() => {
    if (!target || !key || view.status || view.busy || autoLoadedFor.current === key) return;
    autoLoadedFor.current = key;
    void refresh(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key captures target
  }, [key, view.status, view.busy]);

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
      <View style={styles.headerRow}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[styles.pageTitle, { color: colors.foreground }]}>SLP</Text>
          <Text style={[styles.muted, { color: colors.foregroundMuted }]}>
            Provider hierarchy on {host.label}
          </Text>
        </View>
        <StatePill colors={colors} state={statusView?.state ?? null} />
      </View>

      <Card
        colors={colors}
        title="1 · Target"
        subtitle="Detected from this daemon's environment — open Advanced to manage a different home."
      >
        {home ? (
          <KV colors={colors} label="Daemon home" value={home} />
        ) : (
          <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
            No daemon home detected — set one under Advanced.
          </Text>
        )}
        <Button
          colors={colors}
          label={statusView ? "Refresh status" : "Check status"}
          onPress={() => { if (target) void refresh(target); }}
          disabled={!target || view.busy}
        />
      </Card>

      {statusView ? (
        <Card
          colors={colors}
          title="Status"
          subtitle={stateHint(statusView.state) || undefined}
        >
          {statusRows(statusView, { compact }).map(row => (
            <KV key={row.label} colors={colors} label={row.label} value={row.value} />
          ))}
          <View style={{ gap: 6 }}>
            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Provider families</Text>
            <View style={styles.chipRow}>
              {statusView.families.map(family => (
                <View
                  key={family.family}
                  style={[
                    styles.chip,
                    { borderColor: family.availability === "available" ? colors.statusSuccess : colors.statusWarning },
                  ]}
                >
                  <Text style={[styles.chipLabel, { color: colors.foreground }]}>
                    {FAMILY_LABEL[family.family]} · {familyHint(family, { compact: true })}
                  </Text>
                </View>
              ))}
            </View>
          </View>
          {statusView.operation
            ? operationRows(statusView.operation).map(row => (
                <KV key={row.label} colors={colors} label={row.label} value={row.value} />
              ))
            : null}
          {view.pending ? <KV colors={colors} label="Polling" value={`operation ${view.pending.operationId}`} /> : null}
          {view.busy ? <KV colors={colors} label="Busy" value="start call in flight" /> : null}
          {view.notice ? <KV colors={colors} label="Note" value={view.notice} /> : null}
          {view.lastError ? (
            <Text style={[styles.mutedSmall, { color: colors.statusDanger }]}>{view.lastError}</Text>
          ) : null}
          {conflictList.length > 0 ? (
            <View style={[styles.conflictBox, { borderColor: colors.statusDanger }]}>
              <Text style={[styles.fieldLabel, { color: colors.statusDanger }]}>
                {conflictList.length} conflict{conflictList.length === 1 ? "" : "s"}
              </Text>
              {conflictLines(conflictList, compact ? 4 : 8).map((line, index) => (
                <Text key={index} style={[styles.mutedSmall, { color: colors.foreground }]} selectable>
                  {line}
                </Text>
              ))}
            </View>
          ) : null}
        </Card>
      ) : null}

      <Card
        colors={colors}
        title={statusView ? `2 · ${activationLabel(statusView)}` : "2 · Activate"}
        subtitle={statusView ? undefined : "Load status first — the candidate and conflicts must be visible before any change."}
      >
        <CheckRow
          colors={colors}
          checked={exclusiveWindow}
          onToggle={setExclusiveWindow}
          title="Exclusive administrative edit window"
          hint="No other daemon config edits while an operation runs"
        />
        <CheckRow
          colors={colors}
          checked={mappingConfirmed}
          onToggle={setMappingConfirmed}
          disabled={!target}
          title="Verified host/home mapping"
          hint={target ? `${target.daemonHome} belongs to ${host.label}` : "Enter the daemon home first"}
        />
        <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
          {EXCLUSIVE_WINDOW_NOTICE}
        </Text>
        {!statusView?.binding ? (
          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Initial profile family</Text>
            <ChipSelect
              colors={colors}
              value={profileFamily}
              options={[
                { label: "Automatic", value: "auto" as const },
                ...FAMILIES.map(family => ({ label: FAMILY_LABEL[family], value: family })),
              ]}
              onChange={setProfileFamily}
              disabled={!canMutate}
            />
          </View>
        ) : null}
        <Button
          colors={colors}
          kind="primary"
          label={statusView ? activationLabel(statusView) : "Activate"}
          onPress={runActivate}
          disabled={!canMutate || !statusView}
        />
      </Card>

      <Collapse
        colors={colors}
        title="Advanced"
        subtitle="Binary overrides and crash-recovery adoption"
        open={showAdvanced}
        onToggle={setShowAdvanced}
      >
        <Field
          colors={colors}
          label="Daemon home override"
          hint="Detected automatically — edit only to manage a different daemon home"
          value={homeOverride}
          onChangeText={setHomeOverride}
          placeholder={detectedHome ?? "/absolute/path/to/paseo-home"}
        />
        {homeOverride.trim() !== "" && !isDaemonHome(homeOverride.trim()) ? (
          <Text style={[styles.mutedSmall, { color: colors.statusDanger }]}>Enter an absolute path</Text>
        ) : null}
        <CheckRow
          colors={colors}
          checked={adoptIdentical}
          onToggle={setAdoptIdentical}
          disabled={!canMutate}
          title="Adopt identical entries"
          hint="Adopt byte-identical existing SLP entries — recovery after a crash between patch and receipt"
        />
        <Field
          colors={colors}
          label="Node path (optional)"
          hint="Verified absolute ordinary-Node path; an invalid value fails instead of falling back"
          value={nodePath}
          onChangeText={setNodePath}
          placeholder="/usr/bin/node"
          disabled={!canMutate}
        />
        {FAMILIES.map(family => (
          <Field
            key={family}
            colors={colors}
            label={`${FAMILY_LABEL[family]} binary (optional)`}
            value={binaries[family]}
            onChangeText={text => setBinaries(previous => ({ ...previous, [family]: text }))}
            placeholder={`/absolute/path/to/${family}`}
            disabled={!canMutate}
          />
        ))}
      </Collapse>

      <Collapse
        colors={colors}
        title="Maintenance"
        subtitle="Reconcile drift or interrupted operations, or detach SLP from this daemon"
        open={showMaintenance}
        onToggle={setShowMaintenance}
      >
        <View style={styles.field}>
          <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Reconcile action</Text>
          <ChipSelect
            colors={colors}
            value={reconcileAction}
            options={[
              { label: "inspect", value: "inspect" as const },
              { label: "complete", value: "complete" as const },
              { label: "restore-before", value: "restore-before" as const },
            ]}
            onChange={setReconcileAction}
            disabled={!canMutate}
          />
          <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
            inspect is read-only; complete/restore-before finish an interrupted operation
          </Text>
        </View>
        {reconcileAction !== "inspect" ? (
          <Field
            colors={colors}
            label="Interrupted operation ID"
            hint="Required for complete/restore-before"
            value={interruptedId}
            onChangeText={setInterruptedId}
            placeholder="uuid"
            disabled={!canMutate}
          />
        ) : null}
        <Button
          colors={colors}
          label="Run reconcile"
          onPress={runReconcile}
          disabled={!canMutate || !statusView}
        />
        <View style={[styles.divider, { borderTopColor: colors.border }]} />
        <View style={styles.field}>
          <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Deactivate</Text>
          <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>{RESTORATION_NOTICE}</Text>
          <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>{RETAINED_RUNTIME_NOTICE}</Text>
          <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>{DISABLE_REMOVE_NOTICE}</Text>
          <Button
            colors={colors}
            kind="danger"
            label="Deactivate"
            onPress={runDeactivate}
            disabled={!canMutate || !statusView?.binding}
          />
        </View>
      </Collapse>
    </ScrollView>
  );
}
