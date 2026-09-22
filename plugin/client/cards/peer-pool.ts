// Peer-pool-card ownership (wave 11 S3b/D): the card owns the stored
// snapshot, the editable form, load/prefill/save/reload/import/copy, every
// seat/setter handler and the seat-editor UI state (open seat, picker,
// convert dialog, token lookup, refs). The shell supplies the target and
// its stale-guard predicates (`targetKey`/`isCurrentKey` wrap the
// shell-owned keyRef mechanism), the RPC callers, read-only views of the
// shared catalog/feature caches, the scroll-focus helper and the lastError
// plumbing. `form` and `featureKeys` feed the shell's catalog-demand
// computation.
import { useEffect, useRef, useState } from "react";
import type { View } from "react-native";
import { copyText } from "@getpaseo/plugin/client/react-native";
import { PEER_SEAT_ARCHETYPES } from "../../shared/archetypes.ts";
import { STANDARD_SEAT_TOKENS } from "../../shared/routing-vocabulary.ts";
import type {
  CatalogResult,
  FamilyName,
  GetPeerPoolRequest,
  GetPeerPoolResult,
  SetPeerPoolRequest,
  SetPeerPoolResult,
  TargetValue,
} from "../../shared/contracts.ts";
import {
  applyFamilyChange,
  applySettingChange,
  buildPeerPool,
  catalogScope,
  convertSeatToCustom,
  customSeatCopy,
  customSeatFromArchetype,
  emptyPeerPoolForm,
  errorMessage,
  formSeatConflict,
  legacyImportAllowed,
  peerPoolDiffers,
  peerPoolForm,
  peerSeatFromArchetype,
  samePeerPoolForm,
  suggestCustomSeatId,
} from "../manager-state.ts";
import type { PeerPoolForm, PeerSeatForm } from "../manager-state.ts";

