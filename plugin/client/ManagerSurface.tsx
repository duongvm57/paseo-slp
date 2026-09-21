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
import { copyText } from "@getpaseo/plugin/client/react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { activate, catalog, deactivate, reconcile, status, localTarget, setLanguage, getRoleRouting, setRoleRouting, getJev, setJev, setJevKey, testJev, getPeerPool, setPeerPool, JevProvider } from "../shared/contracts.ts";
import { FAMILY_IDS, FAMILY_LABEL, FAMILY_PICKER_ORDER } from "../shared/families.ts";
import { PEER_SEAT_ARCHETYPES } from "../shared/archetypes.ts";
import {
  HOW_TO_READ,
  STANDARD_SEAT_TOKENS,
  SUITABILITY_AXES,
  SUITABILITY_TOKENS,
  tokenDefinition,
} from "../shared/routing-vocabulary.ts";
import type { CatalogOptionValue, CatalogResult, FamilyName, GetPeerPoolResult, JevViewValue, PeerPoolValue, RoleRoutingValue, StartResult, StatusResult, TargetValue } from "../shared/contracts.ts";
import type { SeatArchetype } from "../shared/archetypes.ts";
import {
  DISABLE_REMOVE_NOTICE,
  EXCLUSIVE_WINDOW_NOTICE,
  RESTORATION_NOTICE,
  RETAINED_RUNTIME_NOTICE,
  STATUS_POLL_MS,
  activationLabel,
  applyFamilyChange,
  applySettingChange,
  applyPatch,
  buildPeerPool,
  buildRoleChoice,
  conflictLines,
  convertSeatToCustom,
  createTargetViews,
  customSeatCopy,
  customSeatFromArchetype,
  customSeatIdError,
  emptyPeerPoolForm,
  emptyTargetView,
  errorMessage,
  familyFromProviderId,
  familyHint,
  formSeatConflict,
  isDaemonHome,
  legacyImportAllowed,
  lineList,
  newOperationId,
  operationPending,
  operationRows,
  peerPoolDiffers,
  peerPoolForm,
  peerSeatFromArchetype,
  pollDelayAfterStatus,
  reconcileProblem,
  routingChoiceDiffers,
  routingDiverges,
  samePeerPoolForm,
  seatManagement,
  startPatch,
  stateHint,
  statusRows,
  suggestCustomSeatId,
  targetKey,
  recoverPendingStart,
  thinkingOptionsFor,
  visibleConflicts,
} from "./manager-state.ts";
import type { PeerPoolForm, PeerSeatForm, ReconcileAction, RoutingRoleForm, TargetView } from "./manager-state.ts";

// Family knowledge derives from the shared registry (shared/families.ts):
// FAMILY_IDS is the canonical order, FAMILY_PICKER_ORDER the picker order
// (registry pickerRank), FAMILY_LABEL the display names — no local literals.
const AUTHORITY = { exclusiveAdministrativeWindow: true, verifiedHostHomeMapping: true } as const;

type Colors = PluginTheme["colors"];

// ---------------------------------------------------------------------------
// Small themed primitives — the surface uses plain React Native views rather
// than the settings-form kit so the flow can read like a wizard.
// ---------------------------------------------------------------------------

function Card({ colors, title, subtitle, trailing, children }: {
  colors: Colors;
  title?: string;
  subtitle?: string;
  /** Header-side slot — the state badge a card reports (mockup card-head). */
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View style={[styles.card, { backgroundColor: colors.surface1, borderColor: colors.border }]}>
      {title || trailing ? (
        <View style={styles.cardHeadRow}>
          {title ? <Text style={[styles.cardTitle, { color: colors.foreground, flex: 1 }]}>{title}</Text> : null}
          {trailing}
        </View>
      ) : null}
      {subtitle ? <Text style={[styles.muted, { color: colors.foregroundMuted }]}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}

/** Compact status badge — the mockup's .badge tones mapped onto the host's
 *  semantic color slots (no hardcoded palette). */
function Badge({ colors, label, tone = "neutral" }: {
  colors: Colors;
  label: string;
  tone?: "draft" | "good" | "managed" | "bad" | "neutral";
}) {
  const color = tone === "draft" ? colors.statusWarning
    : tone === "good" ? colors.statusSuccess
    : tone === "managed" ? colors.accent
    : tone === "bad" ? colors.statusDanger
    : colors.foregroundMuted;
  return (
    <View style={[styles.badge, { borderColor: color, backgroundColor: colors.surface2 }]}>
      <Text style={[styles.badgeLabel, { color }]}>{label}</Text>
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
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled === true }}
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
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: disabled === true }}
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
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled: disabled === true }}
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

