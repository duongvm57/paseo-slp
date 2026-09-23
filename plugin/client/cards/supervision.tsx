// Supervision-card ownership: the card owns the stored route snapshot, the
// editable per-route form, load/save/reload with the raw-file CAS token, and
// the Jev-capability gate readout — the same discipline as the peer-pool
// card (spec docs/spec/supervision-integration.md §Configuration and
// authority). The shell supplies the target, its stale-guard predicates, the
// RPC callers and the shared Jev view.
//
// Mode vocabulary: the UI offers only "off" and "shadow". "notify" is
// schema-valid — a stored route with it loads and displays as notify — but
// notification delivery is unimplemented in this build, so there is no UI
// affordance to select it (spec: "any UI affordance for notification remains
// unimplemented").
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { TargetValue } from "../../shared/contracts.ts";
import {
  SUPERVISION_PENDING_DELAY_DEFAULT_MS,
  SUPERVISION_PENDING_DELAY_MAX_MS,
} from "../../shared/supervision.ts";
import type {
  GetSupervisionRequest,
  GetSupervisionResult,
  SetSupervisionRequest,
  SetSupervisionResult,
  SupervisionMode,
  SupervisionObservation,
  SupervisionRoute,
} from "../../shared/supervision.ts";
import { errorMessage } from "../manager-state.ts";
import type { Colors } from "../ui-kit.tsx";
import { Badge, Button, Card, ChipSelect, Field, styles } from "../ui-kit.tsx";
import type { JevCardState } from "./jev.tsx";

// Editable copy of one route — every field is a string so the draft can hold
// a partially typed row; the build step validates and converts.
type RouteForm = {
  leadAgentId: string;
  leadWorkspaceId: string;
  supervisorAgentId: string; // "" → null
  mode: "off" | "shadow";
  pendingDelayMs: string;
};

const emptyRouteForm = (): RouteForm => ({
  leadAgentId: "",
  leadWorkspaceId: "",
  supervisorAgentId: "",
  mode: "off",
  pendingDelayMs: String(SUPERVISION_PENDING_DELAY_DEFAULT_MS),
});

const formFromRoutes = (routes: SupervisionRoute[]): RouteForm[] =>
  routes.map(route => ({
    leadAgentId: route.leadAgentId,
    leadWorkspaceId: route.leadWorkspaceId,
    supervisorAgentId: route.supervisorAgentId ?? "",
    // A stored "notify" route stays visible and editable, but a draft save
    // can only produce off/shadow — see the header comment.
    mode: route.mode === "notify" ? "shadow" : route.mode,
    pendingDelayMs: String(route.pendingDelayMs),
  }));

const routesFromForm = (form: RouteForm[]): { routes: SupervisionRoute[] } | { error: string } => {
  const seen = new Set<string>();
  const routes: SupervisionRoute[] = [];
  for (const [index, row] of form.entries()) {
    const label = `Route ${index + 1}`;
    const leadAgentId = row.leadAgentId.trim();
    const leadWorkspaceId = row.leadWorkspaceId.trim();
    const supervisorAgentId = row.supervisorAgentId.trim();
    if (leadAgentId === "") return { error: `${label}: Lead agent ID is required` };
    if (leadWorkspaceId === "") return { error: `${label}: Lead workspace ID is required` };
    if (seen.has(leadAgentId)) return { error: `${label}: duplicate Lead agent ID — one route per Lead` };
    seen.add(leadAgentId);
    const pendingDelayMs = Number(row.pendingDelayMs.trim());
    if (!Number.isInteger(pendingDelayMs) || pendingDelayMs < 0 || pendingDelayMs > SUPERVISION_PENDING_DELAY_MAX_MS) {
      return { error: `${label}: pending delay must be an integer 0–${SUPERVISION_PENDING_DELAY_MAX_MS} ms` };
    }
    routes.push({
      leadAgentId,
      leadWorkspaceId,
      supervisorAgentId: supervisorAgentId === "" ? null : supervisorAgentId,
      mode: row.mode,
      pendingDelayMs,
    });
  }
  return { routes };
};

