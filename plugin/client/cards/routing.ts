// Routing-card ownership (wave 11 S3b/D): the card owns the stored routing
// value, the editable form, the once-per-target load, the prefill effect,
// the field/family/feature setters and saveRouting. The shell supplies the
// target and its stale-guard key (the mechanism stays shell-owned), the
// status view, the RPC callers, read-only views of the shared
// catalog/feature caches and the lastError plumbing. `form` and
// `featureKeys` feed the shell's catalog-demand computation.
import { useEffect, useRef, useState } from "react";
import type {
  CatalogResult,
  FamilyName,
  GetRoleRoutingRequest,
  GetRoleRoutingResult,
  RoleRoutingValue,
  SetRoleRoutingRequest,
  SetRoleRoutingResult,
  StatusResult,
  TargetValue,
} from "../../shared/contracts.ts";
import {
  applyFamilyChange,
  applySettingChange,
  buildRoleChoice,
  catalogScope,
  errorMessage,
  familyFromProviderId,
  featureKey,
  routingChoiceDiffers,
  routingDiverges,
} from "../manager-state.ts";
import type { RoutingRoleForm } from "../manager-state.ts";

const sameRoleForm = (a: RoutingRoleForm, b: RoutingRoleForm): boolean =>
  a.family === b.family &&
  a.model === b.model &&
  a.modeId === b.modeId &&
  a.thinkingOptionId === b.thinkingOptionId &&
  a.features === b.features &&
  Object.keys(a.feature).length === Object.keys(b.feature).length &&
  Object.keys(a.feature).every(key => a.feature[key] === b.feature[key]);

export const emptyRoutingRoleForm = (): RoutingRoleForm => ({
  family: "codex",
  model: "",
  modeId: "",
  thinkingOptionId: "",
  features: "",
  feature: {},
});

export const emptyRoutingForm = () => ({
  supervisor: emptyRoutingRoleForm(),
  lead: emptyRoutingRoleForm(),
});

export type RoutingForm = ReturnType<typeof emptyRoutingForm>;
type RoutingRole = "supervisor" | "lead";

export function useRoutingCard({ target, targetKey, statusView, callGetRoleRouting, callSetRoleRouting, catalogs, featureSets, featuresLoadingFor, update }: {
  target: TargetValue | null;
  targetKey: string | null;
  statusView: StatusResult | null;
  callGetRoleRouting: (input: GetRoleRoutingRequest) => Promise<GetRoleRoutingResult>;
  callSetRoleRouting: (input: SetRoleRoutingRequest) => Promise<SetRoleRoutingResult>;
  catalogs: Partial<Record<string, CatalogResult>>;
  featureSets: Record<string, { defs: CatalogResult["features"]; error: string | null }>;
  featuresLoadingFor: string | null;
  update: (patch: { lastError: string | null }, target: TargetValue) => void;
}) {
  // `routing` is the stored server-side value, `routingForm` the editable
  // copy covering every RoleChoice field. The saved choice spreads the
  // stored entry first so any field the schema later adds passes through
  // untouched — the card never silently drops a stored choice.
  const [routing, setRouting] = useState<RoleRoutingValue | null>(null);
  const [routingForm, setRoutingForm] = useState<RoutingForm>(emptyRoutingForm);
  const [routingDirty, setRoutingDirty] = useState(false);
  const [routingBusy, setRoutingBusy] = useState(false);
  // `routingSaved` shows a one-line confirmation after a bound save until
  // the next edit — the bound case otherwise gives no visible feedback.
  const [routingSaved, setRoutingSaved] = useState(false);

  // Fetch the stored role routing once per target — the file is
  // plugin-owned and independent of any binding, so it loads with the
  // first status.
  const routingLoadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!target || !targetKey || routingLoadedFor.current === targetKey) return;
    routingLoadedFor.current = targetKey;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- targetKey captures target
  }, [targetKey]);

  // Prefill the routing form from the stored routing until the Human edits —
  // every field falls back to the live profile's value, then the defaults.
  // Same tracking discipline as the language form.
  useEffect(() => {
    if (routingDirty) return;
    const liveOf = (role: RoutingRole) =>
      statusView?.managedProfiles.find(profile => profile.id === `slp-${role}`);
    const prefill = (role: RoutingRole): RoutingRoleForm => {
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
  // clear (applySettingChange) instead of persisting undeclared keys — and
  // a model that resolves with zero thinking options clears a stored
  // thinkingOptionId since no control can surface or correct it.
  const setField = (
    role: RoutingRole,
    field: "model" | "modeId" | "thinkingOptionId" | "features",
  ) => (value: string) => {
    setRoutingDirty(true);
    setRoutingSaved(false);
    setRoutingForm(current => ({
      ...current,
      [role]: field === "model" || field === "modeId"
        ? applySettingChange(current[role], field, value, catalogs[catalogScope(current[role].family, role)])
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
  const setFamily = (
    role: RoutingRole,
  ) => (family: FamilyName) => {
    setRoutingDirty(true);
    setRoutingSaved(false);
    setRoutingForm(current => ({
      ...current,
      [role]: applyFamilyChange(current[role], family, catalogs[catalogScope(family, role)]),
    }));
  };

  const setFeature = (
    role: RoutingRole,
    featureId: string,
  ) => (value: string) => {
    setRoutingDirty(true);
    setRoutingSaved(false);
    setRoutingForm(current => ({
      ...current,
      [role]: { ...current[role], feature: { ...current[role].feature, [featureId]: value } },
    }));
  };

  const featureKeyFor = (role: RoutingRole): string | null => {
    const family = routingForm[role].family;
    const model = routingForm[role].model.trim();
    if (!model) return null;
    return featureKey(family, role, model, routingForm[role].modeId.trim());
  };
  const featureDefsFor = (role: RoutingRole) => {
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
  // gate compares and save dispatches. Save enables when a bound form
  // builds to a routing that differs from the stored one — a bound form
  // equal to stored leaves nothing to persist (a save would be a no-op),
  // while a stored-absent routing always differs because the prefilled form
  // carries a config worth persisting.
  const builds = {
    supervisor: buildRoleChoice("supervisor", routingForm.supervisor, routing?.supervisor, featureDefsFor("supervisor").defs),
    lead: buildRoleChoice("lead", routingForm.lead, routing?.lead, featureDefsFor("lead").defs),
  };
  const differs =
    routingChoiceDiffers(builds.supervisor, routing?.supervisor) ||
    routingChoiceDiffers(builds.lead, routing?.lead);
  const diverged = routingDiverges(routing, statusView?.managedProfiles ?? []);

  // Save validates through the strict schema server-side and lands
  // atomically; it takes effect at the NEXT activation — never here. The
  // choices are the same builds the Save diff-gate compares, so an enabled
  // button can never write something the gate did not see, and a malformed
  // feature-values JSON arrives here as the build's error and surfaces in
  // lastError before dispatch rather than mid-operation.
  const save = async () => {
    if (!target) return;
    const supervisor = builds.supervisor;
    if ("error" in supervisor) { update({ lastError: supervisor.error }, target); return; }
    const lead = builds.lead;
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

  return {
    form: routingForm,
    busy: routingBusy,
    saved: routingSaved,
    differs,
    diverged,
    featureKeys: [featureKeyFor("supervisor"), featureKeyFor("lead")] as (string | null)[],
    featureDefsFor,
    setField,
    setFamily,
    setFeature,
    save,
  };
}