function Field({ colors, label, hint, value, onChangeText, placeholder, disabled, secure, multiline }: {
  colors: Colors;
  label: string;
  hint?: string;
  value: string;
  onChangeText(text: string): void;
  placeholder?: string;
  disabled?: boolean;
  secure?: boolean;
  multiline?: boolean;
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
        secureTextEntry={secure === true}
        multiline={multiline === true}
        accessibilityLabel={label}
        accessibilityState={{ disabled: disabled === true }}
        style={[
          styles.input,
          { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.surface0 },
          multiline === true && styles.inputMultiline,
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
          <Pressable
            onPress={() => onChange("")}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`Change ${label}`}
            style={({ pressed }) => [pressed && { opacity: 0.6 }]}
          >
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
        accessibilityLabel={`Filter ${label}`}
        style={[styles.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.surface0 }, disabled && { opacity: 0.5 }]}
      />
      <ScrollView style={[styles.pickerList, { borderColor: colors.border, backgroundColor: colors.surface0 }]} nestedScrollEnabled>
        {shown.map(option => (
          <Pressable
            key={option.id}
            onPress={() => onChange(option.id)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`Select ${option.label !== option.id ? `${option.label} ${option.id}` : option.id}`}
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
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
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

/** One archetype row in the standard-seat picker (mockup pick-row): compact
 *  id + badge, the primary add/open action, and notes + custom creation
 *  tucked behind a per-row expandable. */
function SeatTemplateRow({ colors, archetype, exists, onAdd, onCustom, disabled }: {
  colors: Colors;
  archetype: SeatArchetype;
  exists: boolean;
  onAdd(): void;
  onCustom(): void;
  disabled?: boolean;
}) {
  const [notesOpen, setNotesOpen] = useState(false);
  return (
    <View style={[styles.pickRow, { borderTopColor: colors.border }]}>
      <View style={[styles.cardHeadRow, { justifyContent: "space-between" }]}>
        <Text style={[styles.checkTitle, styles.mono, { color: colors.foreground }]} numberOfLines={1}>
          {archetype.id}
        </Text>
        <Badge colors={colors} label={exists ? "In draft" : "Standard"} tone={exists ? "neutral" : "managed"} />
      </View>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Button
          colors={colors}
          kind="primary"
          label={exists ? "Already present — open seat" : "Add a standard seat"}
          onPress={onAdd}
          disabled={disabled}
        />
        <Pressable
          onPress={() => setNotesOpen(current => !current)}
          accessibilityRole="button"
          accessibilityLabel="Notes and custom option"
          accessibilityState={{ expanded: notesOpen }}
          style={({ pressed }) => [pressed && { opacity: 0.6 }]}
        >
          <Text style={[styles.mutedSmall, { color: colors.accent }]}>
            {notesOpen ? "Hide notes" : "Notes & custom option"}
          </Text>
        </Pressable>
      </View>
      {notesOpen ? (
        <View style={{ gap: 6 }}>
          <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>{archetype.notes}</Text>
          <View>
            <Button
              colors={colors}
              label="Create a custom seat from template"
              onPress={onCustom}
              disabled={disabled}
            />
          </View>
          <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
            Custom seats receive no package token updates.
          </Text>
        </View>
      ) : null}
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
  inputMultiline: { minHeight: 72, textAlignVertical: "top" },
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
  // Draft-clarity mockup tokens mapped onto host theme slots — card-head
  // row, badges, tinted notices, mono identity text, underlined token links.
  cardHeadRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  badge: { borderWidth: 1, borderRadius: 5, paddingVertical: 2, paddingHorizontal: 7 },
  badgeLabel: { fontSize: 11, fontWeight: "700", lineHeight: 16 },
  eyebrow: { fontSize: 11, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase" },
  noticeBox: { borderWidth: 1, borderRadius: 8, padding: 12, gap: 6 },
  confirmBox: { borderWidth: 1, borderRadius: 7, padding: 12, gap: 8 },
  mono: { fontFamily: "monospace" },
  tokenText: { fontFamily: "monospace", fontSize: 12, textDecorationLine: "underline" },
  savedProvider: { borderLeftWidth: 3, borderRadius: 6, padding: 12, gap: 4 },
  seatState: { fontSize: 12, lineHeight: 16, fontWeight: "600" },
  pickRow: { borderTopWidth: 1, paddingVertical: 10, gap: 6 },
});

// ---------------------------------------------------------------------------
// Routing form — the single Role profiles card edits every RoleChoice field
// through one RoutingRoleForm per role (manager-state.ts). The same
// buildRoleChoice path feeds the Save diff-gate and saveRouting.
// ---------------------------------------------------------------------------

const sameRoleForm = (a: RoutingRoleForm, b: RoutingRoleForm): boolean =>
  a.family === b.family &&
  a.model === b.model &&
  a.modeId === b.modeId &&
  a.thinkingOptionId === b.thinkingOptionId &&
  a.features === b.features &&
  Object.keys(a.feature).length === Object.keys(b.feature).length &&
  Object.keys(a.feature).every(key => a.feature[key] === b.feature[key]);

// ---------------------------------------------------------------------------
// Surface
// ---------------------------------------------------------------------------

// Jev provider kinds — the same pin/defaults src/jev.mjs enforces
// daemon-side. Changing kind resets model/baseUrl to the kind's defaults.
const JEV_KIND_DEFAULT = {
  openrouter: { model: "typesafe/jev-1.13", baseUrl: "https://openrouter.ai", keyLabel: "OpenRouter API key", keyFile: "jev-openrouter.key", keyPlaceholder: "sk-or-v1-…" },
  typesafe: { model: "jev-1.13.0", baseUrl: "https://api.typesafe.ai", keyLabel: "TypeSafe API key", keyFile: "jev-typesafe.key", keyPlaceholder: "ts-…" },
} as const;
// Display names for the key/test actions — they name the SAVED provider the
// daemon will actually call, never the dirty draft pick.
const JEV_KIND_LABEL = { openrouter: "OpenRouter", typesafe: "TypeSafe" } as const;

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
  const callGetJev = useRpc(getJev);
  const callSetJev = useRpc(setJev);
  const callSetJevKey = useRpc(setJevKey);
  const callTestJev = useRpc(testJev);
  const callGetPeerPool = useRpc(getPeerPool);
  const callSetPeerPool = useRpc(setPeerPool);

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
  const [featureSets, setFeatureSets] = useState<Record<string, { defs: CatalogResult["features"]; error: string | null }>>({});
  const [featuresLoadingFor, setFeaturesLoadingFor] = useState<string | null>(null);
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
  // `routingForm` the editable copy covering every RoleChoice field. The
  // saved choice spreads the stored entry first so any field the schema
  // later adds passes through untouched — the card never silently drops a
  // stored choice.
  const [routing, setRouting] = useState<RoleRoutingValue | null>(null);
  const emptyRoutingRoleForm = (): RoutingRoleForm => ({
    family: "codex",
    model: "",
    modeId: "",
    thinkingOptionId: "",
    features: "",
    feature: {},
  });
  const emptyRoutingForm = () => ({
    supervisor: emptyRoutingRoleForm(),
    lead: emptyRoutingRoleForm(),
  });
  const [routingForm, setRoutingForm] = useState<{
    supervisor: RoutingRoleForm;
    lead: RoutingRoleForm;
  }>(emptyRoutingForm);
  const [routingDirty, setRoutingDirty] = useState(false);
  const [routingBusy, setRoutingBusy] = useState(false);
  // `routingSaved` shows a one-line confirmation after a bound save until
  // the next edit — the bound case otherwise gives no visible feedback.
  const [routingSaved, setRoutingSaved] = useState(false);
  // Peer pool (user-scope catalog): `poolData` is the last get-peer-pool
  // response (pool + sha256 for the CAS save + the legacy import view);
  // `poolForm` is the editable copy. Saves are whole-file with optimistic
  // concurrency — a sha mismatch refuses the write and the operator reloads.
  const [poolData, setPoolData] = useState<GetPeerPoolResult | null>(null);
  const [poolForm, setPoolForm] = useState<PeerPoolForm>(emptyPeerPoolForm);
  const [poolDirty, setPoolDirty] = useState(false);
  // Saving and Reloading are separate pending states (mockup busy-state
  // finding): each control labels its own in-flight work, while both lock
  // pool mutations through the derived poolBusy below.
  const [poolSaving, setPoolSaving] = useState(false);
  const [poolReloading, setPoolReloading] = useState(false);
  const [poolSaved, setPoolSaved] = useState(false);
  const [poolCopied, setPoolCopied] = useState(false);
  // poolData === null is ambiguous between "still reading" and "the read RPC
  // failed" — poolReadError separates the two (§7.4.E) so an unreadable pool
  // is never painted as an empty list, and so Save can require a successful
  // snapshot rather than silently sending expectedSha256:null.
  const [poolReadError, setPoolReadError] = useState<string | null>(null);
  // Pool-specific errors (CAS conflict, save/reload failure) land in the
  // card's notice area, not only the shared lastError line (§7.4.D).
  const [poolError, setPoolError] = useState<{ message: string; cas: boolean } | null>(null);
  // Dirty-draft reload confirmation (§7.4.C): Reload on an edited draft shows
  // "Keep current edits" / "Discard changes and Reload" before the RPC runs.
  // The confirmation renders AT the control that invoked it (CAS locality):
  // "notice" beside the conflict notice's Reload, "footer" beside the card's.
  const [poolReloadConfirm, setPoolReloadConfirm] = useState<"notice" | "footer" | null>(null);
  // §7.4.D convert-to-custom editor state, and the "Standard set selected —
  // not yet saved" marker after a conflict is resolved toward the standard set.
  const [convertSeatIndex, setConvertSeatIndex] = useState<number | null>(null);
  const [convertId, setConvertId] = useState("");
  const [standardAppliedId, setStandardAppliedId] = useState<string | null>(null);
  // §7.4.F token lookup: which seat's editor hosts the open section and which
  // token is selected (null = the four-axis picker view).
  const [tokenLookupSeat, setTokenLookupSeat] = useState<number | null>(null);
  const [tokenLookupToken, setTokenLookupToken] = useState<string | null>(null);
  // The expanded seat editor and the archetype picker, tracked by seat index
  // (a renamed seat keeps its editor open); removing any seat closes both.
  // pickerQuery filters the picker rows by template id/notes.
  const [openSeat, setOpenSeat] = useState<number | null>(null);
  const [addSeatOpen, setAddSeatOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  // Best-effort scroll/focus targets (CAS locality + token lookup): on
  // react-native-web a host ref resolves to the DOM node, so a guarded
  // scrollIntoView/focus call works there and is a no-op elsewhere — the
  // host gives RN primitives no focus contract beyond this.
  const seatRowRefs = useRef(new Map<number, View | null>());
  const lookupRefs = useRef(new Map<number, View | null>());
  const definitionRefs = useRef(new Map<number, View | null>());
  const keepEditsRef = useRef<View | null>(null);
  const scrollFocusNode = (node: unknown, focus = false) => {
    const dom = node as { scrollIntoView?: (options?: { block?: string }) => void; focus?: () => void } | null;
    dom?.scrollIntoView?.({ block: "nearest" });
    if (focus) dom?.focus?.();
  };
  // Jev: per-daemon config + key — the key value lives only in jevKeyInput
  // until Save, is cleared right after, and status reports hasKey only.
  // Provider kind is selectable (OpenRouter relay vs TypeSafe first-party);
  // model/baseUrl default per kind, baseUrl editable for custom endpoints.
  const [jevView, setJevView] = useState<JevViewValue | null>(null);
  const [jevKind, setJevKind] = useState<"openrouter" | "typesafe">("openrouter");
  const [jevModel, setJevModel] = useState("");
  const [jevBaseUrl, setJevBaseUrl] = useState("");
  const [jevEnabledOn, setJevEnabledOn] = useState(false);
  const [jevRoutingOn, setJevRoutingOn] = useState(false);
  const [jevDirty, setJevDirty] = useState(false);
  const [jevBusy, setJevBusy] = useState(false);
  const [jevSaved, setJevSaved] = useState(false);
  const [jevKeyInput, setJevKeyInput] = useState("");
  const [jevKeyBusy, setJevKeyBusy] = useState(false);
  const [jevTest, setJevTest] = useState<{ ok: boolean; detail: string | null } | null>(null);
  const [jevTestBusy, setJevTestBusy] = useState(false);
  // Jev load state split (mockup recovery finding): a get-jev failure is a
  // distinct error branch with Retry, not an eternal "loading…".
  const [jevLoadError, setJevLoadError] = useState<string | null>(null);
  // Per-field validation errors — the model rule sits at the Model field and
  // the URL rule at Base URL, never pooled into one message (mockup Jev
  // field-error finding). Sourced from the shared JevProvider schema so the
  // client and daemon reject the same shapes.
  const [jevModelError, setJevModelError] = useState<string | null>(null);
  const [jevUrlError, setJevUrlError] = useState<string | null>(null);
  // Any settings edit (provider/model/baseUrl/toggles) invalidates the prior
  // test result AND the key actions — they run against the SAVED provider,
  // not the draft. A pending key input likewise voids the last test.
  const markJevEdited = () => {
    setJevDirty(true);
    setJevSaved(false);
    setJevTest(null);
    setJevModelError(null);
    setJevUrlError(null);
  };
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

  const statusView = view.status;

  // Prefill the language control from status until the Human edits it —
  // same tracking discipline as the routing form.
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

  // Fetch the Jev view once per target — the config is plugin-owned and
  // independent of any binding, so it loads with the first status. loadJev is
  // also the Retry path after a failed load (jevLoadError branch below).
  const jevLoadedFor = useRef<string | null>(null);
  const loadJev = useCallback(async (forTarget: TargetValue) => {
    setJevLoadError(null);
    try {
      const result = await callGetJev({ schemaVersion: 1, target: forTarget });
      setJevView(result.jev);
    } catch (error) {
      setJevView(null);
      setJevLoadError(errorMessage(error));
    }
  }, [callGetJev]);
  useEffect(() => {
    if (!target || !key || jevLoadedFor.current === key) return;
    jevLoadedFor.current = key;
    setJevView(null);
    setJevModelError(null);
    setJevUrlError(null);
    void loadJev(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key captures target
  }, [key]);

  // Pool state is keyed to the displayed target: switching daemon homes drops
  // the previous pool, its draft and every transient flag. Without this a
  // draft authored against home A could save into home B — B's fresh sha256
  // would satisfy the CAS token and hide the swap.
  useEffect(() => {
    setPoolData(null);
    setPoolForm(emptyPeerPoolForm());
    setPoolDirty(false);
    setPoolSaving(false);
    setPoolReloading(false);
    setPoolSaved(false);
    setPoolCopied(false);
    setPoolReadError(null);
    setPoolError(null);
    setPoolReloadConfirm(null);
    setPickerQuery("");
    seatRowRefs.current.clear();
    lookupRefs.current.clear();
    definitionRefs.current.clear();
    setConvertSeatIndex(null);
    setConvertId("");
    setStandardAppliedId(null);
    setTokenLookupSeat(null);
    setTokenLookupToken(null);
    setOpenSeat(null);
    setAddSeatOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key captures target
  }, [key]);

  // Fetch the peer pool once per target — plugin-owned state, independent of
  // any binding, so it loads with the first status like role routing does.
  // The response carries the sha256 every save sends back as its CAS guard.
  // A read failure is recorded distinctly (§7.4.E): the card shows
  // "Could not read the pool", never an empty seat list or an unlocked editor.
  const poolLoadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!target || !key || poolLoadedFor.current === key) return;
    poolLoadedFor.current = key;
    let cancelled = false;
    void (async () => {
      try {
        const result = await callGetPeerPool({ schemaVersion: 1, target });
        if (!cancelled) {
          setPoolData(result);
          setPoolReadError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setPoolData(null);
          setPoolReadError(errorMessage(error));
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key captures target
  }, [key]);

  // Prefill the pool form from the stored pool until the Human edits — same
  // tracking discipline as the routing form. An absent pool starts from the
  // template-policy empty form; a malformed one prefills empty as well (the
  // error line names what the file held).
  useEffect(() => {
    if (poolDirty) return;
    const next = poolData?.pool ? peerPoolForm(poolData.pool) : emptyPeerPoolForm();
    setPoolForm(current => (samePeerPoolForm(current, next) ? current : next));
  }, [poolData, poolDirty]);

  // Prefill the toggles and provider fields from the stored config until the
  // Human edits — same tracking discipline as the language form.
  useEffect(() => {
    if (jevDirty) return;
    setJevEnabledOn(jevView?.enabled === true);
    setJevRoutingOn(jevView?.capabilities?.routing === true);
    const kind = jevView?.provider?.kind === "typesafe" ? "typesafe" : "openrouter";
    setJevKind(kind);
    setJevModel(jevView?.provider?.model ?? JEV_KIND_DEFAULT[kind].model);
    setJevBaseUrl(jevView?.provider?.baseUrl ?? JEV_KIND_DEFAULT[kind].baseUrl);
  }, [jevView, jevDirty]);

  // Provider kind drives the model pin and the baseUrl default/rule — the
  // same contract src/jev.mjs readJevConfig enforces daemon-side. The shared
  // JevProvider schema validates client-side first so a rejected field lands
  // its error AT that field instead of one pooled message.
  const saveJev = async () => {
    if (!target) return;
    const provider = {
      kind: jevKind,
      baseUrl: jevBaseUrl.trim() === "" ? JEV_KIND_DEFAULT[jevKind].baseUrl : jevBaseUrl.trim(),
      model: jevModel.trim() === "" ? JEV_KIND_DEFAULT[jevKind].model : jevModel.trim(),
    };
    const parsed = JevProvider.safeParse(provider);
    if (!parsed.success) {
      const fieldError = (field: string) =>
        parsed.error.issues.find(issue => issue.path[0] === field)?.message ?? null;
      setJevModelError(fieldError("model"));
      setJevUrlError(fieldError("baseUrl"));
      update({ lastError: parsed.error.issues[0]?.message ?? "Invalid Jev provider settings" }, target);
      return;
    }
    setJevModelError(null);
    setJevUrlError(null);
    setJevBusy(true);
    try {
      const result = await callSetJev({
        schemaVersion: 1,
        target,
        jev: {
          schemaVersion: 1,
          enabled: jevEnabledOn,
          capabilities: { routing: jevRoutingOn },
          provider: {
            kind: jevKind,
            baseUrl: jevBaseUrl.trim() === "" ? JEV_KIND_DEFAULT[jevKind].baseUrl : jevBaseUrl.trim(),
            model: jevModel.trim() === "" ? JEV_KIND_DEFAULT[jevKind].model : jevModel.trim(),
          },
        },
      });
      setJevView(result.jev);
      setJevDirty(false);
      setJevSaved(true);
    } catch (error) {
      update({ lastError: errorMessage(error) }, target);
    } finally {
      setJevBusy(false);
    }
  };

  const saveJevKey = async (key: string | null) => {
    if (!target) return;
    setJevKeyBusy(true);
    try {
      await callSetJevKey({ schemaVersion: 1, target, key });
      setJevKeyInput("");
      setJevTest(null);
      const result = await callGetJev({ schemaVersion: 1, target });
      setJevView(result.jev);
    } catch (error) {
      update({ lastError: errorMessage(error) }, target);
    } finally {
      setJevKeyBusy(false);
    }
  };

  const runJevTest = async () => {
    if (!target) return;
    setJevTestBusy(true);
    setJevTest(null);
    try {
      const result = await callTestJev({ schemaVersion: 1, target });
      setJevTest({ ok: result.ok, detail: result.detail });
    } catch (error) {
      setJevTest({ ok: false, detail: errorMessage(error) });
    } finally {
      setJevTestBusy(false);
    }
  };

  // Prefill the routing form from the stored routing until the Human edits —
  // every field falls back to the live profile's value, then the defaults.
  // Same tracking discipline as the language form.
  useEffect(() => {
    if (routingDirty) return;
    const liveOf = (role: "supervisor" | "lead") =>
      statusView?.managedProfiles.find(profile => profile.id === `slp-${role}`);
    const prefill = (role: "supervisor" | "lead"): RoutingRoleForm => {
      const stored = routing?.[role];
      const live = liveOf(role);
      const featureValues = stored?.featureValues ?? live?.featureValues;
      const feature: Record<string, string> = {};
      for (const [featureId, value] of Object.entries(featureValues ?? {})) {
        feature[featureId] = typeof value === "boolean" ? String(value) : String(value ?? "");
      }
      return {
        family:
          stored?.family ??
          (familyFromProviderId(live?.provider) as FamilyName | null) ??
          "codex",
        model: stored?.model ?? live?.model ?? "",
        modeId: stored?.modeId ?? live?.modeId ?? "",
        thinkingOptionId: stored?.thinkingOptionId ?? live?.thinkingOptionId ?? "",
        features: featureValues ? JSON.stringify(featureValues) : "",
        feature,
      };
    };
    const next = { supervisor: prefill("supervisor"), lead: prefill("lead") };
    setRoutingForm(current =>
      sameRoleForm(current.supervisor, next.supervisor) &&
      sameRoleForm(current.lead, next.lead)
        ? current
        : next,
    );
  }, [routing, statusView, routingDirty]);

  // A model or mode pick is not a plain field write: feature defs are keyed
  // family|model|modeId, so values authored under the previous key must
  // clear (applySettingChange) instead of persisting undeclared keys.
  const setRoutingField = (
    role: "supervisor" | "lead",
    field: "model" | "modeId" | "thinkingOptionId" | "features",
  ) => (value: string) => {
    setRoutingDirty(true);
    setRoutingSaved(false);
    setRoutingForm(current => ({
      ...current,
      [role]: field === "model" || field === "modeId"
        ? applySettingChange(current[role], field, value)
        : { ...current[role], [field]: value },
    }));
  };

  // An explicit family switch is not a single-field write: dependents
  // re-validate against the NEW family's catalog — applyFamilyChange keeps
  // only the model/mode/thinking values the new catalog lists and always
  // clears the per-provider feature values. Two edges are deliberate (B20):
  // re-pressing the active chip still clears features, and a family whose
  // catalog is not loaded yet clears dependents with no re-prefill on
  // arrival — re-prefill would race with edits made during the load.
  // Same dirty/saved discipline as the field setters.
  const setRoutingFamily = (
    role: "supervisor" | "lead",
  ) => (family: FamilyName) => {
    setRoutingDirty(true);
    setRoutingSaved(false);
    setRoutingForm(current => ({
      ...current,
      [role]: applyFamilyChange(current[role], family, catalogs[family]),
    }));
  };

  const setRoutingFeature = (
    role: "supervisor" | "lead",
    featureId: string,
  ) => (value: string) => {
    setRoutingDirty(true);
    setRoutingSaved(false);
    setRoutingForm(current => ({
      ...current,
      [role]: { ...current[role], feature: { ...current[role].feature, [featureId]: value } },
    }));
  };

  // Save validates through the strict schema server-side and lands
  // atomically; it takes effect at the NEXT activation — never here. The
  // choices are the same routingBuilds the Save diff-gate compares, so an
  // enabled button can never write something the gate did not see, and a
  // malformed feature-values JSON arrives here as the build's error and
  // surfaces in lastError before dispatch rather than mid-operation.
  const saveRouting = async () => {
    if (!target) return;
    const supervisor = routingBuilds.supervisor;
    if ("error" in supervisor) { update({ lastError: supervisor.error }, target); return; }
    const lead = routingBuilds.lead;
    if ("error" in lead) { update({ lastError: lead.error }, target); return; }
    setRoutingBusy(true);
    try {
      const result = await callSetRoleRouting({
        schemaVersion: 1,
        target,
        routing: { schemaVersion: 1, supervisor: supervisor.choice, lead: lead.choice } as RoleRoutingValue,
      });
      setRouting(result.routing);
      setRoutingDirty(false);
      setRoutingSaved(true);
    } catch (error) {
      update({ lastError: errorMessage(error) }, target);
    } finally {
      setRoutingBusy(false);
    }
  };

  // The pool's diff-gate mirrors the routing card's: ONE build path produces
  // the document the gate compares and savePeerPool dispatches. The stored
  // options map lets buildPeerSeat preserve passthrough fields the form does
  // not model (and deliberately drop the retired `priority`).
  const storedSeatOptions = new Map(
    (poolData?.pool?.options ?? []).map(option => [option.id, option]),
  );
  // Seat feature defs read the same per-key cache as the role pickers below —
  // hoisted above poolBuild because buildPeerPool invokes the lambda eagerly
  // during render (a const declared later would be a TDZ crash on any
  // non-empty seat list).
  const featureDefsForSeat = (seat: PeerSeatForm) => {
    const key = seat.family !== "" && seat.model.trim() !== ""
      ? `${seat.family}|${seat.model.trim()}|${seat.modeId.trim()}`
      : null;
    const set = key ? featureSets[key] : undefined;
    return {
      key,
      defs: set?.defs ?? [],
      error: set?.error ?? null,
      loading: key !== null && featuresLoadingFor === key,
    };
  };
  const poolBuild = buildPeerPool(
    poolForm,
    seat => featureDefsForSeat(seat).defs,
    storedSeatOptions,
  );
  const poolDiffers = peerPoolDiffers(poolBuild, poolData?.pool ?? null);
  // §7.4.E — the editor stays locked until the first successful snapshot:
  // with no read there is no CAS token and no shared baseline to diff.
  // Either pending pool op locks mutations; the labels stay per-operation.
  const poolBusy = poolSaving || poolReloading;
  const poolLocked = poolBusy || poolData === null;
  // §7.4.D — reserved ids whose draft tokens diverge from the package set.
  // The card notice presses open the seat; the seat row carries the same
  // marker, and buildPeerPool refuses to Save/Copy while any remain.
  const conflictedSeats = poolForm.seats
    .map((seat, index) => ({ index, conflict: formSeatConflict(seat) }))
    .filter((entry): entry is { index: number; conflict: NonNullable<typeof entry.conflict> } => entry.conflict !== null);

  // Every pool edit goes through updatePool — it marks the form dirty and
  // clears the one-shot save/copy confirmations.
  const updatePool = (mutate: (form: PeerPoolForm) => PeerPoolForm) => {
    setPoolDirty(true);
    setPoolSaved(false);
    setPoolCopied(false);
    setPoolForm(current => mutate(current));
  };

  const setSeatField = (
    index: number,
    field: "model" | "modeId" | "thinkingOptionId" | "features" | "suitableFor" | "avoidFor" | "notes",
  ) => (value: string) =>
    updatePool(form => ({
      ...form,
      seats: form.seats.map((seat, i) =>
        i === index
          ? (field === "model" || field === "modeId" ? applySettingChange(seat, field, value) : { ...seat, [field]: value })
          : seat,
      ),
    }));

  // Renaming a seat also retargets the quota-fallback designation — a dangling
  // id would only surface as a build error later.
  const setSeatId = (index: number) => (value: string) =>
    updatePool(form => {
      const oldId = form.seats[index]?.id;
      const seats = form.seats.map((seat, i) => (i === index ? { ...seat, id: value } : seat));
      const quotaFallbackId = form.quotaFallbackId === oldId ? value.trim() : form.quotaFallbackId;
      return { ...form, seats, quotaFallbackId };
    });

  // Family switch on a seat re-validates dependents against the NEW family's
  // catalog — the same applyFamilyChange rule the role pickers use. "" parks
  // the seat (clears dependents); a stored family missing from the available
  // set stays as an escape-hatch chip.
  const setSeatFamily = (index: number) => (family: FamilyName | "") =>
    updatePool(form => ({
      ...form,
      seats: form.seats.map((seat, i) =>
        i !== index
          ? seat
          : {
              ...seat,
              ...(family === ""
                ? { family: "" as const, model: "", modeId: "", thinkingOptionId: "", features: "", feature: {} }
                : applyFamilyChange(seat, family, catalogs[family])),
            },
      ),
    }));

  const setSeatEnabled = (index: number) => (next: boolean) =>
    updatePool(form => ({
      ...form,
      seats: form.seats.map((seat, i) => (i === index ? { ...seat, enabled: next } : seat)),
    }));

  const setSeatFeature = (index: number, featureId: string) => (value: string) =>
    updatePool(form => ({
      ...form,
      seats: form.seats.map((seat, i) =>
        i === index ? { ...seat, feature: { ...seat.feature, [featureId]: value } } : seat,
      ),
    }));

  // §7.4.C picker actions. A standard add always lands on the exact
  // canonical id — when the seat already exists (Token conflict included)
  // the entry just opens it ("Already present — open seat"); it never produces a suffix.
  const addStandardSeat = (archetype: (typeof PEER_SEAT_ARCHETYPES)[number]) => () => {
    const existingIndex = poolForm.seats.findIndex(seat => seat.id.trim() === archetype.id);
    if (existingIndex >= 0) {
      setOpenSeat(existingIndex);
      return;
    }
    updatePool(form => ({
      ...form,
      seats: [...form.seats, peerSeatFromArchetype(archetype)],
    }));
    setOpenSeat(poolForm.seats.length);
  };

  // "Create a custom seat from template": the archetype's tokens/notes copied into an
  // editable Custom seat — parked (blank binding, disabled) on a suggested
  // non-reserved id.
  const addCustomFromTemplate = (archetype: (typeof PEER_SEAT_ARCHETYPES)[number]) => () => {
    updatePool(form => ({
      ...form,
      seats: [...form.seats, customSeatFromArchetype(archetype, form.seats.map(seat => seat.id))],
    }));
    setOpenSeat(poolForm.seats.length);
  };

  // "Create a custom copy" (§7.4.C): copies the viewed row — binding and
  // contents — onto a suggested custom id, disabled. The original seat and
  // its quotaFallback references stay; the copy is not added to fallback.
  const copySeatAsCustom = (index: number) => () => {
    updatePool(form => ({
      ...form,
      seats: [...form.seats, customSeatCopy(form.seats[index], form.seats.map(seat => seat.id))],
    }));
    setOpenSeat(poolForm.seats.length);
  };

  // §7.4.D "Convert this seat to a custom seat": one draft edit renames the seat
  // and retargets the in-pool quotaFallback designation; the Save that lands
  // it keeps the two sides atomic.
  const openConvertToCustom = (index: number) => () => {
    setConvertSeatIndex(index);
    setConvertId(suggestCustomSeatId(poolForm.seats[index]?.id.trim() || "seat", poolForm.seats.map(seat => seat.id)));
  };
  const applyConvertToCustom = () => {
    if (convertSeatIndex === null) return;
    const index = convertSeatIndex;
    updatePool(form => convertSeatToCustom(form, index, convertId));
    setConvertSeatIndex(null);
    setConvertId("");
    setStandardAppliedId(null);
  };

  // "Apply the standard set" (§7.4.D): adopt the package token set into the draft —
  // not yet saved; the seat keeps its binding and notes.
  const applyStandardTokens = (index: number) => () => {
    const seatId = poolForm.seats[index]?.id.trim() ?? "";
    const standard = STANDARD_SEAT_TOKENS[seatId];
    if (!standard) return;
    updatePool(form => ({
      ...form,
      seats: form.seats.map((seat, i) =>
        i === index
          ? { ...seat, suitableFor: standard.suitableFor.join("\n"), avoidFor: standard.avoidFor.join("\n") }
          : seat,
      ),
    }));
    setStandardAppliedId(seatId);
  };

  // Removing a seat drops its fallback designation too — a stale id would
  // fail the build. Every index-keyed piece of editor state is cleared
  // because removal shifts the seats after it — a stale index would bind the
  // convert dialog, the token lookup or the standard-applied marker onto the
  // WRONG seat.
  const removeSeat = (index: number) => () => {
    const removedId = poolForm.seats[index]?.id;
    updatePool(form => ({
      ...form,
      seats: form.seats.filter((_, i) => i !== index),
      quotaFallbackId: form.quotaFallbackId === removedId ? "" : form.quotaFallbackId,
    }));
    setOpenSeat(null);
    setConvertSeatIndex(null);
    setConvertId("");
    setTokenLookupSeat(null);
    setTokenLookupToken(null);
    setStandardAppliedId(current => (current === removedId ? null : current));
    // Indexes shift on removal — ref targets keyed by index are stale.
    seatRowRefs.current.clear();
    lookupRefs.current.clear();
    definitionRefs.current.clear();
  };

  const setFallbackId = (seatId: string) =>
    updatePool(form => ({ ...form, quotaFallbackId: seatId }));

  // Save dispatches the same poolBuild the gate compared — whole-file write
  // guarded by the sha256 get-peer-pool returned. A build error is surfaced
  // AND opens the offending seat's editor; a CAS refusal lands in the card's
  // notice area (§7.4.D) with a Reload affordance instead of only lastError.
  const savePeerPool = async () => {
    if (!target || !key) return;
    if ("error" in poolBuild) {
      update({ lastError: poolBuild.error }, target);
      if (poolBuild.seatIndex != null) setOpenSeat(poolBuild.seatIndex);
      return;
    }
    const issueKey = key;
    setPoolSaving(true);
    try {
      const result = await callSetPeerPool({
        schemaVersion: 1,
        target,
        pool: poolBuild.pool,
        expectedSha256: poolData?.sha256 ?? null,
      });
      // A save issued for home A must never land on home B's view.
      if (keyRef.current !== issueKey) return;
      setPoolData(current => ({
        schemaVersion: 1,
        pool: result.pool,
        sha256: result.sha256,
        error: null,
        legacy: current?.legacy ?? null,
        legacyError: current?.legacyError ?? null,
      }));
      setPoolDirty(false);
      setPoolSaved(true);
      setPoolError(null);
      setStandardAppliedId(null);
      setConvertSeatIndex(null);
    } catch (error) {
      const message = errorMessage(error);
      update({ lastError: message }, target);
      const cas = message.includes("peer pool changed");
      setPoolError({
        message: cas ? "The pool changed since the last read; Reload to fetch the new version." : message,
        cas,
      });
    } finally {
      setPoolSaving(false);
    }
  };

  // Reload discards in-flight edits and refetches — the recovery path after
  // a CAS conflict, and the escape after a malformed-file fix elsewhere. On
  // a dirty draft the press first offers "Keep current edits" /
  // "Discard changes and Reload" (§7.4.C); a failed refetch keeps the draft.
  const reloadPeerPool = async () => {
    if (!target || !key) return;
    const issueKey = key;
    setPoolReloading(true);
    try {
      const result = await callGetPeerPool({ schemaVersion: 1, target });
      if (keyRef.current !== issueKey) return;
      setPoolData(result);
      setPoolReadError(null);
      setPoolError(null);
      setPoolDirty(false);
      setPoolSaved(false);
      setPoolCopied(false);
      setStandardAppliedId(null);
      setConvertSeatIndex(null);
    } catch (error) {
      const message = errorMessage(error);
      update({ lastError: message }, target);
      setPoolError({ message, cas: false });
    } finally {
      setPoolReloading(false);
    }
  };
  const requestReload = (origin: "notice" | "footer") => {
    if (poolDirty) {
      setPoolReloadConfirm(origin);
      // "Keep current edits" is the safe default — focus it once the
      // confirmation renders (best-effort on the host's DOM backend).
      setTimeout(() => scrollFocusNode(keepEditsRef.current, true), 0);
    } else {
      void reloadPeerPool();
    }
  };

  // One-time import of the legacy ~/.paseo/slp-routing.json the server
  // reports — fills the form only; nothing is written until Save, and the
  // legacy file is never removed. The affordance exists only for an absent
  // pool with a TRULY untouched draft (§7.4.C: seats AND policy/fallback):
  // importing over authored content would discard it with no undo. Legacy
  // tokens import verbatim — old tags stay and surface as Token conflicts.
  const canImportLegacy = legacyImportAllowed(poolData, poolForm, poolDirty);
  const importLegacyPool = () => {
    if (!canImportLegacy || !poolData?.legacy) return;
    setPoolForm(peerPoolForm(poolData.legacy));
    setPoolDirty(true);
    setPoolSaved(false);
    setPoolCopied(false);
  };

  // "Retry catalog" (§7.4.E): the cached error entry is only overwritten
  // by a fresh RPC — a failed retry keeps the last error visible.
  const retryCatalog = async (family: FamilyName) => {
    setCatalogLoadingFor(family);
    try {
      const result = await callCatalog({
        schemaVersion: 1, family,
        ...(target ? { cwd: target.daemonHome } : {}),
      });
      setCatalogs(current => ({ ...current, [family]: result }));
    } catch (error) {
      setCatalogs(current => ({
        ...current,
        [family]: { schemaVersion: 1, models: [], modes: [], features: [], error: errorMessage(error) },
      }));
    } finally {
      setCatalogLoadingFor(current => (current === family ? null : current));
    }
  };

  // Copy renders the SAME pool the Save gate saw — a malformed form refuses
  // here too rather than copying JSON that would fail validateCatalog.
  const copyPoolJson = async () => {
    if ("error" in poolBuild) { if (target) update({ lastError: poolBuild.error }, target); return; }
    try {
      await copyText(JSON.stringify(poolBuild.pool, null, 2));
      setPoolCopied(true);
    } catch (error) {
      if (target) update({ lastError: errorMessage(error) }, target);
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

  // Fetch the model/mode catalog for the families the routing card and the
  // peer-pool seats pick — the routing card's two picks plus every seated
  // family are the only ones the form needs. Cached per family; a failure
  // caches an error result so the picker degrades to free text instead of
  // retrying forever.
  const neededFamilies: FamilyName[] = [...new Set([
    routingForm.supervisor.family,
    routingForm.lead.family,
    ...poolForm.seats.map(seat => seat.family).filter((f): f is FamilyName => f !== ""),
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
            const failed: CatalogResult = {
              schemaVersion: 1, models: [], modes: [], features: [],
              error: "Catalog query failed",
            };
            setCatalogs(current => ({ ...current, [family]: failed }));
          }
        }
      }
      if (!cancelled) setCatalogLoadingFor(null);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the needed family set
  }, [neededKey]);

  // Feature definitions need a model — fetch per role's routing-form
  // family|model|modeId pick.
  const featureKeyFor = (role: "supervisor" | "lead"): string | null => {
    const family = routingForm[role].family;
    const model = routingForm[role].model.trim();
    if (!model) return null;
    return `${family}|${model}|${routingForm[role].modeId.trim()}`;
  };
  const neededFeatureKeys = (["supervisor", "lead"] as const)
    .map(role => featureKeyFor(role))
    .concat(
      poolForm.seats.map(seat =>
        seat.family !== "" && seat.model.trim() !== ""
          ? `${seat.family}|${seat.model.trim()}|${seat.modeId.trim()}`
          : null,
      ).filter((key): key is string => key !== null),
    );
  const neededFeaturesKey = neededFeatureKeys.join(",");
  // A failed feature-defs fetch keeps the raw-JSON fallback but records the
  // error — silently caching [] made a dropped mobile RPC look exactly like
  // "provider declares no features". One automatic retry absorbs transient
  // drops; only a persistent failure degrades to the JSON field + Retry.
  const fetchFeatureSet = async (key: string) => {
    const [family, model, modeId] = key.split("|") as [FamilyName, string, string];
    const request = {
      schemaVersion: 1 as const, family, model,
      ...(modeId ? { modeId } : {}),
      ...(target ? { cwd: target.daemonHome } : {}),
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await callCatalog(request);
        setFeatureSets(current => ({ ...current, [key]: { defs: result.features, error: result.error } }));
        return;
      } catch (error) {
        if (attempt === 1) {
          setFeatureSets(current => ({ ...current, [key]: { defs: [], error: errorMessage(error) } }));
        } else {
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      }
    }
  };
  useEffect(() => {
    const missing = neededFeaturesKey.split(",").filter(k => k !== "" && featureSets[k] === undefined);
    if (missing.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const key of missing) {
        setFeaturesLoadingFor(key);
        await fetchFeatureSet(key);
        if (cancelled) return;
      }
      if (!cancelled) setFeaturesLoadingFor(null);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the needed feature set
  }, [neededFeaturesKey]);
  const retryFeatureSet = async (key: string) => {
    setFeaturesLoadingFor(key);
    await fetchFeatureSet(key);
    setFeaturesLoadingFor(null);
  };
  const featureDefsFor = (role: "supervisor" | "lead") => {
    const key = featureKeyFor(role);
    const set = key ? featureSets[key] : undefined;
    return {
      key,
      defs: set?.defs ?? [],
      error: set?.error ?? null,
      loading: key !== null && featuresLoadingFor === key,
    };
  };
  // The Save diff-gate (spec §9): ONE build path produces the choices the
  // gate compares and saveRouting dispatches. Save enables when a bound
  // form builds to a routing that differs from the stored one — a bound
  // form equal to stored leaves nothing to persist (a save would be a
  // no-op), while a stored-absent routing always differs because the
  // prefilled form carries a config worth persisting.
  const routingBuilds = {
    supervisor: buildRoleChoice("supervisor", routingForm.supervisor, routing?.supervisor, featureDefsFor("supervisor").defs),
    lead: buildRoleChoice("lead", routingForm.lead, routing?.lead, featureDefsFor("lead").defs),
  };
  const routingDiffers =
    routingChoiceDiffers(routingBuilds.supervisor, routing?.supervisor) ||
    routingChoiceDiffers(routingBuilds.lead, routing?.lead);

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
  // Conflicts from the last start response, the tracked operation's own
  // status(opId) results, and the status itself — merged and deduped; an
  // accepted or succeeded operation's conflicts stay visible.
  const conflictList = visibleConflicts(view);

  // One divergence signal for the whole routing card — the stored routing
  // vs the live profile bindings, not per role.
  const routingDiverged = routingDiverges(routing, statusView?.managedProfiles ?? []);

  // The peer-pool family picker offers only families the host reports as
  // available (registry picker order) — a seat's stored family that is no
  // longer available keeps an "(unavailable)" escape-hatch chip.
  const availableFamilies: FamilyName[] = FAMILY_PICKER_ORDER.filter(family =>
    statusView?.families.find(view => view.family === family)?.availability === "available",
  );

  // `initialProfileFamily` and `profiles` stay activate RPC inputs for
  // scripted use — the UI never sends either; the routing card is the
  // single role→provider configurator and applies through activation.
  const activateInput = (): Parameters<typeof callActivate>[0] | { error: string } => {
    if (!target || !statusView) return { error: "No target" };
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
    };
  };

  const runActivate = () => {
    const input = activateInput();
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
            the Role profiles card — an unrouted role falls back to the first enabled,
            available family.
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

      {statusView ? (
        // ONE card edits the full profile each role binds — family, model,
        // mode, feature values, thinking option — behind one Save issuing a
        // single set-role-routing call with the full routing object
        // (saveRouting always builds both roles). The stored routing is the
        // sole role→provider configurator and applies at the NEXT
        // activation — saving never activates on its own, and a divergence
        // between the stored routing and the live binding shows once on the
        // card. The peer note lives inside this card because it scopes what
        // routing does NOT configure; a separate card would orphan one line
        // of disclosure.
        <Card
          colors={colors}
          title="Role profiles"
          subtitle="The provider, model, mode, feature values, and thinking option each role's profile binds — applied at the next activation."
        >
          {(["supervisor", "lead"] as const).map(role => {
            const form = routingForm[role];
            const roleCatalog = catalogs[form.family];
            const thinking = thinkingOptionsFor(roleCatalog, form.model);
            const featureDefs = featureDefsFor(role);
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
                    onChange={setRoutingFamily(role)}
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
                {featureDefs.loading ? (
                  <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>Loading features…</Text>
                ) : null}
                {featureDefs.defs.length > 0 ? (
                  featureDefs.defs.map(def => (
                    def.type === "toggle" ? (
                      <SwitchRow
                        key={def.id}
                        colors={colors}
                        checked={(form.feature[def.id] ?? "") === "" ? def.value : form.feature[def.id] === "true"}
                        onToggle={next => setRoutingFeature(role, def.id)(String(next))}
                        title={def.label}
                        hint={def.description}
                        disabled={disabled}
                      />
                    ) : (
                      <View key={def.id} style={styles.field}>
                        <Text style={[styles.fieldLabel, { color: colors.foreground }]}>{def.label}</Text>
                        <ChipSelect
                          colors={colors}
                          value={form.feature[def.id] ?? ""}
                          options={[
                            { label: "Provider default", value: "" },
                            ...def.options.map(option => ({ label: option.label, value: option.id })),
                          ]}
                          onChange={setRoutingFeature(role, def.id)}
                          disabled={disabled}
                        />
                        {def.description ? (
                          <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>{def.description}</Text>
                        ) : null}
                      </View>
                    )
                  ))
                ) : (
                  <>
                    <Field
                      colors={colors}
                      label="Feature values (JSON)"
                      hint='Provider feature flags — e.g. {"auto_accept": true}'
                      value={form.features}
                      onChangeText={setRoutingField(role, "features")}
                      placeholder="{}"
                      disabled={disabled}
                    />
                    {featureDefs.error ? (
                      <>
                        <Text style={[styles.mutedSmall, { color: colors.statusWarning }]}>
                          Feature controls unavailable: {featureDefs.error} — edit JSON or retry.
                        </Text>
                        <Button
                          colors={colors}
                          label="Retry feature controls"
                          onPress={() => {
                            if (featureDefs.key) void retryFeatureSet(featureDefs.key);
                          }}
                          disabled={disabled || featureDefs.loading}
                        />
                      </>
                    ) : null}
                  </>
                )}
                {thinking === null ? (
                  // No catalog / no picked model / model not listed — the
                  // established free-text degradation path.
                  <Field
                    colors={colors}
                    label="Thinking option"
                    hint="Enter an option ID or leave empty for the provider default"
                    value={form.thinkingOptionId}
                    onChangeText={setRoutingField(role, "thinkingOptionId")}
                    placeholder="Thinking option ID"
                    disabled={disabled}
                  />
                ) : thinking.options.length > 0 || form.thinkingOptionId !== "" ? (
                  <View style={styles.field}>
                    <Text style={[styles.fieldLabel, { color: colors.foregroundMuted }]}>Thinking option</Text>
                    <ChipSelect
                      colors={colors}
                      value={form.thinkingOptionId}
                      options={[
                        {
                          label: thinking.defaultId
                            ? `Provider default (${thinking.defaultId})`
                            : "Provider default",
                          value: "",
                        },
                        ...thinking.options.map(option => ({
                          label: option.id === thinking.defaultId || option.isDefault
                            ? `${option.label} (default)`
                            : option.label,
                          value: option.id,
                        })),
                        // Same escape hatch as the mode picker: a stored
                        // option the model doesn't declare stays visible and
                        // clearable, marked "(stored)" so it reads as
                        // leftover rather than a real option.
                        ...(form.thinkingOptionId !== "" &&
                          !thinking.options.some(option => option.id === form.thinkingOptionId)
                          ? [{ label: `${form.thinkingOptionId} (stored)`, value: form.thinkingOptionId }]
                          : []),
                      ]}
                      onChange={setRoutingField(role, "thinkingOptionId")}
                      disabled={disabled}
                    />
                  </View>
                ) : (
                  // Options resolved but the model declares none (devin
                  // bakes thinking into model ids) — no free text to type
                  // garbage into.
                  <View style={styles.field}>
                    <Text style={[styles.fieldLabel, { color: colors.foregroundMuted }]}>Thinking option</Text>
                    <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
                      This model declares no thinking options
                    </Text>
                  </View>
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
              Stored role profiles differ from the live binding — the changes apply at
              the next activation; nothing activates on save. Run
              {` ${activationLabel(statusView)}`} to apply them.
            </Text>
          ) : null}
          {routingSaved && statusView?.binding && !routingDiverged ? (
            <Text style={[styles.mutedSmall, { color: colors.statusSuccess }]}>
              Saved — matches the live binding.
            </Text>
          ) : null}
          {!statusView?.binding ? (
            <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
              Activate first — role profiles are saved against a live binding.
            </Text>
          ) : null}
          <Button
            colors={colors}
            label={routingBusy ? "Saving…" : "Save"}
            disabled={!target || routingBusy || !statusView?.binding || !routingDiffers}
            onPress={() => void saveRouting()}
          />
        </Card>
      ) : null}

      {target ? (
        // The user-scope Peer pool — slp-runtime/state/peer-pool.json, the
        // catalog readCatalog resolves for every repository without its own
        // .paseo-slp/slp-routing.json. This card is its sole writer; it loads
        // with the target (independent of binding, like the Jev card) and a
        // save takes effect the next time a Lead reads `routes`.
        <Card
          colors={colors}
          title="Peer pool"
          subtitle="User-scope seats a Lead picks per task. Supervisor and Lead keep their saved profiles — only Peer routes here."
          // Draft-state badge beside the card title (mockup dirty-badge):
          // amber while edits are unsaved, else the saved/absent state.
          trailing={
            poolDirty ? (
              <Badge colors={colors} label="Unsaved changes" tone="draft" />
            ) : poolData?.pool != null ? (
              <Badge colors={colors} label="Saved pool" tone="good" />
            ) : (
              <Badge colors={colors} label="No saved pool" />
            )
          }
        >
          {jevView?.enabled === true && jevView.capabilities?.routing === true ? (
            <View style={[styles.noticeBox, { borderColor: colors.accent, backgroundColor: colors.surface2 }]}>
              <Text style={[styles.mutedSmall, { color: colors.foreground }]}>
                Jev routing is armed — the seats below are the draft candidate set Jev picks from;
                edits apply only after Save, and a seat marked Token conflict is not a
                valid standard seat.
              </Text>
            </View>
          ) : null}
          {// §7.4.E — the four read states are distinct: still loading, read
           // failed (never painted as an empty list), stored file malformed,
           // and absent. Editing stays locked until a successful snapshot.
          poolData === null ? (
            poolReadError !== null ? (
              <Text style={[styles.mutedSmall, { color: colors.statusDanger }]}>
                Could not read the pool: {poolReadError} — use Reload to retry.
              </Text>
            ) : (
              <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
                Reading the pool…
              </Text>
            )
          ) : poolData.error ? (
            <Text style={[styles.mutedSmall, { color: colors.statusDanger }]}>
              The stored pool failed validation: {poolData.error} — saving replaces it.
            </Text>
          ) : poolData.pool === null ? (
            <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
              No pool yet — add seats below, or import a legacy slp-routing.json.
            </Text>
          ) : null}
          {// Pool summary (mockup finding 7): the saved-state line plus the
           // enabled/disabled/conflicted counts — conflicted is an
           // OVERLAPPING count (a conflicted seat is also enabled or
           // disabled), not a third bucket.
          poolData !== null ? (
            <View style={[styles.field, { borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 12 }]}>
              <View style={[styles.cardHeadRow, { justifyContent: "space-between" }]}>
                <Text style={[styles.checkTitle, { color: colors.foreground }]}>
                  {poolData.pool != null
                    ? `Saved pool · ${poolForm.seats.length} seat${poolForm.seats.length === 1 ? "" : "s"} in draft`
                    : `No saved pool — ${poolForm.seats.length} seat${poolForm.seats.length === 1 ? "" : "s"} in draft`}
                </Text>
              </View>
              <View style={{ flexDirection: "row", gap: 14, flexWrap: "wrap" }}>
                <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
                  <Text style={{ color: colors.foreground, fontWeight: "700" }}>{poolForm.seats.filter(seat => seat.enabled).length}</Text> enabled
                </Text>
                <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
                  <Text style={{ color: colors.foreground, fontWeight: "700" }}>{poolForm.seats.filter(seat => !seat.enabled).length}</Text> disabled
                </Text>
                <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
                  <Text style={{ color: colors.foreground, fontWeight: "700" }}>{conflictedSeats.length}</Text> conflicted
                </Text>
              </View>
            </View>
          ) : null}
          {// §7.4.D card-level conflict notice — pressing a seat opens its
           // editor and scrolls it into view (CAS/open-seat locality).
          conflictedSeats.length > 0 ? (
            <View style={[styles.noticeBox, { borderColor: colors.statusDanger, backgroundColor: colors.surface2 }]} accessibilityLiveRegion="polite">
              <Text style={[styles.checkTitle, { color: colors.statusDanger }]}>
                {conflictedSeats.length === 1 ? "1 seat needs token resolution" : `${conflictedSeats.length} seats need token resolution`}
              </Text>
              <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
                These seats carry a reserved standard id but diverging tokens — resolve each before Save or Copy.
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {conflictedSeats.map(entry => (
                  <Button
                    key={entry.index}
                    colors={colors}
                    label={`Open seat ${poolForm.seats[entry.index]?.id ?? ""}`}
                    onPress={() => {
                      setOpenSeat(entry.index);
                      setTimeout(() => scrollFocusNode(seatRowRefs.current.get(entry.index), true), 50);
                    }}
                  />
                ))}
              </View>
            </View>
          ) : null}
          {// §7.4.D card notice — save/reload failures and the CAS conflict
           // ("The pool changed since the last read; Reload to fetch the new version") live
           // here, with Reload offered right at the message and the
           // dirty-draft confirmation rendered at this control's origin.
          poolError !== null ? (
            <View style={[styles.noticeBox, { borderColor: colors.statusDanger, backgroundColor: colors.surface2 }]} accessibilityLiveRegion="polite">
              <Text style={[styles.checkTitle, { color: colors.statusDanger }]}>
                {poolError.cas ? "Pool version conflict" : "Pool operation failed"}
              </Text>
              <Text style={[styles.mutedSmall, { color: colors.statusDanger }]}>{poolError.message}</Text>
              <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>Your draft is preserved.</Text>
              {poolError.cas ? (
                <View>
                  <Button
                    colors={colors}
                    label={poolReloading ? "Reloading…" : "Reload"}
                    onPress={() => requestReload("notice")}
                    disabled={poolBusy}
                  />
                </View>
              ) : null}
              {poolReloadConfirm === "notice" ? (
                <View style={[styles.confirmBox, { borderColor: colors.statusWarning, backgroundColor: colors.surface0 }]} accessibilityRole="alert">
                  <Text style={[styles.checkTitle, { color: colors.foreground }]}>Discard your unsaved changes?</Text>
                  <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
                    Reload replaces this draft only after the saved pool loads successfully.
                  </Text>
                  <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                    <Pressable
                      ref={keepEditsRef}
                      onPress={() => setPoolReloadConfirm(null)}
                      accessibilityRole="button"
                      accessibilityLabel="Keep current edits"
                      style={({ pressed }) => [styles.button, { backgroundColor: colors.accent, borderColor: colors.accent }, pressed && { opacity: 0.75 }]}
                    >
                      <Text style={[styles.buttonLabel, { color: colors.accentForeground }]}>Keep current edits</Text>
                    </Pressable>
                    <Button
                      colors={colors}
                      kind="danger"
                      label="Discard changes and Reload"
                      onPress={() => { setPoolReloadConfirm(null); void reloadPeerPool(); }}
                    />
                  </View>
                </View>
              ) : null}
            </View>
          ) : null}
          {poolData?.legacy && !canImportLegacy ? (
            <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
              A legacy catalog exists at ~/.paseo/slp-routing.json — import is
              available while this pool is empty and unedited.
            </Text>
          ) : null}
          {canImportLegacy ? (
            <View style={[styles.roleBox, { borderColor: colors.border }]}>
              <Text style={[styles.mutedSmall, { color: colors.foreground }]}>
                A legacy catalog exists at ~/.paseo/slp-routing.json — import it once
                to populate this pool. The file is only read, never removed.
              </Text>
              <Button
                colors={colors}
                label="Import legacy catalog"
                onPress={importLegacyPool}
                disabled={poolBusy}
              />
            </View>
          ) : null}
          {poolData?.legacyError ? (
            <Text style={[styles.mutedSmall, { color: colors.statusWarning }]}>
              ~/.paseo/slp-routing.json exists but is not a valid pool: {poolData.legacyError}
            </Text>
          ) : null}
          <Field
            colors={colors}
            label="Pool policy"
            hint="Who maintains this pool and the budget boundary — shown to the Lead"
            value={poolForm.policy}
            onChangeText={text => updatePool(form => ({ ...form, policy: text }))}
            placeholder="Human maintains model suitability and quota…"
            disabled={poolLocked}
            multiline
          />
          {poolForm.seats.length > 0 ? (
            <View style={[styles.cardHeadRow, { justifyContent: "space-between" }]}>
              <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Seats · draft order</Text>
              <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>Enable only when configured</Text>
            </View>
          ) : null}
          {poolForm.seats.map((seat, index) => {
            const seatCatalog = seat.family !== "" ? catalogs[seat.family] : undefined;
            const thinking = seat.family !== "" ? thinkingOptionsFor(seatCatalog, seat.model) : null;
            const featureDefs = featureDefsForSeat(seat);
            const open = openSeat === index;
            const disabled = poolLocked;
            // §7.2 management is by exact id; the draft row's conflict state
            // is computed against the package token set (unordered compare).
            const managed = seatManagement(seat) === "package-managed";
            const conflict = managed ? formSeatConflict(seat) : null;
            const standardTokens = managed ? STANDARD_SEAT_TOKENS[seat.id.trim()] : undefined;
            // Parked semantics (mockup finding 6): the row states the draft
            // lifecycle explicitly — enabled is a deliberate switch, never
            // inferred from a filled binding.
            const seatState = seat.enabled
              ? "Enabled in draft"
              : seat.family !== "" && seat.model.trim() !== ""
                ? "Disabled · configured"
                : "Disabled · needs provider/model";
            // One token row: the exact token text, its axis in muted parens,
            // an optional +/− conflict mark, and a press that opens the
            // definition lookup at that token.
            const tokenRows = (tokens: string[], mark: (token: string) => "+" | "−" | null = () => null) =>
              tokens.length === 0 ? (
                <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>No declarations</Text>
              ) : (
                // .token style — underlined mono buttons named "Define X";
                // a press opens the lookup at exactly this definition and
                // scrolls it into view (mockup findings 9–10).
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  {tokens.map((token, tokenIndex) => {
                    const marked = mark(token);
                    const def = tokenDefinition(token);
                    return (
                      <Pressable
                        key={`${tokenIndex}:${token}`}
                        onPress={() => {
                          setTokenLookupSeat(index);
                          setTokenLookupToken(token);
                          setTimeout(() => scrollFocusNode(
                            definitionRefs.current.get(index) ?? lookupRefs.current.get(index),
                            true,
                          ), 50);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`Define ${token}`}
                      >
                        <Text style={[styles.tokenText, {
                          color: marked === "−" ? colors.statusDanger
                            : marked === "+" ? colors.statusSuccess
                            : colors.accent,
                        }]}>
                          {marked !== null ? `${marked} ` : ""}{token}
                          <Text style={{ color: colors.foregroundMuted, textDecorationLine: "none" }}>
                            {def ? ` (${def.axis})` : " (custom)"}
                          </Text>
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              );
            return (
              // key is the stable draft uid — editing `id` must not remount
              // the row (mockup finding 2: typing in the Custom ID field
              // preserved the focused input node).
              <View
                key={seat.uid}
                ref={node => { seatRowRefs.current.set(index, node); }}
                style={[styles.roleBox, { borderColor: conflict ? colors.statusDanger : colors.border }]}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Pressable
                    onPress={() => setSeatEnabled(index)(!seat.enabled)}
                    disabled={disabled}
                    accessibilityRole="switch"
                    accessibilityLabel={`Enable ${seat.id || "unnamed seat"} in draft`}
                    accessibilityState={{ checked: seat.enabled, disabled }}
                    style={[styles.switchTrack, { backgroundColor: seat.enabled ? colors.accent : colors.border }]}
                  >
                    <View style={[
                      styles.switchThumb,
                      { backgroundColor: seat.enabled ? colors.accentForeground : colors.foregroundMuted },
                      seat.enabled ? styles.switchThumbOn : styles.switchThumbOff,
                    ]} />
                  </Pressable>
                  <Pressable
                    onPress={() => setOpenSeat(open ? null : index)}
                    accessibilityRole="button"
                    accessibilityLabel={`${open ? "Close" : "Open"} editor for ${seat.id || "unnamed seat"}`}
                    accessibilityState={{ expanded: open }}
                    style={{ flex: 1, gap: 2 }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <Text style={[styles.roleTitle, styles.mono, { color: colors.foreground }]} numberOfLines={1}>
                        {seat.id || "(unnamed seat)"}
                      </Text>
                      <Badge colors={colors} label={managed ? "Package-managed" : "Custom"} tone={managed ? "managed" : "neutral"} />
                      {conflict ? <Badge colors={colors} label="Token conflict" tone="bad" /> : null}
                    </View>
                    <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]} numberOfLines={1}>
                      {(seat.family === "" ? "No provider" : FAMILY_LABEL[seat.family]) +
                        (seat.model ? ` · ${seat.model}` : " · No model") +
                        (seat.modeId ? ` · ${seat.modeId}` : "")}
                    </Text>
                    <Text
                      style={[styles.seatState, { color: seat.enabled ? colors.accent : colors.foregroundMuted }]}
                      numberOfLines={1}
                    >
                      {seatState}
                    </Text>
                  </Pressable>
                  <Button
                    colors={colors}
                    label={open ? "Close" : "Edit"}
                    onPress={() => setOpenSeat(open ? null : index)}
                    disabled={disabled}
                  />
                </View>
                {open ? (
                  <>
                    {!seat.enabled ? (
                      // Parked flow hint (mockup finding 6): the editor
                      // states the enable path before the fields.
                      <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
                        Choose provider/model → enable → Save pool
                      </Text>
                    ) : null}
                    {managed ? (
                      // §7.4.B — a standard seat's id IS the package
                      // reference; renaming it is how a reserved name would
                      // be stolen, so the id is display-only.
                      <View style={styles.field}>
                        <Text style={[styles.fieldLabel, { color: colors.foregroundMuted }]}>Seat ID</Text>
                        <Text style={[styles.mutedSmall, { color: colors.foreground }]}>{seat.id}</Text>
                        <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
                          Reserved standard-seat id — package-managed; "Create a custom copy" below copies it into an editable Custom seat.
                        </Text>
                      </View>
                    ) : (
                      <>
                        <Field
                          colors={colors}
                          label="Seat ID"
                          hint="Lowercase letters, digits, dashes — the Lead quotes this id in a launch request. Reserved standard-seat ids are refused."
                          value={seat.id}
                          onChangeText={setSeatId(index)}
                          placeholder="peer-coding"
                          disabled={disabled}
                        />
                        {(() => {
                          const idError = customSeatIdError(
                            seat.id,
                            poolForm.seats.filter((_, i) => i !== index).map(other => other.id.trim()),
                          );
                          return idError !== null ? (
                            <Text style={[styles.mutedSmall, { color: colors.statusDanger }]}>{idError}</Text>
                          ) : null;
                        })()}
                      </>
                    )}
                    <View style={styles.field}>
                      <Text style={[styles.fieldLabel, { color: colors.foregroundMuted }]}>Provider family</Text>
                      <ChipSelect
                        colors={colors}
                        value={seat.family}
                        options={[
                          { label: "Unset", value: "" as const },
                          ...FAMILY_PICKER_ORDER
                            .filter(entry => availableFamilies.includes(entry))
                            .map(entry => ({ label: FAMILY_LABEL[entry], value: entry })),
                          // A stored family the host no longer reports as
                          // available stays visible — the same escape hatch
                          // the mode/thinking pickers give stored values.
                          ...(seat.family !== "" && !availableFamilies.includes(seat.family)
                            ? [{ label: `${FAMILY_LABEL[seat.family]} (unavailable)`, value: seat.family }]
                            : []),
                        ]}
                        onChange={setSeatFamily(index)}
                        disabled={disabled}
                      />
                      {availableFamilies.length === 0 ? (
                        <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
                          Inspect the daemon first — only families reported available are offered.
                        </Text>
                      ) : null}
                    </View>
                    {seat.family !== "" && catalogLoadingFor === seat.family ? (
                      <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
                        Loading {FAMILY_LABEL[seat.family]} catalog…
                      </Text>
                    ) : null}
                    {seatCatalog?.error ? (
                      <>
                        <Text style={[styles.mutedSmall, { color: colors.statusWarning }]}>
                          Catalog unavailable: {seatCatalog.error} — enter values manually.
                        </Text>
                        <Button
                          colors={colors}
                          label="Retry catalog"
                          onPress={() => void retryCatalog(seat.family as FamilyName)}
                          disabled={disabled || catalogLoadingFor === seat.family}
                        />
                      </>
                    ) : null}
                    {seatCatalog && seatCatalog.models.length > 0 ? (
                      <OptionPicker
                        colors={colors}
                        label="Model"
                        hint="Required on an enabled seat"
                        options={seatCatalog.models}
                        value={seat.model}
                        onChange={setSeatField(index, "model")}
                        disabled={disabled}
                        placeholder="Filter models…"
                      />
                    ) : (
                      <Field
                        colors={colors}
                        label="Model"
                        hint="Required on an enabled seat"
                        value={seat.model}
                        onChangeText={setSeatField(index, "model")}
                        placeholder="Model ID — e.g. swe-2-max"
                        disabled={disabled}
                      />
                    )}
                    {managed ? (
                      // §7.4.B — Mode and Features are the package's binding
                      // shape for a standard seat; shown as a read-only
                      // summary so a draft can't silently diverge.
                      <View style={styles.field}>
                        <Text style={[styles.fieldLabel, { color: colors.foregroundMuted }]}>Mode</Text>
                        <Text style={[styles.mutedSmall, { color: colors.foreground }]}>
                          {seat.modeId !== "" ? seat.modeId : "Provider/host default"}
                        </Text>
                        <Text style={[styles.fieldLabel, { color: colors.foregroundMuted }]}>Feature values</Text>
                        <Text style={[styles.mutedSmall, { color: colors.foreground }]}>
                          {seat.features.trim() !== ""
                            ? seat.features
                            : Object.keys(seat.feature).some(featureId => seat.feature[featureId] !== "")
                              ? JSON.stringify(seat.feature)
                              : "Provider/host default"}
                        </Text>
                      </View>
                    ) : seatCatalog && seatCatalog.modes.length > 0 ? (
                      <View style={styles.field}>
                        <Text style={[styles.fieldLabel, { color: colors.foregroundMuted }]}>Mode</Text>
                        <ChipSelect
                          colors={colors}
                          value={seat.modeId}
                          options={[
                            { label: "Provider default", value: "" },
                            ...seatCatalog.modes.map(mode => ({ label: mode.label, value: mode.id })),
                            // A stored mode the catalog doesn't list stays visible.
                            ...(seat.modeId !== "" && !seatCatalog.modes.some(mode => mode.id === seat.modeId)
                              ? [{ label: seat.modeId, value: seat.modeId }]
                              : []),
                          ]}
                          onChange={setSeatField(index, "modeId")}
                          disabled={disabled}
                        />
                      </View>
                    ) : (
                      <Field
                        colors={colors}
                        label="Mode"
                        value={seat.modeId}
                        onChangeText={setSeatField(index, "modeId")}
                        placeholder="Mode ID — e.g. bypass"
                        disabled={disabled}
                      />
                    )}
                    {managed ? null : featureDefs.loading ? (
                      <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>Loading features…</Text>
                    ) : null}
                    {managed ? null : featureDefs.defs.length > 0 ? (
                      featureDefs.defs.map(def => (
                        def.type === "toggle" ? (
                          <SwitchRow
                            key={def.id}
                            colors={colors}
                            checked={(seat.feature[def.id] ?? "") === "" ? def.value : seat.feature[def.id] === "true"}
                            onToggle={next => setSeatFeature(index, def.id)(String(next))}
                            title={def.label}
                            hint={def.description}
                            disabled={disabled}
                          />
                        ) : (
                          <View key={def.id} style={styles.field}>
                            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>{def.label}</Text>
                            <ChipSelect
                              colors={colors}
                              value={seat.feature[def.id] ?? ""}
                              options={[
                                { label: "Provider default", value: "" },
                                ...def.options.map(option => ({ label: option.label, value: option.id })),
                              ]}
                              onChange={setSeatFeature(index, def.id)}
                              disabled={disabled}
                            />
                            {def.description ? (
                              <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>{def.description}</Text>
                            ) : null}
                          </View>
                        )
                      ))
                    ) : (
                      <>
                        <Field
                          colors={colors}
                          label="Feature values (JSON)"
                          hint='Provider feature flags — e.g. {"auto_accept": true}'
                          value={seat.features}
                          onChangeText={setSeatField(index, "features")}
                          placeholder="{}"
                          disabled={disabled}
                        />
                        {featureDefs.error ? (
                          <>
                            <Text style={[styles.mutedSmall, { color: colors.statusWarning }]}>
                              Feature controls unavailable: {featureDefs.error} — edit JSON or retry.
                            </Text>
                            <Button
                              colors={colors}
                              label="Retry feature controls"
                              onPress={() => {
                                if (featureDefs.key) void retryFeatureSet(featureDefs.key);
                              }}
                              disabled={disabled || featureDefs.loading}
                            />
                          </>
                        ) : null}
                      </>
                    )}
                    {thinking === null ? (
                      // No catalog / no picked model / model not listed — the
                      // established free-text degradation path.
                      <Field
                        colors={colors}
                        label="Thinking option"
                        hint="Enter an option ID or leave empty for the provider default"
                        value={seat.thinkingOptionId}
                        onChangeText={setSeatField(index, "thinkingOptionId")}
                        placeholder="Thinking option ID"
                        disabled={disabled}
                      />
                    ) : thinking.options.length > 0 || seat.thinkingOptionId !== "" ? (
                      <View style={styles.field}>
                        <Text style={[styles.fieldLabel, { color: colors.foregroundMuted }]}>Thinking option</Text>
                        <ChipSelect
                          colors={colors}
                          value={seat.thinkingOptionId}
                          options={[
                            {
                              label: thinking.defaultId
                                ? `Provider default (${thinking.defaultId})`
                                : "Provider default",
                              value: "",
                            },
                            ...thinking.options.map(option => ({
                              label: option.id === thinking.defaultId || option.isDefault
                                ? `${option.label} (default)`
                                : option.label,
                              value: option.id,
                            })),
                            // Same escape hatch as the mode picker: a stored
                            // option the model doesn't declare stays visible and
                            // clearable, marked "(stored)" so it reads as
                            // leftover rather than a real option.
                            ...(seat.thinkingOptionId !== "" &&
                              !thinking.options.some(option => option.id === seat.thinkingOptionId)
                              ? [{ label: `${seat.thinkingOptionId} (stored)`, value: seat.thinkingOptionId }]
                              : []),
                          ]}
                          onChange={setSeatField(index, "thinkingOptionId")}
                          disabled={disabled}
                        />
                      </View>
                    ) : (
                      // Options resolved but the model declares none (devin
                      // bakes thinking into model ids) — no free text to type
                      // garbage into.
                      <View style={styles.field}>
                        <Text style={[styles.fieldLabel, { color: colors.foregroundMuted }]}>Thinking option</Text>
                        <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
                          Not applicable — the model declares no thinking option
                        </Text>
                      </View>
                    )}
                    <View style={styles.field}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Text style={[styles.fieldLabel, { color: colors.foreground, flex: 1 }]}>
                          Task suitability — sent to Jev
                        </Text>
                        <Button
                          colors={colors}
                          label={tokenLookupSeat === index ? "Hide token definitions" : "Show token definitions"}
                          onPress={() => {
                            const opening = tokenLookupSeat !== index;
                            setTokenLookupSeat(opening ? index : null);
                            setTokenLookupToken(null);
                            if (opening) setTimeout(() => scrollFocusNode(lookupRefs.current.get(index)), 50);
                          }}
                        />
                      </View>
                      {managed ? (
                        // §7.4.B "Record at Avoid" — advisory, not a runtime
                        // prohibition; shown once for both avoid lists,
                        // conflict view included.
                        <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
                          avoidFor is advisory only — it does not block a runtime permission.
                        </Text>
                      ) : null}
                      {conflict && standardTokens ? (
                        // §7.4.D — both versions at exact values; the stored
                        // side marks tokens the standard set would drop (−),
                        // the standard side marks what it would add (+).
                        <View style={[styles.roleBox, { borderColor: colors.statusDanger }]}>
                          <Text style={[styles.mutedSmall, { color: colors.statusDanger }]}>
                            Token conflict — this seat carries a reserved standard id but
                            its stored tokens diverge from the package set. It cannot be
                            routed or saved until resolved.
                          </Text>
                          <Text style={[styles.fieldLabel, { color: colors.foregroundMuted }]}>
                            Currently stored/imported content
                          </Text>
                          <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>suitableFor</Text>
                          {tokenRows(lineList(seat.suitableFor), token =>
                            standardTokens.suitableFor.includes(token) ? null : "−")}
                          <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>avoidFor</Text>
                          {tokenRows(lineList(seat.avoidFor), token =>
                            standardTokens.avoidFor.includes(token) ? null : "−")}
                          <Text style={[styles.fieldLabel, { color: colors.foregroundMuted }]}>
                            The package's standard set
                          </Text>
                          <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>suitableFor</Text>
                          {tokenRows([...standardTokens.suitableFor], token =>
                            lineList(seat.suitableFor).includes(token) ? null : "+")}
                          <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>avoidFor</Text>
                          {tokenRows([...standardTokens.avoidFor], token =>
                            lineList(seat.avoidFor).includes(token) ? null : "+")}
                          {// Added/Removed summary across BOTH lists (mockup
                           // finding 9): the marks above are per-token; this
                           // line states the net difference in one read.
                          }
                          <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
                            {(() => {
                              const added = ["suitableFor", "avoidFor"].flatMap(k =>
                                standardTokens[k as "suitableFor" | "avoidFor"]
                                  .filter(t => !lineList(seat[k as "suitableFor" | "avoidFor"]).includes(t))
                                  .map(t => `${k}: ${t}`));
                              const removed = ["suitableFor", "avoidFor"].flatMap(k =>
                                lineList(seat[k as "suitableFor" | "avoidFor"])
                                  .filter(t => !standardTokens[k as "suitableFor" | "avoidFor"].includes(t))
                                  .map(t => `${k}: ${t}`));
                              return `Added: ${added.join(", ") || "none"} · Removed: ${removed.join(", ") || "none"}`;
                            })()}
                          </Text>
                          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                            <Button
                              colors={colors}
                              label="Apply the standard set"
                              onPress={applyStandardTokens(index)}
                              disabled={disabled}
                            />
                            <Button
                              colors={colors}
                              label="Convert this seat to a custom seat"
                              onPress={openConvertToCustom(index)}
                              disabled={disabled}
                            />
                          </View>
                        </View>
                      ) : managed ? (
                        // §7.4.B — a standard seat's two token lists are the
                        // package's exact values, read-only; pressing a token
                        // opens its definition.
                        <>
                          <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>suitableFor</Text>
                          {tokenRows(lineList(seat.suitableFor))}
                          <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>avoidFor</Text>
                          {tokenRows(lineList(seat.avoidFor))}
                        </>
                      ) : (
                        // Custom seats keep free-form strings — the seat's
                        // own semantics; they receive no package updates.
                        <>
                          <Field
                            colors={colors}
                            label="Suitable for"
                            hint="One per line — task shapes this seat handles. Standard seats use the closed axis:value vocabulary; see Token definitions."
                            value={seat.suitableFor}
                            onChangeText={setSeatField(index, "suitableFor")}
                            placeholder={"work:change\ndomain:software"}
                            disabled={disabled}
                            multiline
                          />
                          <Field
                            colors={colors}
                            label="Avoid for"
                            hint="One per line — advisory warning only; it does not block a runtime permission"
                            value={seat.avoidFor}
                            onChangeText={setSeatField(index, "avoidFor")}
                            placeholder={"work:design\nflow:staged"}
                            disabled={disabled}
                            multiline
                          />
                          {// §7.4.F — entered strings are pressable: a
                           // standard token opens its packaged definition, a
                           // free/legacy string resolves to "custom content"
                           // instead of borrowing a near-match's meaning.
                          lineList(seat.suitableFor).length + lineList(seat.avoidFor).length > 0 ? (
                            <>
                              <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
                                Press an entered string to look it up:
                              </Text>
                              {tokenRows(lineList(seat.suitableFor))}
                              {tokenRows(lineList(seat.avoidFor))}
                            </>
                          ) : null}
                        </>
                      )}
                    </View>
                    {standardAppliedId === seat.id.trim() && !conflict ? (
                      <Text style={[styles.mutedSmall, { color: colors.statusWarning }]}>
                        Standard set selected — not yet saved
                      </Text>
                    ) : null}
                    {convertSeatIndex === index ? (
                      // §7.4.D convert-to-custom: id input + reserved-name
                      // error + the quotaFallback remap the one Save will
                      // carry, and the custom-seat caveat.
                      <View style={[styles.roleBox, { borderColor: colors.border }]}>
                        <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
                          Convert "{seat.id}" to a custom seat
                        </Text>
                        <Field
                          colors={colors}
                          label="Custom seat ID"
                          value={convertId}
                          onChangeText={setConvertId}
                          placeholder={`${seat.id}-2`}
                          disabled={disabled}
                        />
                        {(() => {
                          const idError = customSeatIdError(
                            convertId,
                            poolForm.seats.filter((_, i) => i !== index).map(other => other.id.trim()),
                          );
                          const remapped = poolForm.quotaFallbackId === seat.id;
                          return (
                            <>
                              {idError !== null ? (
                                <Text style={[styles.mutedSmall, { color: colors.statusDanger }]}>{idError}</Text>
                              ) : null}
                              <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
                                {remapped
                                  ? `quotaFallback will be retargeted in this draft: ${seat.id.trim()} → ${convertId.trim() || "?"}`
                                  : "No quotaFallback designation to retarget."}
                              </Text>
                              <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
                                Custom seats do not receive package token updates; references
                                outside the pool must be updated separately.
                              </Text>
                              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                                <Button
                                  colors={colors}
                                  label="Apply to draft"
                                  onPress={applyConvertToCustom}
                                  disabled={disabled || idError !== null}
                                />
                                <Button
                                  colors={colors}
                                  label="Cancel"
                                  onPress={() => { setConvertSeatIndex(null); setConvertId(""); }}
                                />
                              </View>
                            </>
                          );
                        })()}
                      </View>
                    ) : null}
                    {tokenLookupSeat === index ? (
                      // §7.4.F — the package's token lookup: how-to-read, the
                      // four axes as pickers, then the selected token's full
                      // definition (or "custom content" for non-package text).
                      <View
                        ref={node => { lookupRefs.current.set(index, node); }}
                        role="region"
                        accessibilityLabel="Token definitions"
                        style={[styles.noticeBox, { borderColor: colors.accent, backgroundColor: colors.surface2 }]}
                      >
                        <View style={[styles.cardHeadRow, { justifyContent: "space-between" }]}>
                          <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Token definitions</Text>
                          <Button
                            colors={colors}
                            label="Close definitions"
                            onPress={() => { setTokenLookupSeat(null); setTokenLookupToken(null); }}
                          />
                        </View>
                        <Text style={[styles.fieldLabel, { color: colors.foregroundMuted }]}>How to read</Text>
                        {HOW_TO_READ.map(line => (
                          <Text key={line} style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
                            {line}
                          </Text>
                        ))}
                        {SUITABILITY_AXES.map(axis => (
                          <View key={axis.id} style={{ gap: 2 }}>
                            <Text style={[styles.fieldLabel, { color: colors.foregroundMuted }]}>
                              {axis.id} — {axis.question}
                            </Text>
                            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                              {SUITABILITY_TOKENS.filter(token => token.axis === axis.id).map(token => (
                                <Pressable
                                  key={token.id}
                                  onPress={() => {
                                    setTokenLookupToken(token.id);
                                    setTimeout(() => scrollFocusNode(definitionRefs.current.get(index), true), 50);
                                  }}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Define ${token.id}`}
                                  style={[styles.chip, tokenLookupToken === token.id && { borderColor: colors.accent }]}
                                >
                                  <Text style={[styles.chipLabel, styles.mono, { color: colors.foreground }]}>{token.id}</Text>
                                </Pressable>
                              ))}
                            </View>
                          </View>
                        ))}
                        {tokenLookupToken !== null ? (() => {
                          const def = tokenDefinition(tokenLookupToken);
                          return (
                            <View
                              ref={node => { definitionRefs.current.set(index, node); }}
                              role="region"
                              accessibilityLabel={`Definition of ${tokenLookupToken}`}
                              style={[styles.noticeBox, { borderColor: colors.border, backgroundColor: colors.surface0, gap: 2 }]}
                            >
                              <Text style={[styles.checkTitle, styles.mono, { color: colors.foreground }]}>{tokenLookupToken}</Text>
                              {def ? (
                                <>
                                  <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
                                    {def.axis} — {SUITABILITY_AXES.find(axis => axis.id === def.axis)?.question}
                                  </Text>
                                  <Text style={[styles.mutedSmall, { color: colors.foreground }]}>{def.sign}</Text>
                                  <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
                                    Example: {def.example}
                                  </Text>
                                  <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
                                    Counter-example: {def.counterExample}
                                  </Text>
                                  <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
                                    Boundary: {def.boundary}
                                  </Text>
                                </>
                              ) : (
                                // A custom string is lookupable too — its
                                // "definition" states the package carries no
                                // meaning for it (mockup finding 9).
                                <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
                                  Custom content — the package does not define this token.
                                </Text>
                              )}
                            </View>
                          );
                        })() : null}
                      </View>
                    ) : null}
                    <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
                      Local only — Jev never sees this
                    </Text>
                    {managed ? (
                      <View style={styles.field}>
                        <Text style={[styles.fieldLabel, { color: colors.foregroundMuted }]}>Notes</Text>
                        <Text style={[styles.mutedSmall, { color: colors.foreground }]}>
                          {seat.notes !== "" ? seat.notes : "—"}
                        </Text>
                        <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
                          Package-provided — read-only.
                        </Text>
                      </View>
                    ) : (
                      <Field
                        colors={colors}
                        label="Notes"
                        hint="Why this seat exists, in the working language — required"
                        value={seat.notes}
                        onChangeText={setSeatField(index, "notes")}
                        placeholder="Cost, quota, and judgment notes for the Lead"
                        disabled={disabled}
                        multiline
                      />
                    )}
                    <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                      <Button
                        colors={colors}
                        kind="danger"
                        label="Remove seat"
                        onPress={removeSeat(index)}
                        disabled={disabled}
                      />
                      {managed ? (
                        <>
                          <Button
                            colors={colors}
                            label="Create a custom copy"
                            onPress={copySeatAsCustom(index)}
                            disabled={disabled}
                          />
                          {!conflict ? (
                            // §7.4.D — a non-conflicting standard seat can
                            // voluntarily leave management here; a conflicted
                            // one gets the same action inside its conflict
                            // section above.
                            <Button
                              colors={colors}
                              label="Convert this seat to a custom seat"
                              onPress={openConvertToCustom(index)}
                              disabled={disabled}
                            />
                          ) : null}
                        </>
                      ) : null}
                    </View>
                  </>
                ) : null}
              </View>
            );
          })}
          {addSeatOpen ? (
            // §7.4.C picker (mockup finding 5): Close at the top, a
            // name/description filter over the twelve canonical archetypes,
            // compact rows, and notes/custom creation expanded per row.
            <View
              style={[styles.noticeBox, { borderColor: colors.accent, backgroundColor: colors.surface0 }]}
              role="region"
              accessibilityLabel="Standard seat picker"
            >
              <View style={[styles.cardHeadRow, { justifyContent: "space-between" }]}>
                <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Add a standard seat</Text>
                <Button colors={colors} label="Close" onPress={() => setAddSeatOpen(false)} />
              </View>
              <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
                Twelve package templates. New seats start disabled with no provider or model;
                "Create a custom seat from template" copies a template into an editable Custom seat.
              </Text>
              <Field
                colors={colors}
                label="Filter by name or description"
                value={pickerQuery}
                onChangeText={setPickerQuery}
                placeholder="Search 12 archetypes…"
                disabled={poolLocked}
              />
              <ScrollView style={{ maxHeight: 385 }} nestedScrollEnabled>
                {PEER_SEAT_ARCHETYPES
                  .filter(archetype =>
                    `${archetype.id} ${archetype.notes}`
                      .toLowerCase()
                      .includes(pickerQuery.trim().toLowerCase()))
                  .map(archetype => (
                    <SeatTemplateRow
                      key={archetype.id}
                      colors={colors}
                      archetype={archetype}
                      exists={poolForm.seats.some(seat => seat.id.trim() === archetype.id)}
                      onAdd={addStandardSeat(archetype)}
                      onCustom={addCustomFromTemplate(archetype)}
                      disabled={poolLocked}
                    />
                  ))}
                {PEER_SEAT_ARCHETYPES.every(archetype =>
                  !`${archetype.id} ${archetype.notes}`
                    .toLowerCase()
                    .includes(pickerQuery.trim().toLowerCase())) ? (
                  <Text style={[styles.mutedSmall, { color: colors.foregroundMuted, paddingVertical: 8 }]} accessibilityLiveRegion="polite">
                    No templates match this filter.
                  </Text>
                ) : null}
              </ScrollView>
            </View>
          ) : (
            <Button
              colors={colors}
              kind="primary"
              label="Add a standard seat"
              onPress={() => { setPickerQuery(""); setAddSeatOpen(true); }}
              disabled={poolLocked}
            />
          )}
          {// §7.4.C quota fallback — the wave-6 contract: ONE designated
           // option, one retry, no ordering. The mockup's multi-select +
           // order numbers predate wave 6 and are deliberately not ported.
          }
          <View style={styles.field}>
            <SwitchRow
              colors={colors}
              checked={poolForm.quotaFallbackEnabled}
              onToggle={next => updatePool(form => ({ ...form, quotaFallbackEnabled: next }))}
              title="Quota fallback"
              hint="Designate one pool seat. On a quota error the Lead retries once on that seat — a repeated quota error or an unavailable target reports BLOCKED; no retry loop."
              disabled={poolLocked}
            />
            {poolForm.quotaFallbackEnabled ? (
              poolForm.seats.length === 0 ? (
                <Text style={[styles.mutedSmall, { color: colors.statusWarning }]}>
                  Add seats before designating a fallback option.
                </Text>
              ) : (
                <>
                  <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
                    Designated fallback seat:
                  </Text>
                  <ChipSelect<string>
                    colors={colors}
                    value={poolForm.quotaFallbackId}
                    options={poolForm.seats.map(seat => ({ label: seat.id || "(unnamed seat)", value: seat.id }))}
                    onChange={setFallbackId}
                    disabled={poolLocked}
                  />
                  <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
                    Retry exactly once on the designated seat — the source seat and a
                    target sharing the exhausted quota are not viable fallbacks.
                  </Text>
                </>
              )
            ) : null}
          </View>
          {"error" in poolBuild ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Text style={[styles.mutedSmall, { color: colors.statusDanger, flex: 1 }]}>{poolBuild.error}</Text>
              {poolBuild.seatIndex != null ? (
                <Button
                  colors={colors}
                  label={`Open seat ${poolForm.seats[poolBuild.seatIndex]?.id ?? ""}`}
                  onPress={() => setOpenSeat(poolBuild.seatIndex ?? null)}
                />
              ) : null}
            </View>
          ) : null}
          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              <Button
                colors={colors}
                label={poolCopied ? "Copied" : "Copy pool JSON"}
                onPress={() => void copyPoolJson()}
                disabled={poolBusy || "error" in poolBuild}
              />
            </View>
            <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
              Copies this pool as a catalog document. Pasting it into a repository's
              .paseo-slp/slp-routing.json makes that repository ignore this pool
              permanently — even if the pool is emptied later. The supported way to
              pin a repository pool is `slp init &lt;repo&gt; --routing-from &lt;file&gt; --apply`.
            </Text>
          </View>
          {poolSaved && !poolDirty ? (
            <Text style={[styles.mutedSmall, { color: colors.statusSuccess }]}>
              Saved — any route a Lead already read is now stale: the recorded catalog
              hash no longer matches, so the next prepare fails closed until `routes`
              is re-read.
            </Text>
          ) : null}
          <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, gap: 8 }}>
            <View style={[styles.cardHeadRow, { justifyContent: "space-between" }]}>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                <Button
                  colors={colors}
                  kind="primary"
                  label={poolSaving ? "Saving…" : "Save pool"}
                  // §7.4.C — Save only exists once a read snapshot does; the
                  // button stays clickable on a build error so it can report it,
                  // but sends no RPC in that case.
                  disabled={!target || poolBusy || !poolDiffers || poolData === null}
                  onPress={() => void savePeerPool()}
                />
                <Button
                  colors={colors}
                  label={poolReloading ? "Reloading…" : "Reload"}
                  onPress={() => requestReload("footer")}
                  disabled={poolBusy}
                />
              </View>
              <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>One save for the whole pool</Text>
            </View>
            {poolReloadConfirm === "footer" ? (
              <View style={[styles.confirmBox, { borderColor: colors.statusWarning, backgroundColor: colors.surface0 }]} accessibilityRole="alert">
                <Text style={[styles.checkTitle, { color: colors.foreground }]}>Discard your unsaved changes?</Text>
                <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
                  Reload replaces this draft only after the saved pool loads successfully.
                </Text>
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                  <Pressable
                    ref={keepEditsRef}
                    onPress={() => setPoolReloadConfirm(null)}
                    accessibilityRole="button"
                    accessibilityLabel="Keep current edits"
                    style={({ pressed }) => [styles.button, { backgroundColor: colors.accent, borderColor: colors.accent }, pressed && { opacity: 0.75 }]}
                  >
                    <Text style={[styles.buttonLabel, { color: colors.accentForeground }]}>Keep current edits</Text>
                  </Pressable>
                  <Button
                    colors={colors}
                    kind="danger"
                    label="Discard changes and Reload"
                    onPress={() => { setPoolReloadConfirm(null); void reloadPeerPool(); }}
                  />
                </View>
              </View>
            ) : null}
          </View>
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
            hint="Managed seats use it for reports, handbacks and other team artifacts; direct replies to you mirror your current language."
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

      {target ? (
        // Jev config is per-daemon-home — independent of activation state, so
        // the card shows whenever a target resolves (unlike the binding-bound
        // cards above). Provider kind selects the wire contract (OpenRouter
        // Decisions API vs TypeSafe first-party System One); model/baseUrl
        // default per kind, and toggles save through one set-jev call taking
        // effect at the NEXT preparation — a running session is never
        // mutated. The key is write-only: the card reports hasKey, never the
        // value.
        <Card
          colors={colors}
          title="Jev"
          subtitle="Bounded routing decisions — a Lead runs `slp route-decide` so Jev picks the pool seat from the eligible set, and prepare verifies the receipt offline. All toggles default off; an outage fails closed and disabling restores Lead-judgment routing."
        >
          {// Mockup recovery finding — the three load states are distinct:
           // loading notice, an error branch with Retry, and the loaded
           // settings. A failed load never paints as eternal "loading…".
          jevLoadError !== null ? (
            <View style={[styles.noticeBox, { borderColor: colors.statusDanger, backgroundColor: colors.surface2 }]} accessibilityLiveRegion="polite">
              <Text style={[styles.checkTitle, { color: colors.statusDanger }]}>Could not load Jev settings</Text>
              <Text style={[styles.mutedSmall, { color: colors.statusDanger }]}>{jevLoadError}</Text>
              <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
                Settings and key status are unavailable.
              </Text>
              <View>
                <Button colors={colors} kind="primary" label="Retry" onPress={() => void loadJev(target)} />
              </View>
            </View>
          ) : jevView === null ? (
            <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]} accessibilityLiveRegion="polite">
              Loading Jev settings…
            </Text>
          ) : (
            <>
              {// Saved provider strip — the SAVED provider/model/baseUrl
               // stays visible above the unsaved settings so a dirty draft
               // never looks like the live config (mockup finding 1).
              }
              <View style={[styles.savedProvider, { borderLeftColor: colors.accent, backgroundColor: colors.surface2 }]}>
                <Text style={[styles.eyebrow, { color: colors.foregroundMuted }]}>Saved provider</Text>
                <View style={[styles.cardHeadRow, { justifyContent: "space-between" }]}>
                  <Text style={[styles.checkTitle, { color: colors.foreground }]}>
                    {jevView.provider ? JEV_KIND_LABEL[jevView.provider.kind] : "Not configured"}
                  </Text>
                  {jevView.configured ? (
                    <Badge
                      colors={colors}
                      label={jevView.enabled === true ? "Configured · enabled" : "Configured · disabled"}
                      tone="good"
                    />
                  ) : null}
                </View>
                <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
                  {jevView.provider
                    ? `${jevView.provider.model} · ${jevView.provider.baseUrl} · ${jevView.hasKey
                        ? jevView.keyPermissionsOk === false
                          ? "Key stored — file permissions too open (chmod 600)"
                          : "Key stored"
                        : "No key stored"}`
                    : "No saved settings — Apply writes the first configuration."}
                </Text>
                {jevView.error ? (
                  <Text style={[styles.mutedSmall, { color: colors.statusDanger }]}>config error: {jevView.error}</Text>
                ) : null}
              </View>
              <View style={[styles.cardHeadRow, { justifyContent: "space-between" }]}>
                <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
                  {jevDirty ? "Unsaved settings" : "Settings"}
                </Text>
                {jevDirty ? <Badge colors={colors} label="Apply before key actions" tone="draft" /> : null}
              </View>
              <Text style={[styles.fieldLabel, { color: colors.foregroundMuted }]}>Provider</Text>
              <ChipSelect<"openrouter" | "typesafe">
                colors={colors}
                value={jevKind}
                options={[
                  { label: "OpenRouter", value: "openrouter" },
                  { label: "TypeSafe (first-party)", value: "typesafe" },
                ]}
                disabled={!target || jevBusy}
                onChange={next => {
                  markJevEdited();
                  setJevKind(next);
                  setJevModel(JEV_KIND_DEFAULT[next].model);
                  setJevBaseUrl(JEV_KIND_DEFAULT[next].baseUrl);
                }}
              />
              <View style={styles.field}>
                <Field
                  colors={colors}
                  label="Model"
                  hint={jevKind === "typesafe"
                    ? "Pinned versioned id (jev-<semver>) — aliases like jev-latest are rejected"
                    : "Pinned <owner>/jev-<version> id — aliases like jev-latest are rejected"}
                  value={jevModel}
                  onChangeText={text => { markJevEdited(); setJevModel(text); }}
                  placeholder={JEV_KIND_DEFAULT[jevKind].model}
                  disabled={!target || jevBusy}
                />
                {jevModelError ? (
                  <Text style={[styles.mutedSmall, { color: colors.statusDanger }]} accessibilityLiveRegion="polite">
                    {jevModelError}
                  </Text>
                ) : null}
              </View>
              <View style={styles.field}>
                <Field
                  colors={colors}
                  label={jevBaseUrl.trim() !== "" && jevBaseUrl.trim() !== JEV_KIND_DEFAULT[jevKind].baseUrl
                    ? "Base URL (custom)"
                    : "Base URL"}
                  hint={`POST ${(jevBaseUrl.trim() === "" ? JEV_KIND_DEFAULT[jevKind].baseUrl : jevBaseUrl.trim()).replace(/\/+$/, "")}${jevKind === "typesafe" ? "/v1/systemone" : "/api/alpha/decisions"}${jevKind === "typesafe" ? " — an origin+path prefix mounts a custom endpoint/proxy" : " — bare origin or the documented …/api/v1 prefixed form"}`}
                  value={jevBaseUrl}
                  onChangeText={text => { markJevEdited(); setJevBaseUrl(text); }}
                  placeholder={JEV_KIND_DEFAULT[jevKind].baseUrl}
                  disabled={!target || jevBusy}
                />
                {jevUrlError ? (
                  <Text style={[styles.mutedSmall, { color: colors.statusDanger }]} accessibilityLiveRegion="polite">
                    {jevUrlError}
                  </Text>
                ) : null}
              </View>
              <SwitchRow
                colors={colors}
                checked={jevEnabledOn}
                disabled={!target || jevBusy}
                onToggle={next => { markJevEdited(); setJevEnabledOn(next); }}
                title="Enable Jev"
                hint="Master toggle — off keeps every capability inert without deleting the stored key."
              />
              <SwitchRow
                colors={colors}
                checked={jevRoutingOn}
                disabled={!target || jevBusy || !jevEnabledOn}
                onToggle={next => { markJevEdited(); setJevRoutingOn(next); }}
                title="Routing decisions"
                hint="When armed, prepare requires a Jev decision receipt for catalog routing (run `slp route-decide`); Lead judgment alone no longer suffices."
              />
              {jevSaved && !jevDirty ? (
                <Text style={[styles.mutedSmall, { color: colors.statusSuccess }]} accessibilityLiveRegion="polite">Saved.</Text>
              ) : null}
              <Button
                colors={colors}
                kind="primary"
                label={jevBusy ? "Saving…" : "Apply Jev settings"}
                disabled={!target || jevBusy || !jevDirty}
                onPress={() => void saveJev()}
              />
              <View style={[styles.divider, { borderTopColor: colors.border }]} />
              {// Key & connection actions name the SAVED provider — they
               // operate on the stored config, so a dirty draft locks them
               // until Apply (mockup finding 1).
              }
              <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
                Key & connection · {JEV_KIND_LABEL[jevView.provider?.kind ?? jevKind]}
              </Text>
              {jevDirty ? (
                <View style={[styles.noticeBox, { borderColor: colors.statusWarning, backgroundColor: colors.surface2 }]}>
                  <Text style={[styles.mutedSmall, { color: colors.statusWarning }]}>
                    Apply settings before managing a key or testing — these actions use the saved
                    provider: {JEV_KIND_LABEL[jevView.provider?.kind ?? jevKind]}. Any previous test
                    result is no longer current.
                  </Text>
                </View>
              ) : null}
              <Field
                colors={colors}
                label={`${JEV_KIND_LABEL[jevView.provider?.kind ?? jevKind]} API key`}
                hint={`Stored at slp-runtime/state/${JEV_KIND_DEFAULT[jevView.provider?.kind ?? jevKind].keyFile} (0600) — never shown back; enter a new key to replace it`}
                value={jevKeyInput}
                onChangeText={text => { setJevKeyInput(text); setJevTest(null); }}
                placeholder={JEV_KIND_DEFAULT[jevView.provider?.kind ?? jevKind].keyPlaceholder}
                disabled={!target || jevKeyBusy || jevDirty}
                secure
              />
              {jevKeyInput.trim() !== "" ? (
                <Text style={[styles.mutedSmall, { color: colors.statusWarning }]}>
                  Unsaved key — save it before testing.
                </Text>
              ) : null}
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                <Button
                  colors={colors}
                  label={jevKeyBusy ? "Working…" : `Save ${JEV_KIND_LABEL[jevView.provider?.kind ?? jevKind]} key`}
                  disabled={!target || jevKeyBusy || jevDirty || jevKeyInput.trim() === ""}
                  onPress={() => void saveJevKey(jevKeyInput.trim())}
                />
                <Button
                  colors={colors}
                  label={`Remove ${JEV_KIND_LABEL[jevView.provider?.kind ?? jevKind]} key`}
                  disabled={!target || jevKeyBusy || jevDirty || jevView?.hasKey !== true}
                  onPress={() => void saveJevKey(null)}
                />
                <Button
                  colors={colors}
                  label={jevTestBusy ? "Testing…" : `Test ${JEV_KIND_LABEL[jevView.provider?.kind ?? jevKind]} connection`}
                  disabled={!target || jevTestBusy || jevDirty || jevView?.hasKey !== true || jevKeyInput.trim() !== ""}
                  onPress={() => void runJevTest()}
                />
              </View>
              {jevTest ? (
                <Text style={[styles.mutedSmall, { color: jevTest.ok ? colors.statusSuccess : colors.statusDanger }]} accessibilityLiveRegion="polite">
                  {jevTest.ok ? "Connection OK" : "Connection failed"}{jevTest.detail ? ` — ${jevTest.detail}` : ""}
                </Text>
              ) : null}
            </>
          )}
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
          <ChipSelect<ReconcileAction>
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