export function usePeerPoolCard({ target, targetKey, isCurrentKey, callGetPeerPool, callSetPeerPool, catalogs, featureSets, featuresLoadingFor, scrollFocusNode, update }: {
  target: TargetValue | null;
  targetKey: string | null;
  isCurrentKey: (key: string) => boolean;
  callGetPeerPool: (input: GetPeerPoolRequest) => Promise<GetPeerPoolResult>;
  callSetPeerPool: (input: SetPeerPoolRequest) => Promise<SetPeerPoolResult>;
  catalogs: Partial<Record<string, CatalogResult>>;
  featureSets: Record<string, { defs: CatalogResult["features"]; error: string | null }>;
  featuresLoadingFor: string | null;
  scrollFocusNode: (node: unknown, focus?: boolean) => void;
  update: (patch: { lastError: string | null }, target: TargetValue) => void;
}) {
  // `poolData` is the last get-peer-pool response (pool + sha256 for the
  // CAS save + the legacy import view); `poolForm` is the editable copy.
  // Saves are whole-file with optimistic concurrency — a sha mismatch
  // refuses the write and the operator reloads.
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

  // Pool state is keyed to the displayed target: switching daemon homes
  // drops the previous pool, its draft and every transient flag. Without
  // this a draft authored against home A could save into home B — B's
  // fresh sha256 would satisfy the CAS token and hide the swap.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- targetKey captures target
  }, [targetKey]);

  // Fetch the peer pool once per target — plugin-owned state, independent
  // of any binding, so it loads with the first status like role routing
  // does. The response carries the sha256 every save sends back as its CAS
  // guard. A read failure is recorded distinctly (§7.4.E): the card shows
  // "Could not read the pool", never an empty seat list or an unlocked
  // editor.
  const poolLoadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!target || !targetKey || poolLoadedFor.current === targetKey) return;
    poolLoadedFor.current = targetKey;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- targetKey captures target
  }, [targetKey]);

  // Prefill the pool form from the stored pool until the Human edits — same
  // tracking discipline as the routing form. An absent pool starts from the
  // template-policy empty form; a malformed one prefills empty as well (the
  // error line names what the file held).
  useEffect(() => {
    if (poolDirty) return;
    const next = poolData?.pool ? peerPoolForm(poolData.pool) : emptyPeerPoolForm();
    setPoolForm(current => (samePeerPoolForm(current, next) ? current : next));
  }, [poolData, poolDirty]);

  // The pool's diff-gate mirrors the routing card's: ONE build path produces
  // the document the gate compares and savePeerPool dispatches. The stored
  // options map lets buildPeerSeat preserve passthrough fields the form does
  // not model (and deliberately drop the retired `priority`).
  const storedSeatOptions = new Map(
    (poolData?.pool?.options ?? []).map(option => [option.id, option]),
  );
  // Seat feature defs read the same per-key cache as the role pickers —
  // hoisted above poolBuild because buildPeerPool invokes the lambda eagerly
  // during render (a const declared later would be a TDZ crash on any
  // non-empty seat list).
  const featureDefsForSeat = (seat: PeerSeatForm) => {
    const key = seat.family !== "" && seat.model.trim() !== ""
      ? `${seat.family}|peer|${seat.model.trim()}|${seat.modeId.trim()}`
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
          ? (field === "model" || field === "modeId"
            ? applySettingChange(seat, field, value, seat.family !== "" ? catalogs[catalogScope(seat.family, "peer")] : undefined)
            : { ...seat, [field]: value })
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
                : applyFamilyChange(seat, family, catalogs[catalogScope(family, "peer")])),
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
    if (!target || !targetKey) return;
    if ("error" in poolBuild) {
      update({ lastError: poolBuild.error }, target);
      if (poolBuild.seatIndex != null) setOpenSeat(poolBuild.seatIndex);
      return;
    }
    const issueKey = targetKey;
    setPoolSaving(true);
    try {
      const result = await callSetPeerPool({
        schemaVersion: 1,
        target,
        pool: poolBuild.pool,
        expectedSha256: poolData?.sha256 ?? null,
      });
      // A save issued for home A must never land on home B's view.
      if (!isCurrentKey(issueKey)) return;
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
    if (!target || !targetKey) return;
    const issueKey = targetKey;
    setPoolReloading(true);
    try {
      const result = await callGetPeerPool({ schemaVersion: 1, target });
      if (!isCurrentKey(issueKey)) return;
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

  return {
    poolData,
    poolForm,
    poolDirty,
    poolSaving,
    poolReloading,
    poolBusy,
    poolLocked,
    poolSaved,
    poolCopied,
    poolReadError,
    poolError,
    poolReloadConfirm,
    convertSeatIndex,
    convertId,
    standardAppliedId,
    tokenLookupSeat,
    tokenLookupToken,
    openSeat,
    addSeatOpen,
    pickerQuery,
    seatRowRefs,
    lookupRefs,
    definitionRefs,
    keepEditsRef,
    poolBuild,
    poolDiffers,
    conflictedSeats,
    featureDefsForSeat,
    updatePool,
    featureKeys: poolForm.seats.map(seat =>
      seat.family !== "" && seat.model.trim() !== ""
        ? `${seat.family}|peer|${seat.model.trim()}|${seat.modeId.trim()}`
        : null,
    ).filter((key): key is string => key !== null),
    setPoolReloadConfirm,
    setConvertSeatIndex,
    setConvertId,
    setStandardAppliedId,
    setTokenLookupSeat,
    setTokenLookupToken,
    setOpenSeat,
    setAddSeatOpen,
    setPickerQuery,
    setSeatField,
    setSeatId,
    setSeatFamily,
    setSeatEnabled,
    setSeatFeature,
    addStandardSeat,
    addCustomFromTemplate,
    copySeatAsCustom,
    openConvertToCustom,
    applyConvertToCustom,
    applyStandardTokens,
    removeSeat,
    setFallbackId,
    savePeerPool,
    reloadPeerPool,
    requestReload,
    canImportLegacy,
    importLegacyPool,
    copyPoolJson,
  };
}