// The gate line the Manager must show (spec: a failed Jev gate "shows a
// reason in the Manager"). Derived from the saved Jev view only — a dirty
// Jev draft does not arm the capability.
const gateStatus = (jevView: JevCardState["view"]): { label: string; tone: "neutral" | "good" | "draft" | "bad" } => {
  if (jevView === null) return { label: "Jev status unread — gate state unknown", tone: "draft" };
  if (jevView.error !== null) return { label: `Jev config broken — supervision stays off (${jevView.error})`, tone: "bad" };
  if (!jevView.configured) return { label: "Jev not configured — supervision stays off", tone: "neutral" };
  if (jevView.enabled !== true) return { label: "Jev disabled — supervision stays off", tone: "neutral" };
  if (jevView.provider === null) return { label: "Jev provider unset — supervision stays off", tone: "draft" };
  if (!jevView.hasKey) return { label: "Jev key missing — supervision stays off", tone: "draft" };
  if (jevView.capabilities?.supervision !== true) {
    return { label: "Jev supervision capability not armed — routes capture nothing", tone: "draft" };
  }
  return { label: "Jev supervision capability armed — explicit routes still required", tone: "good" };
};

// The five spec states on the observation list — Badge tones are limited to
// the existing vocabulary, so the label carries the distinction.
const observationTone = (state: SupervisionObservation["state"]): { label: string; tone: "neutral" | "good" | "draft" | "bad" } => {
  switch (state) {
    case "observed": return { label: "observed", tone: "draft" };
    case "evaluated": return { label: "evaluated", tone: "good" };
    case "unknown": return { label: "unknown", tone: "neutral" };
    case "suspected_drift": return { label: "suspected drift", tone: "bad" };
    // In the vocabulary for forward compat — never emitted by this build.
    case "notification_uncertain": return { label: "notification delivery uncertain", tone: "neutral" };
  }
};

const shortId = (id: string): string => id.length > 13 ? `${id.slice(0, 8)}…` : id;

function ObservationList({ colors, data }: { colors: Colors; data: GetSupervisionResult }) {
  const observations = data.observations;
  const gates = data.gates;
  const diagnostics = data.diagnostics;
  if (observations === null && gates === null) {
    return (
      <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
        No live observer readout — the shadow observer is not running for this home.
      </Text>
    );
  }
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.legend, { color: colors.foregroundMuted }]}>Shadow observations (metadata only)</Text>
      {gates !== null && Object.keys(gates).length > 0 ? (
        <View style={{ gap: 2 }}>
          {Object.entries(gates).map(([leadId, reason]) => (
            <Text key={leadId} style={[styles.mutedSmall, { color: reason === null ? colors.statusSuccess : colors.statusWarning }]}>
              Route {shortId(leadId)}: {reason === null ? "gate green" : `paused — ${reason}`}
            </Text>
          ))}
        </View>
      ) : null}
      {diagnostics !== null && (diagnostics.droppedEvents > 0 || diagnostics.reasons.length > 0) ? (
        <Text style={[styles.mutedSmall, { color: colors.statusWarning }]}>
          Observer diagnostics: {diagnostics.droppedEvents} dropped event(s)
          {diagnostics.reasons.length > 0 ? ` — ${diagnostics.reasons.join(", ")}` : ""}
        </Text>
      ) : null}
      {(observations ?? []).length === 0 ? (
        <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>No cases recorded yet.</Text>
      ) : (
        (observations ?? []).map(entry => {
          const tone = observationTone(entry.state);
          return (
            <View key={entry.fingerprint} style={[styles.noticeBox, { borderColor: colors.border, backgroundColor: colors.surface2 }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Badge colors={colors} label={tone.label} tone={tone.tone} />
                <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
                  peer {shortId(entry.peerId)} · lead {shortId(entry.leadAgentId)} · {entry.updatedAt}
                </Text>
              </View>
              <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
                case {shortId(entry.fingerprint)} · room {entry.counts.roomMessages} / uncertain {entry.counts.uncertainRoomMessages} / reports {entry.counts.reportMessages} / peer-sends {entry.counts.peerSends} · assessments {entry.assessmentsUsed}
              </Text>
              {entry.reason !== null ? (
                <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>reason: {entry.reason}</Text>
              ) : null}
              {entry.visibility.length > 0 ? (
                <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
                  visibility: {entry.visibility.join(", ")}
                </Text>
              ) : null}
              {entry.lastAssessment !== null ? (
                <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
                  last assessment {entry.lastAssessment.model}: brief={entry.lastAssessment.choices.leadBrief} handback={entry.lastAssessment.choices.peerHandback} handling={entry.lastAssessment.choices.leadHandling}
                </Text>
              ) : null}
            </View>
          );
        })
      )}
    </View>
  );
}

