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
import { activate, catalog, deactivate, reconcile, status, localTarget, setLanguage, getRoleRouting, setRoleRouting } from "../shared/contracts.ts";
import { FAMILY_IDS, FAMILY_LABEL, FAMILY_PICKER_ORDER, MANAGED_FAMILY_PREFIX_RE } from "../shared/families.ts";
import type { CatalogOptionValue, CatalogResult, FamilyName, RoleRoutingValue, StartResult, StatusResult, TargetValue } from "../shared/contracts.ts";
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
  familyFromProviderId,
  familyHint,
  isDaemonHome,
  newOperationId,
  operationPending,
  operationRows,
  pollDelayAfterStatus,
  reconcileProblem,
  routingDiverges,
  startPatch,
  stateHint,
  statusRows,
  targetKey,
  recoverPendingStart,
  visibleConflicts,
} from "./manager-state.ts";
import type { ReconcileAction, TargetView } from "./manager-state.ts";

// Family knowledge derives from the shared registry (shared/families.ts):
// FAMILY_IDS is the canonical order, FAMILY_PICKER_ORDER the picker order
// (registry pickerRank), FAMILY_LABEL the display names — no local literals.
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

function SwitchRow({ colors, checked, onToggle, title, hint, disabled }: {
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
      accessibilityRole="switch"
      accessibilityState={{ checked, disabled }}
      style={({ pressed }) => [styles.checkRow, disabled && { opacity: 0.45 }, pressed && !disabled && { opacity: 0.75 }]}
    >
      <View style={[
        styles.switchTrack,
        { backgroundColor: checked ? colors.accent : colors.border },
      ]}>
        <View style={[
          styles.switchThumb,
          { backgroundColor: checked ? colors.accentForeground : colors.foregroundMuted },
          checked ? styles.switchThumbOn : styles.switchThumbOff,
        ]} />
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
      <Text style={[styles.fieldLabel, { color: colors.foregroundMuted }]}>{label}</Text>
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

/** Searchable single-select for large catalogs (model lists reach hundreds).
 *  Shows the selection as a clearable row; expands into a filtered list. */
function OptionPicker({ colors, label, hint, options, value, onChange, disabled, placeholder }: {
  colors: Colors;
  label: string;
  hint?: string;
  options: readonly CatalogOptionValue[];
  value: string;
  onChange(next: string): void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const selected = options.find(option => option.id === value);
  const filtered = query.trim() === ""
    ? options
    : options.filter(option => `${option.id} ${option.label}`.toLowerCase().includes(query.trim().toLowerCase()));
  const shown = filtered.slice(0, 60);
  // A stored value the catalog doesn't list still displays — never let the
  // picker look empty while a real value is applied.
  const effective = selected ?? (value !== "" ? { id: value, label: value } : undefined);
  if (effective) {
    return (
      <View style={styles.field}>
        <Text style={[styles.fieldLabel, { color: colors.foregroundMuted }]}>{label}</Text>
        <View style={[styles.pickerSelected, { borderColor: colors.accent, backgroundColor: colors.surface0 }]}>
          <Text style={[styles.pickerSelectedLabel, { color: colors.foreground }]} numberOfLines={1}>
            {effective.label !== effective.id ? `${effective.label} · ${effective.id}` : effective.id}
          </Text>
          <Pressable onPress={() => onChange("")} disabled={disabled} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
            <Text style={[styles.pickerClear, { color: colors.accent }]}>Change</Text>
          </Pressable>
        </View>
        {hint ? <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>{hint}</Text> : null}
      </View>
    );
  }
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.foregroundMuted }]}>{label}</Text>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={placeholder ?? "Filter…"}
        placeholderTextColor={colors.foregroundMuted}
        editable={!disabled}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.surface0 }, disabled && { opacity: 0.5 }]}
      />
      <ScrollView style={[styles.pickerList, { borderColor: colors.border, backgroundColor: colors.surface0 }]} nestedScrollEnabled>
        {shown.map(option => (
          <Pressable
            key={option.id}
            onPress={() => onChange(option.id)}
            disabled={disabled}
            style={({ pressed }) => [styles.pickerRow, pressed && { backgroundColor: colors.surface2 }]}
          >
            <Text style={[styles.pickerRowLabel, { color: colors.foreground }]} numberOfLines={1}>
              {option.label !== option.id ? `${option.label} · ${option.id}` : option.id}
            </Text>
          </Pressable>
        ))}
        {filtered.length === 0 ? (
          <Text style={[styles.mutedSmall, { color: colors.foregroundMuted, padding: 10 }]}>No matches.</Text>
        ) : null}
      </ScrollView>
      <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
        {filtered.length} option{filtered.length === 1 ? "" : "s"}{filtered.length > shown.length ? ` — showing first ${shown.length}` : ""}
      </Text>
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
  switchTrack: { width: 38, height: 22, borderRadius: 11, justifyContent: "center", paddingHorizontal: 3, marginTop: 1 },
  switchThumb: { width: 16, height: 16, borderRadius: 8 },
  switchThumbOn: { alignSelf: "flex-end" },
  switchThumbOff: { alignSelf: "flex-start" },
  checkmark: { fontSize: 13, fontWeight: "700" },
  checkText: { flex: 1, gap: 2 },
  checkTitle: { fontSize: 14, fontWeight: "500" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 12 },
  chipLabel: { fontSize: 13, fontWeight: "500" },
  field: { gap: 5 },
  fieldLabel: { fontSize: 13, fontWeight: "500" },
  roleBox: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 10 },
  roleTitle: { fontSize: 14, fontWeight: "600" },
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
  pickerSelected: { borderWidth: 1, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  pickerSelectedLabel: { fontSize: 14, flexShrink: 1 },
  pickerClear: { fontSize: 13, fontWeight: "600" },
  pickerList: { borderWidth: 1, borderRadius: 8, maxHeight: 220 },
  pickerRow: { paddingVertical: 8, paddingHorizontal: 10 },
  pickerRowLabel: { fontSize: 13 },
});