export function useSupervisionCard({ target, targetKey, isCurrentKey, callGetSupervision, callSetSupervision, update }: {
  target: TargetValue | null;
  targetKey: string | null;
  isCurrentKey: (key: string) => boolean;
  callGetSupervision: (input: GetSupervisionRequest) => Promise<GetSupervisionResult>;
  callSetSupervision: (input: SetSupervisionRequest) => Promise<SetSupervisionResult>;
  update: (patch: { lastError: string | null }, target: TargetValue) => void;
}) {
  const [data, setData] = useState<GetSupervisionResult | null>(null);
  const [form, setForm] = useState<RouteForm[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [cardError, setCardError] = useState<{ message: string; cas: boolean } | null>(null);

  // Target switch drops the previous home's snapshot, draft and every
  // transient flag — a draft authored against home A must never save into B.
  useEffect(() => {
    setData(null);
    setForm([]);
    setDirty(false);
    setSaving(false);
    setReloading(false);
    setSaved(false);
    setReadError(null);
    setCardError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- targetKey captures target
  }, [targetKey]);

  // Fetch once per target. data === null is ambiguous between "loading" and
  // "the read failed" — readError separates the two so a failed read never
  // paints as an empty route list, and Save requires a successful snapshot
  // rather than silently sending expectedSha256:null.
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!target || !targetKey || loadedFor.current === targetKey) return;
    loadedFor.current = targetKey;
    const issueKey = targetKey;
    let cancelled = false;
    void (async () => {
      try {
        const result = await callGetSupervision({ schemaVersion: 1, target });
        if (cancelled || !isCurrentKey(issueKey)) return;
        setData(result);
        setReadError(null);
        setForm(formFromRoutes(result.routes ?? []));
      } catch (error) {
        if (cancelled || !isCurrentKey(issueKey)) return;
        setReadError(errorMessage(error));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- targetKey captures target
  }, [target, targetKey]);

  const markEdited = () => { setDirty(true); setSaved(false); };

  const setRouteField = (index: number, field: "leadAgentId" | "leadWorkspaceId" | "supervisorAgentId" | "pendingDelayMs", value: string) => {
    markEdited();
    setForm(current => current.map((row, at) => (at === index ? { ...row, [field]: value } : row)));
  };
  const setRouteMode = (index: number, mode: "off" | "shadow") => {
    markEdited();
    setForm(current => current.map((row, at) => (at === index ? { ...row, mode } : row)));
  };
  const addRoute = () => { markEdited(); setForm(current => [...current, emptyRouteForm()]); };
  const removeRoute = (index: number) => { markEdited(); setForm(current => current.filter((_, at) => at !== index)); };

  const save = async () => {
    if (!target || !targetKey) return;
    const built = routesFromForm(form);
    if ("error" in built) {
      update({ lastError: built.error }, target);
      return;
    }
    const issueKey = targetKey;
    setSaving(true);
    try {
      const result = await callSetSupervision({
        schemaVersion: 1,
        target,
        routes: built.routes,
        expectedSha256: data?.sha256 ?? null,
      });
      if (!isCurrentKey(issueKey)) return;
      setData(result);
      setForm(formFromRoutes(result.routes ?? []));
      setDirty(false);
      setSaved(true);
      setCardError(null);
    } catch (error) {
      const message = errorMessage(error);
      update({ lastError: message }, target);
      if (isCurrentKey(issueKey)) {
        const cas = message.includes("changed since") || message.includes("changed during");
        setCardError({
          message: cas ? "supervision.json changed since the last read — Reload to fetch the new version." : message,
          cas,
        });
      }
    } finally {
      if (isCurrentKey(issueKey)) setSaving(false);
    }
  };

  const reload = async () => {
    if (!target || !targetKey) return;
    const issueKey = targetKey;
    setReloading(true);
    try {
      const result = await callGetSupervision({ schemaVersion: 1, target });
      if (!isCurrentKey(issueKey)) return;
      setData(result);
      setReadError(null);
      setCardError(null);
      setForm(formFromRoutes(result.routes ?? []));
      setDirty(false);
      setSaved(false);
    } catch (error) {
      const message = errorMessage(error);
      update({ lastError: message }, target);
      if (isCurrentKey(issueKey)) setCardError({ message, cas: false });
    } finally {
      if (isCurrentKey(issueKey)) setReloading(false);
    }
  };

  return {
    data,
    form,
    dirty,
    busy: saving || reloading,
    saved,
    readError,
    cardError,
    setRouteField,
    setRouteMode,
    addRoute,
    removeRoute,
    save,
    reload,
  };
}
export type SupervisionCardState = ReturnType<typeof useSupervisionCard>;

const MODE_OPTIONS: readonly { label: string; value: "off" | "shadow" }[] = [
  { label: "Off", value: "off" },
  { label: "Shadow", value: "shadow" },
];

export function SupervisionCard({ colors, target, jev, supervision }: {
  colors: Colors;
  target: TargetValue | null;
  jev: JevCardState;
  supervision: SupervisionCardState;
}) {
  const gate = gateStatus(jev.view);
  const storedModes = new Set<SupervisionMode>((supervision.data?.routes ?? []).map(route => route.mode));
  return (
    <Card
      colors={colors}
      title="Supervision"
      subtitle="Opt-in shadow observation of explicitly bound Leads — off by default; configuring Jev never opts in"
    >
      {/* Required disclosure (spec: "an explicit UI disclosure that full
          captured communication can leave the host"). */}
      <View style={[styles.noticeBox, { borderColor: colors.statusWarning, backgroundColor: colors.surface2 }]}>
        <Text style={[styles.mutedSmall, { color: colors.statusWarning }]}>
          A route in shadow mode can send captured Peer/Lead communication to the configured Jev endpoint —
          content leaves this host. Notification delivery is not implemented in this build.
        </Text>
        <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
          Coverage is fixture-derived for codex/pi/devin/claude — on devin the send result body is
          unobservable, so delivery evidence is weaker there. Each evaluation is a billable Jev call.
          Open cases and the event queue are process-local: a plugin restart does not replay missed
          turns — only the bounded metadata ring persists.
        </Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Badge colors={colors} label={gate.label} tone={gate.tone} />
      </View>
      {storedModes.has("notify") ? (
        <Text style={[styles.mutedSmall, { color: colors.foregroundMuted }]}>
          A stored route uses mode "notify" — schema-valid but inert in this build; saving from this card
          writes it back as shadow.
        </Text>
      ) : null}

      {supervision.data !== null ? <ObservationList colors={colors} data={supervision.data} /> : null}

      {supervision.readError !== null ? (
        <View style={[styles.noticeBox, { borderColor: colors.statusDanger, backgroundColor: colors.surface2 }]}>
          <Text style={[styles.mutedSmall, { color: colors.statusDanger }]}>
            Could not read supervision.json: {supervision.readError}
          </Text>
        </View>
      ) : null}
      {supervision.data?.error ? (
        <View style={[styles.noticeBox, { borderColor: colors.statusDanger, backgroundColor: colors.surface2 }]}>
          <Text style={[styles.mutedSmall, { color: colors.statusDanger }]}>
            {supervision.data.error}
          </Text>
        </View>
      ) : null}

      {supervision.form.map((row, index) => (
        <View key={index} style={[styles.noticeBox, { borderColor: colors.border, backgroundColor: colors.surface2 }]}>
          <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Route {index + 1}</Text>
          <Field
            colors={colors}
            label="Lead agent ID"
            hint="Exact agent UUID with provider slp-<family>-lead — verified against the connected daemon on save"
            value={row.leadAgentId}
            onChangeText={text => supervision.setRouteField(index, "leadAgentId", text)}
            placeholder="00000000-0000-0000-0000-000000000000"
            disabled={!target || supervision.busy}
          />
          <Field
            colors={colors}
            label="Lead workspace ID"
            hint="The Lead's exact workspace binding — a mismatch rejects the save"
            value={row.leadWorkspaceId}
            onChangeText={text => supervision.setRouteField(index, "leadWorkspaceId", text)}
            placeholder="wks_…"
            disabled={!target || supervision.busy}
          />
          <Field
            colors={colors}
            label="Supervisor agent ID (optional in shadow)"
            hint="Exact agent UUID with provider slp-<family>-supervisor — required for notify, may be kept empty while shadowing"
            value={row.supervisorAgentId}
            onChangeText={text => supervision.setRouteField(index, "supervisorAgentId", text)}
            placeholder="00000000-0000-0000-0000-000000000000"
            disabled={!target || supervision.busy}
          />
          <View style={styles.field}>
            <Text style={[styles.legend, { color: colors.foregroundMuted }]}>Mode</Text>
            <ChipSelect
              colors={colors}
              variant="choice"
              value={row.mode}
              options={MODE_OPTIONS}
              onChange={next => supervision.setRouteMode(index, next)}
              disabled={!target || supervision.busy}
            />
          </View>
          <Field
            colors={colors}
            label="Pending-brief delay (ms)"
            hint={`How long a pending brief may wait for the handback before the case is assessed incomplete — 0–${SUPERVISION_PENDING_DELAY_MAX_MS}`}
            value={row.pendingDelayMs}
            onChangeText={text => supervision.setRouteField(index, "pendingDelayMs", text)}
            placeholder={String(SUPERVISION_PENDING_DELAY_DEFAULT_MS)}
            disabled={!target || supervision.busy}
          />
          <Button
            colors={colors}
            kind="ghost"
            label="Remove route"
            disabled={!target || supervision.busy}
            onPress={() => supervision.removeRoute(index)}
          />
        </View>
      ))}

      <Button
        colors={colors}
        kind="ghost"
        label="+ Add Lead route"
        disabled={!target || supervision.busy}
        onPress={supervision.addRoute}
      />

      {supervision.cardError ? (
        <View style={[styles.noticeBox, {
          borderColor: supervision.cardError.cas ? colors.statusWarning : colors.statusDanger,
          backgroundColor: colors.surface2,
        }]}>
          <Text style={[styles.mutedSmall, {
            color: supervision.cardError.cas ? colors.statusWarning : colors.statusDanger,
          }]}>
            {supervision.cardError.message}
          </Text>
          {supervision.cardError.cas ? (
            <Button
              colors={colors}
              kind="ghost"
              label="Reload"
              disabled={supervision.busy}
              onPress={() => void supervision.reload()}
            />
          ) : null}
        </View>
      ) : null}

      {supervision.saved && !supervision.dirty ? (
        <Text style={[styles.mutedSmall, { color: colors.statusSuccess }]} accessibilityLiveRegion="polite">Saved.</Text>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button
          colors={colors}
          kind="primary"
          label={supervision.busy ? "Working…" : "Apply supervision routes"}
          disabled={!target || supervision.busy || !supervision.dirty || supervision.readError !== null}
          onPress={() => void supervision.save()}
        />
        <Button
          colors={colors}
          kind="ghost"
          label="Reload"
          disabled={!target || supervision.busy}
          onPress={() => void supervision.reload()}
        />
      </View>
    </Card>
  );
}