// ---------------------------------------------------------------------------
// Surface
// ---------------------------------------------------------------------------

/** Status rows that are audit/debug metadata — rendered inside the collapsed
 *  "Details" section so the card stays scannable. Everything else (state,
 *  canonical home, candidates, binding) stays visible: spec §4 requires the
 *  home and candidate to be shown before any mutation. */
const STATUS_DETAIL_LABELS = new Set([
  "Runtime",
  "Node",
  "Launch set",
  "Payload",
  "Baseline",
  "Retained runtimes",
  "Last verified",
  "Live acceptance",
]);

export function ManagerSurface({ host, layout, theme }: PluginSurfaceProps) {
  const colors = theme.colors;
  const compact = layout.compact;
  const callStatus = useRpc(status);
  const callActivate = useRpc(activate);
  const callReconcile = useRpc(reconcile);
  const callDeactivate = useRpc(deactivate);
  const callLocalTarget = useRpc(localTarget);
  const callCatalog = useRpc(catalog);
  const callSetLanguage = useRpc(setLanguage);
  const callGetRoleRouting = useRpc(getRoleRouting);
  const callSetRoleRouting = useRpc(setRoleRouting);

  const [detectedHome, setDetectedHome] = useState<string | null>(null);
  const [homeOverride, setHomeOverride] = useState("");
  const [exclusiveWindow, setExclusiveWindow] = useState(false);
  const [mappingConfirmed, setMappingConfirmed] = useState(false);
  const [adoptIdentical, setAdoptIdentical] = useState(false);
  const [nodePath, setNodePath] = useState("");
  const [binaries, setBinaries] = useState<Record<FamilyName, string>>(
    () => Object.fromEntries(FAMILY_IDS.map(family => [family, ""])) as Record<FamilyName, string>,
  );
  const [catalogs, setCatalogs] = useState<Partial<Record<FamilyName, CatalogResult>>>({});
  const [catalogLoadingFor, setCatalogLoadingFor] = useState<FamilyName | null>(null);
  // Feature definitions depend on the selected model (the host requires a
  // provider/model draft) — cached per family|model|modeId key.
  const [featureSets, setFeatureSets] = useState<Record<string, CatalogResult["features"]>>({});
  const [featuresLoadingFor, setFeaturesLoadingFor] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Record<string, string>>({});
  const [prefsDirty, setPrefsDirty] = useState(false);
  const [reconcileAction, setReconcileAction] = useState<ReconcileAction>("inspect");
  const [interruptedId, setInterruptedId] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showMaintenance, setShowMaintenance] = useState(false);
  const [statusDetailsOpen, setStatusDetailsOpen] = useState(false);
  const [languageOn, setLanguageOn] = useState(false);
  const [languageValue, setLanguageValue] = useState("");
  const [languageDirty, setLanguageDirty] = useState(false);
  const [languageBusy, setLanguageBusy] = useState(false);
  // Role routing (Phase 1): `routing` is the stored server-side value,
  // `routingForm` the editable family/model/mode per role. Fields the form
  // does not edit (thinkingOptionId, featureValues) pass through untouched
  // on save so the card never silently drops a stored choice.
  const [routing, setRouting] = useState<RoleRoutingValue | null>(null);
  const emptyRoutingForm = () => ({
    supervisor: { family: "codex" as FamilyName, model: "", modeId: "" },
    lead: { family: "codex" as FamilyName, model: "", modeId: "" },
  });
  const [routingForm, setRoutingForm] = useState<{
    supervisor: { family: FamilyName; model: string; modeId: string };
    lead: { family: FamilyName; model: string; modeId: string };
  }>(emptyRoutingForm);
  const [routingDirty, setRoutingDirty] = useState(false);
  const [routingBusy, setRoutingBusy] = useState(false);
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

  const pref = (field: string) => prefs[field] ?? "";
  const setPref = (field: string) => (text: string) => {
    setPrefsDirty(true);
    setPrefs(current => ({ ...current, [field]: text }));
  };
  const statusView = view.status;

  // Prefill the language control from status until the Human edits it —
  // same tracking discipline as the profile form.
  useEffect(() => {
    if (languageDirty) return;
    const stored = statusView?.communicationLanguage ?? null;
    setLanguageOn(stored !== null);
    setLanguageValue(stored ?? "");
  }, [statusView, languageDirty]);

  // Fetch the stored role routing once per target — the file is plugin-owned
  // and independent of any binding, so it loads with the first status.
  const routingLoadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!target || !key || routingLoadedFor.current === key) return;
    routingLoadedFor.current = key;
    let cancelled = false;
    void (async () => {
      try {
        const result = await callGetRoleRouting({ schemaVersion: 1, target });
        if (!cancelled) setRouting(result.routing);
      } catch {
        if (!cancelled) setRouting(null);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key captures target
  }, [key]);

  // Prefill the routing form from the stored routing until the Human edits —
  // falling back to the live profiles' provider/model, then codex. Same
  // tracking discipline as the language and profile forms.
  useEffect(() => {
    if (routingDirty) return;
    const liveOf = (role: "supervisor" | "lead") =>
      statusView?.managedProfiles.find(profile => profile.id === `slp-${role}`);
    const prefill = (role: "supervisor" | "lead") => ({
      family:
        routing?.[role].family ??
        (familyFromProviderId(liveOf(role)?.provider) as FamilyName | null) ??
        "codex",
      model: routing?.[role].model ?? liveOf(role)?.model ?? "",
      modeId: routing?.[role].modeId ?? liveOf(role)?.modeId ?? "",
    });
    const next = { supervisor: prefill("supervisor"), lead: prefill("lead") };
    setRoutingForm(current =>
      current.supervisor.family === next.supervisor.family &&
      current.supervisor.model === next.supervisor.model &&
      current.supervisor.modeId === next.supervisor.modeId &&
      current.lead.family === next.lead.family &&
      current.lead.model === next.lead.model &&
      current.lead.modeId === next.lead.modeId
        ? current
        : next,
    );
  }, [routing, statusView, routingDirty]);

  const setRoutingField = (
    role: "supervisor" | "lead",
    field: "family" | "model" | "modeId",
  ) => (value: string) => {
    setRoutingDirty(true);
    setRoutingForm(current => ({
      ...current,
      [role]: { ...current[role], [field]: value },
    }));
  };

  // Save validates through the strict schema server-side and lands
  // atomically; it takes effect at the NEXT activation — never here.
  const saveRouting = async () => {
    if (!target) return;
    setRoutingBusy(true);
    try {
      const build = (role: "supervisor" | "lead") => {
        const choice: Record<string, unknown> = {
          ...(routing?.[role] ?? {}),
          family: routingForm[role].family,
        };
        const model = routingForm[role].model.trim();
        const modeId = routingForm[role].modeId.trim();
        if (model) choice.model = model;
        else delete choice.model;
        if (modeId) choice.modeId = modeId;
        else delete choice.modeId;
        return choice;
      };
      const result = await callSetRoleRouting({
        schemaVersion: 1,
        target,
        routing: { schemaVersion: 1, supervisor: build("supervisor"), lead: build("lead") } as RoleRoutingValue,
      });
      setRouting(result.routing);
      setRoutingDirty(false);
    } catch (error) {
      update({ lastError: errorMessage(error) }, target);
    } finally {
      setRoutingBusy(false);
    }
  };

  // Toggle off applies immediately (nothing to type); toggle on waits for
  // the Apply press so an empty value is never written.
  const applyLanguage = async (value: string | null) => {
    if (!target) return;
    setLanguageBusy(true);
    try {
      await callSetLanguage({ schemaVersion: 1, target, value });
      setLanguageDirty(false);
      void refresh(target);
    } catch (error) {
      update({ lastError: errorMessage(error) }, target);
    } finally {
      setLanguageBusy(false);
    }
  };

  // Bound state: prefill the profile editor from the live values status
  // reported — the same values the host's profile editor shows. Once the
  // Human edits, the form stops tracking live config until an apply.
  useEffect(() => {
    if (!statusView?.binding || prefsDirty) return;
    const next: Record<string, string> = {};
    for (const profile of statusView.managedProfiles ?? []) {
      const role = profile.id === "slp-supervisor" ? "supervisor"
        : profile.id === "slp-lead" ? "lead" : null;
      if (!role) continue;
      const family = MANAGED_FAMILY_PREFIX_RE.exec(profile.provider ?? "")?.[1] ?? "";
      next[`${role}.family`] = family;
      next[`${role}.model`] = profile.model ?? "";
      next[`${role}.modeId`] = profile.modeId ?? "";
      next[`${role}.features`] = profile.featureValues ? JSON.stringify(profile.featureValues) : "";
      for (const [featureId, value] of Object.entries(profile.featureValues ?? {})) {
        next[`${role}.feature.${featureId}`] = typeof value === "boolean" ? String(value) : String(value ?? "");
      }
    }
    if (Object.keys(next).length === 0) return;
    setPrefs(current => {
      const stripped = Object.fromEntries(
        Object.entries(current).filter(([field]) => !/^(supervisor|lead)\./.test(field)),
      );
      const merged = { ...stripped, ...next };
      const changed = Object.keys(merged).length !== Object.keys(current).length
        || Object.keys(merged).some(field => current[field] !== merged[field]);
      return changed ? merged : current;
    });
  }, [statusView, prefsDirty]);

  // Fetch the model/mode catalog for every family the form needs — each
  // profile's provider family once bound, plus the routing card's picks.
  // Cached per family; a failure caches an error result so the picker
  // degrades to free text instead of retrying forever.
  const bound = statusView?.binding != null;
  // The role routing card adds its two chosen families so its pickers are
  // populated even when the profile form isn't editing that family.
  const neededFamilies: FamilyName[] = [...new Set([
    ...(bound
      ? (["supervisor", "lead"] as const)
          .map(role => pref(`${role}.family`))
          .filter((family): family is FamilyName => (FAMILY_IDS as readonly string[]).includes(family))
      : []),
    routingForm.supervisor.family,
    routingForm.lead.family,
  ])];
  const neededKey = neededFamilies.join(",");
  useEffect(() => {
    const missing = neededKey.split(",").filter(f => f !== "" && catalogs[f as FamilyName] === undefined);
    if (missing.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const family of missing as FamilyName[]) {
        setCatalogLoadingFor(family);
        try {
          const result = await callCatalog({
            schemaVersion: 1, family,
            ...(target ? { cwd: target.daemonHome } : {}),
          });
          if (!cancelled) setCatalogs(current => ({ ...current, [family]: result }));
        } catch {
          if (!cancelled) {
            setCatalogs(current => ({
              ...current,
              [family]: { schemaVersion: 1, models: [], modes: [], error: "Catalog query failed" },
            }));
          }
        }
      }
      if (!cancelled) setCatalogLoadingFor(null);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the needed family set
  }, [neededKey]);

  // Feature definitions need a model — fetch per role's family|model|modeId.
  const featureKeyFor = (role: "supervisor" | "lead"): string | null => {
    const family = pref(`${role}.family`);
    const model = pref(`${role}.model`).trim();
    if (!model || !(FAMILY_IDS as readonly string[]).includes(family)) return null;
    return `${family}|${model}|${pref(`${role}.modeId`).trim()}`;
  };
  const neededFeatureKeys = (["supervisor", "lead"] as const)
    .map(role => featureKeyFor(role))
    .filter((key): key is string => key !== null);
  const neededFeaturesKey = neededFeatureKeys.join(",");
  useEffect(() => {
    const missing = neededFeaturesKey.split(",").filter(k => k !== "" && featureSets[k] === undefined);
    if (missing.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const key of missing) {
        const [family, model, modeId] = key.split("|") as [FamilyName, string, string];
        setFeaturesLoadingFor(key);
        try {
          const result = await callCatalog({
            schemaVersion: 1, family, model,
            ...(modeId ? { modeId } : {}),
            ...(target ? { cwd: target.daemonHome } : {}),
          });
          if (!cancelled) setFeatureSets(current => ({ ...current, [key]: result.features }));
        } catch {
          if (!cancelled) setFeatureSets(current => ({ ...current, [key]: [] }));
        }
      }
      if (!cancelled) setFeaturesLoadingFor(null);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the needed feature set
  }, [neededFeaturesKey]);
  const featureDefsFor = (role: "supervisor" | "lead") => {
    const key = featureKeyFor(role);
    return {
      defs: key ? (featureSets[key] ?? []) : [],
      loading: key !== null && featuresLoadingFor === key && featureSets[key] === undefined,
    };
  };

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
      // Any terminal operation settles the truth — let the profile form
      // re-sync with the live values the next status reports.
      setPrefsDirty(false);
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
  // Conflicts from the last start response, the tracked operation's own
  // status(opId) results, and the status itself — merged and deduped; an
  // accepted or succeeded operation's conflicts stay visible.
  const conflictList = visibleConflicts(view);

  // One divergence signal for the whole routing card — the stored routing
  // vs the live profile bindings, not per role.
  const routingDiverged = routingDiverges(routing, statusView?.managedProfiles ?? []);

  // Human-supplied profile preferences — parsed into the wire shape; a
  // malformed feature-values JSON blocks the call before dispatch, never
  // mid-operation. Only reachable while bound (the Agent profiles card):
  // a bound apply sends the full desired state per role — empty fields
  // become `null`, which clears the live value on the server.
  const buildProfiles = (): { profiles?: Record<string, unknown>; error?: string } => {
    const out: Record<string, unknown> = {};
    for (const role of ["supervisor", "lead"] as const) {
      const label = role === "supervisor" ? "SLP Supervisor" : "SLP Lead";
      const entry: Record<string, unknown> = {};
      const model = pref(`${role}.model`).trim();
      const modeId = pref(`${role}.modeId`).trim();
      const family = pref(`${role}.family`);
      const featuresRaw = pref(`${role}.features`).trim();
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
      // Feature controls win over raw JSON for keys the provider declares;
      // keys the catalog doesn't know are preserved from the JSON base.
      // Bound apply writes the full control state (what you see is written).
      const defs = featureDefsFor(role).defs;
      let features: Record<string, unknown> | undefined;
      if (defs.length > 0) {
        features = { ...featuresJson };
        for (const def of defs) {
          const raw = pref(`${role}.feature.${def.id}`);
          if (def.type === "toggle") {
            features[def.id] = raw === "" ? def.value : raw === "true";
          } else if (raw !== "") {
            features[def.id] = raw;
          }
        }
      } else if (featuresRaw) {
        features = featuresJson;
      }
      if (!(FAMILY_IDS as readonly string[]).includes(family)) {
        return { error: `${label}: pick a provider family` };
      }
      entry.family = family;
      entry.model = model === "" ? null : model;
      entry.modeId = modeId === "" ? null : modeId;
      entry.featureValues = features === undefined ? null : features;
      out[role] = entry;
    }
    return { profiles: out };
  };

  const activateInput = (includeProfiles: boolean): Parameters<typeof callActivate>[0] | { error: string } => {
    if (!target || !statusView) return { error: "No target" };
    const profilesInput = includeProfiles ? buildProfiles() : {};
    if (profilesInput.error) return { error: profilesInput.error };
    return {
      schemaVersion: 1,
      target,
      operationId: newOperationId(),
      authority: AUTHORITY,
      candidateSha256: statusView.embeddedCandidateSha256,
      adoptIdentical,
      ...(nodePath.trim() ? { nodePath: nodePath.trim() } : {}),
      binaries: Object.fromEntries(
        FAMILY_IDS.map(family => [family, binaries[family].trim()] as const).filter(([, path]) => path !== ""),
      ),
      // `initialProfileFamily` and pre-bind `profiles` stay RPC inputs for
      // scripted use — the UI no longer sends either; the routing card is
      // the single role→provider configurator.
      ...(profilesInput.profiles ? { profiles: profilesInput.profiles } : {}),
    };
  };

  const runActivate = () => {
    const input = activateInput(false);
    if ("error" in input) { update({ lastError: input.error }, target!); return; }
    void runOperation(() => callActivate(input), input.operationId);
  };

  // Apply the managed-profile edits through the same serialized activation
  // operation — the plan writes only the profile fields; providers, runtime,
  // and receipt still verify end-to-end.
  const runApplyProfiles = () => {
    const input = activateInput(true);
    if ("error" in input) { update({ lastError: input.error }, target!); return; }
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

  // One role's editable profile fields in the bound "Agent profiles" card —
  // the per-role provider family picker repoints the profile to that
  // family's managed provider.
  const renderRoleFields = (role: "supervisor" | "lead") => {
    const roleFamily = pref(`${role}.family`) as FamilyName;
    const catalog = catalogs[roleFamily];
    const familyState = statusView?.families.find(entry => entry.family === roleFamily);
    const liveProfile = statusView?.managedProfiles.find(
      entry => entry.id === `slp-${role}`,
    );
    return (
      <View key={role} style={[styles.roleBox, { borderColor: colors.border }]}>
        <View style={styles.field}>
          <Text style={[styles.roleTitle, { color: colors.foreground }]}>
            {role === "supervisor" ? "SLP Supervisor" : "SLP Lead"}
          </Text>
          {liveProfile ? (
            <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
              {liveProfile.id} → {liveProfile.provider}
            </Text>
          ) : null}
        </View>
        <View style={styles.field}>
          <Text style={[styles.fieldLabel, { color: colors.foregroundMuted }]}>Provider family</Text>
          <ChipSelect
            colors={colors}
            value={roleFamily}
            options={FAMILY_PICKER_ORDER.map(entry => ({
              label: FAMILY_LABEL[entry],
              value: entry,
            }))}
            onChange={setPref(`${role}.family`)}
            disabled={!canMutate}
          />
        </View>
        {catalogLoadingFor === roleFamily ? (
          <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
            Loading {FAMILY_LABEL[roleFamily] ?? ""} catalog…
          </Text>
        ) : null}
        {catalog?.error ? (
          <Text style={[styles.mutedSmall, { color: colors.statusWarning }]}>
            Catalog unavailable: {catalog.error} — enter values manually.
          </Text>
        ) : null}
        {catalog && catalog.models.length > 0 ? (
          <OptionPicker
            colors={colors}
            label="Model"
            options={catalog.models}
            value={pref(`${role}.model`)}
            onChange={setPref(`${role}.model`)}
            disabled={!canMutate}
            placeholder="Filter models…"
          />
        ) : (
          <Field
            colors={colors}
            label="Model"
            value={pref(`${role}.model`)}
            onChangeText={setPref(`${role}.model`)}
            placeholder="Model ID — e.g. swe-2-max"
            disabled={!canMutate}
          />
        )}
        {catalog && catalog.modes.length > 0 ? (
          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: colors.foregroundMuted }]}>Mode</Text>
            <ChipSelect
              colors={colors}
              value={pref(`${role}.modeId`)}
              options={[
                { label: "Provider default", value: "" },
                ...catalog.modes.map(mode => ({ label: mode.label, value: mode.id })),
                // A stored mode the catalog doesn't list stays visible.
                ...(pref(`${role}.modeId`) !== "" && !catalog.modes.some(mode => mode.id === pref(`${role}.modeId`))
                  ? [{ label: pref(`${role}.modeId`), value: pref(`${role}.modeId`) }]
                  : []),
              ]}
              onChange={setPref(`${role}.modeId`)}
              disabled={!canMutate}
            />
          </View>
        ) : (
          <Field
            colors={colors}
            label="Mode"
            value={pref(`${role}.modeId`)}
            onChangeText={setPref(`${role}.modeId`)}
            placeholder="Mode ID — e.g. bypass"
            disabled={!canMutate}
          />
        )}
        {featureDefsFor(role).loading ? (
          <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>Loading features…</Text>
        ) : null}
        {featureDefsFor(role).defs.length > 0 ? (
          featureDefsFor(role).defs.map(def => (
            def.type === "toggle" ? (
              <SwitchRow
                key={def.id}
                colors={colors}
                checked={pref(`${role}.feature.${def.id}`) === "" ? def.value : pref(`${role}.feature.${def.id}`) === "true"}
                onToggle={next => setPref(`${role}.feature.${def.id}`)(String(next))}
                title={def.label}
                hint={def.description}
                disabled={!canMutate}
              />
            ) : (
              <View key={def.id} style={styles.field}>
                <Text style={[styles.fieldLabel, { color: colors.foreground }]}>{def.label}</Text>
                <ChipSelect
                  colors={colors}
                  value={pref(`${role}.feature.${def.id}`)}
                  options={[
                    { label: "Provider default", value: "" },
                    ...def.options.map(option => ({ label: option.label, value: option.id })),
                  ]}
                  onChange={setPref(`${role}.feature.${def.id}`)}
                  disabled={!canMutate}
                />
                {def.description ? (
                  <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>{def.description}</Text>
                ) : null}
              </View>
            )
          ))
        ) : (
          <Field
            colors={colors}
            label="Feature values (JSON)"
            hint='Provider feature flags — e.g. {"auto_accept": true}'
            value={pref(`${role}.features`)}
            onChangeText={setPref(`${role}.features`)}
            placeholder="{}"
            disabled={!canMutate}
          />
        )}
        {familyState?.availability === "unavailable" ? (
          <Text style={[styles.mutedSmall, { color: colors.statusWarning }]}>
            {FAMILY_LABEL[roleFamily] ?? roleFamily} is unavailable on this daemon — the apply is rejected until it resolves.
          </Text>
        ) : null}
      </View>
    );
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
        title="Daemon home"
        subtitle="Detected from this daemon's environment — use Advanced to manage a different home."
      >
        {home ? (
          <KV colors={colors} label="Daemon home" value={home} />
        ) : (
          <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
            Daemon home not detected — configure one under Advanced.
          </Text>
        )}
        <Button
          colors={colors}
          label={statusView ? "Refresh" : "Inspect"}
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
          {statusRows(statusView, { compact })
            .filter(row => !STATUS_DETAIL_LABELS.has(row.label))
            .map(row => (
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
          {statusView.operation ? (
            <KV
              colors={colors}
              label="Last operation"
              value={`${statusView.operation.kind} · ${statusView.operation.outcome}`}
            />
          ) : null}
          <Collapse
            colors={colors}
            title="Details"
            subtitle="Runtime paths, hashes, and operation metadata"
            open={statusDetailsOpen}
            onToggle={() => setStatusDetailsOpen(open => !open)}
          >
            {statusRows(statusView, { compact })
              .filter(row => STATUS_DETAIL_LABELS.has(row.label))
              .map(row => (
                <KV key={row.label} colors={colors} label={row.label} value={row.value} />
              ))}
            {statusView.operation
              ? operationRows(statusView.operation).map(row => (
                  <KV key={row.label} colors={colors} label={row.label} value={row.value} />
                ))
              : null}
          </Collapse>
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

      {statusView ? (
        // Phase 1 role routing: ONE card holds both role pickers behind one
        // Save — a single set-role-routing call carrying the full routing
        // object (saveRouting always builds both roles). The stored routing
        // selects which managed provider each managed profile binds to at
        // the NEXT activation — saving never activates on its own, and a
        // divergence between the stored routing and the live binding shows
        // once on the card as a re-activation-required notice. The peer note
        // lives inside this card because it scopes what routing does NOT
        // configure; a separate card would orphan one line of disclosure.
        <Card
          colors={colors}
          title="Role routing"
          subtitle="Which managed provider each role's saved profile binds to — applied at the next activation, never on save."
        >
          {(["supervisor", "lead"] as const).map(role => {
            const form = routingForm[role];
            const roleCatalog = catalogs[form.family];
            const disabled = !target || routingBusy;
            return (
              <View key={role} style={[styles.roleBox, { borderColor: colors.border }]}>
                <Text style={[styles.roleTitle, { color: colors.foreground }]}>
                  {role === "supervisor" ? "SLP Supervisor" : "SLP Lead"}
                </Text>
                <View style={styles.field}>
                  <Text style={[styles.fieldLabel, { color: colors.foregroundMuted }]}>Provider family</Text>
                  <ChipSelect
                    colors={colors}
                    value={form.family}
                    options={FAMILY_PICKER_ORDER.map(entry => ({
                      label: FAMILY_LABEL[entry],
                      value: entry,
                    }))}
                    onChange={setRoutingField(role, "family")}
                    disabled={disabled}
                  />
                </View>
                {catalogLoadingFor === form.family ? (
                  <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
                    Loading {FAMILY_LABEL[form.family]} catalog…
                  </Text>
                ) : null}
                {roleCatalog?.error ? (
                  <Text style={[styles.mutedSmall, { color: colors.statusWarning }]}>
                    Catalog unavailable: {roleCatalog.error} — enter values manually.
                  </Text>
                ) : null}
                {roleCatalog && roleCatalog.models.length > 0 ? (
                  <OptionPicker
                    colors={colors}
                    label="Model"
                    hint="Provider default when unset"
                    options={roleCatalog.models}
                    value={form.model}
                    onChange={setRoutingField(role, "model")}
                    disabled={disabled}
                    placeholder="Filter models…"
                  />
                ) : (
                  <Field
                    colors={colors}
                    label="Model"
                    hint="Provider default when unset"
                    value={form.model}
                    onChangeText={setRoutingField(role, "model")}
                    placeholder="Model ID — e.g. swe-2-max"
                    disabled={disabled}
                  />
                )}
                {roleCatalog && roleCatalog.modes.length > 0 ? (
                  <View style={styles.field}>
                    <Text style={[styles.fieldLabel, { color: colors.foregroundMuted }]}>Mode</Text>
                    <ChipSelect
                      colors={colors}
                      value={form.modeId}
                      options={[
                        { label: "Provider default", value: "" },
                        ...roleCatalog.modes.map(mode => ({ label: mode.label, value: mode.id })),
                        // A stored mode the catalog doesn't list stays visible.
                        ...(form.modeId !== "" && !roleCatalog.modes.some(mode => mode.id === form.modeId)
                          ? [{ label: form.modeId, value: form.modeId }]
                          : []),
                      ]}
                      onChange={setRoutingField(role, "modeId")}
                      disabled={disabled}
                    />
                  </View>
                ) : (
                  <Field
                    colors={colors}
                    label="Mode"
                    value={form.modeId}
                    onChangeText={setRoutingField(role, "modeId")}
                    placeholder="Mode ID — e.g. bypass"
                    disabled={disabled}
                  />
                )}
              </View>
            );
          })}
          <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
            Peers are pool-driven — each Lead delegation picks a family, so all four managed
            peer providers stay generated; the picks above are the only routed roles.
          </Text>
          {routingDiverged ? (
            <Text style={[styles.mutedSmall, { color: colors.statusWarning }]}>
              Stored routing differs from the live binding — re-activation required. Run
              {` ${activationLabel(statusView)}`} to apply it; nothing activates on save.
            </Text>
          ) : null}
          <Button
            colors={colors}
            label={routingBusy ? "Saving…" : "Save routing"}
            disabled={!target || routingBusy || !routingDirty}
            onPress={() => void saveRouting()}
          />
        </Card>
      ) : null}

      {statusView ? (
        <Card
          colors={colors}
          title="Communication language"
          subtitle="One line injected into every managed session at entry — unset keeps each model's default."
        >
          <SwitchRow
            colors={colors}
            checked={languageOn}
            disabled={!target || languageBusy}
            onToggle={next => {
              setLanguageOn(next);
              if (next) {
                setLanguageDirty(true);
              } else {
                setLanguageDirty(false);
                void applyLanguage(null);
              }
            }}
            title="Inject communication language"
            hint="Managed seats are told to use it for reports, handbacks and replies to you."
          />
          {languageOn ? (
            <>
              <Field
                colors={colors}
                label="Language"
                hint="As it should appear in the instruction, e.g. English"
                value={languageValue}
                onChangeText={text => {
                  setLanguageDirty(true);
                  setLanguageValue(text);
                }}
                placeholder="English"
                disabled={languageBusy}
              />
              <Button
                colors={colors}
                label={languageBusy ? "Saving…" : "Apply language"}
                disabled={!target || languageBusy || languageValue.trim() === ""}
                onPress={() => void applyLanguage(languageValue.trim())}
              />
            </>
          ) : null}
        </Card>
      ) : null}

      <Card
        colors={colors}
        title="Activation"
        subtitle={statusView ? undefined : "Inspect the daemon first — the candidate and conflicts must be visible before any change."}
      >
        <CheckRow
          colors={colors}
          checked={exclusiveWindow}
          onToggle={setExclusiveWindow}
          title="Exclusive configuration window"
          hint="No other writers may edit daemon configuration while an operation runs"
        />
        <CheckRow
          colors={colors}
          checked={mappingConfirmed}
          onToggle={setMappingConfirmed}
          disabled={!target}
          title="Daemon home confirmed"
          hint={target ? `${target.daemonHome} is the home of this daemon` : "Detect or configure the daemon home first"}
        />
        <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
          {EXCLUSIVE_WINDOW_NOTICE}
        </Text>
        {!statusView?.binding ? (
          <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
            Activation creates the SLP Supervisor and SLP Lead agent profiles, bound per
            the stored role routing above — an unrouted role falls back to the first
            enabled, available family. Model, mode, and feature values are assigned
            afterward in Settings → Agents → Agent profiles.
          </Text>
        ) : null}
        <Button
          colors={colors}
          kind="primary"
          label={statusView ? activationLabel(statusView) : "Activate"}
          onPress={runActivate}
          disabled={!canMutate || !statusView}
        />
      </Card>

      {statusView?.binding ? (
        <Card
          colors={colors}
          title="Agent profiles"
          subtitle="The two managed profiles — applied through the same exclusive-window operation as any other change."
        >
          {(["supervisor", "lead"] as const).map(role => renderRoleFields(role))}
          {view.lastError ? (
            <Text style={[styles.mutedSmall, { color: colors.statusDanger }]}>{view.lastError}</Text>
          ) : null}
          {!canMutate ? (
            <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
              Requires both acknowledgments in Activation.
            </Text>
          ) : null}
          <Button
            colors={colors}
            kind="primary"
            label="Apply profile changes"
            onPress={runApplyProfiles}
            disabled={!canMutate}
          />
        </Card>
      ) : null}

      <Collapse
        colors={colors}
        title="Advanced"
        subtitle="Executable overrides and recovery options"
        open={showAdvanced}
        onToggle={setShowAdvanced}
      >
        <Field
          colors={colors}
          label="Daemon home"
          hint="Detected automatically — change only to manage a different daemon home"
          value={homeOverride}
          onChangeText={setHomeOverride}
          placeholder={detectedHome ?? "/absolute/path/to/paseo-home"}
        />
        {homeOverride.trim() !== "" && !isDaemonHome(homeOverride.trim()) ? (
          <Text style={[styles.mutedSmall, { color: colors.statusDanger }]}>Enter an absolute path</Text>
        ) : null}
        <SwitchRow
          colors={colors}
          checked={adoptIdentical}
          onToggle={setAdoptIdentical}
          disabled={!canMutate}
          title="Adopt identical entries"
          hint="Adopt byte-identical existing SLP entries — recovery after a crash between patch and receipt"
        />
        <Field
          colors={colors}
          label="Node.js path (optional)"
          hint="Absolute path to a standard Node.js binary; an invalid value fails activation instead of falling back"
          value={nodePath}
          onChangeText={setNodePath}
          placeholder="/usr/bin/node"
          disabled={!canMutate}
        />
        {FAMILY_IDS.map(family => (
          <Field
            key={family}
            colors={colors}
            label={`${FAMILY_LABEL[family]} executable (optional)`}
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
        subtitle="Drift inspection, interrupted operations, and deactivation"
        open={showMaintenance}
        onToggle={setShowMaintenance}
      >
        <View style={styles.field}>
          <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Reconcile action</Text>
          <ChipSelect
            colors={colors}
            value={reconcileAction}
            options={[
              { label: "Inspect", value: "inspect" as const },
              { label: "Complete", value: "complete" as const },
              { label: "Restore before", value: "restore-before" as const },
            ]}
            onChange={setReconcileAction}
            disabled={!canMutate}
          />
          <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
            Inspect is read-only; Complete and Restore before finish an interrupted operation
          </Text>
        </View>
        {reconcileAction !== "inspect" ? (
          <Field
            colors={colors}
            label="Interrupted operation ID"
            hint="Required for Complete and Restore before"
            value={interruptedId}
            onChangeText={setInterruptedId}
            placeholder="uuid"
            disabled={!canMutate}
          />
        ) : null}
        <Button
          colors={colors}
          label="Reconcile"
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
