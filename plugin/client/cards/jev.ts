// Jev-card ownership (wave 11 S3b/D): the card owns the stored view, every
// draft field and pending flag, the once-per-target load, prefill, the
// target-switch reset and the save/key/test handlers. The shell supplies
// the target, its stale-guard predicate (`sameTarget` wraps the shell-owned
// keyRef/targetKey mechanism), the RPC callers and the lastError plumbing.
import { useCallback, useEffect, useRef, useState } from "react";
import { JevProvider } from "../../shared/contracts.ts";
import type {
  GetJevRequest,
  GetJevResult,
  JevViewValue,
  SetJevKeyRequest,
  SetJevKeyResult,
  SetJevRequest,
  SetJevResult,
  TargetValue,
  TestJevRequest,
  TestJevResult,
} from "../../shared/contracts.ts";
import { errorMessage } from "../manager-state.ts";

// Jev provider kinds — the same pin/defaults src/jev.mjs enforces
// daemon-side. Changing kind resets model/baseUrl to the kind's defaults.
export const JEV_KIND_DEFAULT = {
  openrouter: { model: "typesafe/jev-1.13", baseUrl: "https://openrouter.ai", keyLabel: "OpenRouter API key", keyFile: "jev-openrouter.key", keyPlaceholder: "sk-or-v1-…" },
  typesafe: { model: "jev-1.13.0", baseUrl: "https://api.typesafe.ai", keyLabel: "TypeSafe API key", keyFile: "jev-typesafe.key", keyPlaceholder: "ts-…" },
} as const;
// Display names for the key/test actions — they name the SAVED provider the
// daemon will actually call, never the dirty draft pick.
export const JEV_KIND_LABEL = { openrouter: "OpenRouter", typesafe: "TypeSafe" } as const;

type JevKind = keyof typeof JEV_KIND_DEFAULT;

export function useJevCard({ target, targetKey, sameTarget, callGetJev, callSetJev, callSetJevKey, callTestJev, update }: {
  target: TargetValue | null;
  targetKey: string | null;
  sameTarget: (forTarget: TargetValue) => boolean;
  callGetJev: (input: GetJevRequest) => Promise<GetJevResult>;
  callSetJev: (input: SetJevRequest) => Promise<SetJevResult>;
  callSetJevKey: (input: SetJevKeyRequest) => Promise<SetJevKeyResult>;
  callTestJev: (input: TestJevRequest) => Promise<TestJevResult>;
  update: (patch: { lastError: string | null }, target: TargetValue) => void;
}) {
  // Per-daemon config + key — the key value lives only in keyInput until
  // Save, is cleared right after, and status reports hasKey only. Provider
  // kind is selectable (OpenRouter relay vs TypeSafe first-party);
  // model/baseUrl default per kind, baseUrl editable for custom endpoints.
  const [jevView, setJevView] = useState<JevViewValue | null>(null);
  const [jevKind, setJevKind] = useState<JevKind>("openrouter");
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
  const markEdited = () => {
    setJevDirty(true);
    setJevSaved(false);
    setJevTest(null);
    setJevModelError(null);
    setJevUrlError(null);
  };

  // Fetch the Jev view once per target — the config is plugin-owned and
  // independent of any binding, so it loads with the first status. loadJev
  // is also the Retry path after a failed load (the loadError branch in
  // the card JSX).
  const jevLoadedFor = useRef<string | null>(null);
  const loadJev = useCallback(async (forTarget: TargetValue) => {
    setJevLoadError(null);
    // Stale-write guard (the same issueKey discipline the pool ops use): a
    // response issued for the previous target must never paint its config
    // over the displayed target's view — an unguarded write would let a
    // late A-config seed B's fields, and saveJev would then write A's
    // provider settings to B.
    try {
      const result = await callGetJev({ schemaVersion: 1, target: forTarget });
      if (!sameTarget(forTarget)) return;
      setJevView(result.jev);
    } catch (error) {
      if (!sameTarget(forTarget)) return;
      setJevView(null);
      setJevLoadError(errorMessage(error));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sameTarget wraps the shell's key guard
  }, [callGetJev]);
  useEffect(() => {
    if (!target || !targetKey || jevLoadedFor.current === targetKey) return;
    jevLoadedFor.current = targetKey;
    setJevView(null);
    setJevModelError(null);
    setJevUrlError(null);
    void loadJev(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- targetKey captures target
  }, [targetKey]);

  // Target switch drops the draft and every pending flag — a draft authored
  // against home A must not Apply into home B, and a stale op's guarded
  // finally skips its busy clear, so the switch itself is what releases the
  // abandoned view's pending flags.
  useEffect(() => {
    setJevView(null);
    setJevDirty(false);
    setJevSaved(false);
    setJevKeyInput("");
    setJevTest(null);
    setJevLoadError(null);
    setJevModelError(null);
    setJevUrlError(null);
    setJevBusy(false);
    setJevKeyBusy(false);
    setJevTestBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- targetKey captures target
  }, [targetKey]);

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
  const save = async () => {
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
      // Same stale-write guard as loadJev — a set-jev response issued on the
      // previous target must not paint its config over the displayed view,
      // clear the dirty gate (which would let the prefill seed A's fields
      // into B's draft), or flash "Saved." for a write B never saw.
      if (!sameTarget(target)) return;
      setJevView(result.jev);
      setJevDirty(false);
      setJevSaved(true);
    } catch (error) {
      update({ lastError: errorMessage(error) }, target);
    } finally {
      // A stale op must not clear the busy flag of a NEWER op already
      // in-flight on the displayed target — the key-change reset releases
      // the flag for the abandoned view instead.
      if (sameTarget(target)) setJevBusy(false);
    }
  };

  const saveKey = async (key: string | null) => {
    if (!target) return;
    setJevKeyBusy(true);
    try {
      await callSetJevKey({ schemaVersion: 1, target, key });
      const result = await callGetJev({ schemaVersion: 1, target });
      // Same stale-write guard as loadJev — the clears stay AFTER it so a
      // stale resolution never touches the new target's pending key input
      // or test result (the mutation already landed server-side; the guard
      // only blocks the view/state paint).
      if (!sameTarget(target)) return;
      setJevKeyInput("");
      setJevTest(null);
      setJevView(result.jev);
    } catch (error) {
      update({ lastError: errorMessage(error) }, target);
    } finally {
      if (sameTarget(target)) setJevKeyBusy(false);
    }
  };

  const runTest = async () => {
    if (!target) return;
    setJevTestBusy(true);
    setJevTest(null);
    try {
      const result = await callTestJev({ schemaVersion: 1, target });
      if (!sameTarget(target)) return;
      setJevTest({ ok: result.ok, detail: result.detail });
    } catch (error) {
      if (!sameTarget(target)) return;
      setJevTest({ ok: false, detail: errorMessage(error) });
    } finally {
      if (sameTarget(target)) setJevTestBusy(false);
    }
  };

  const setKind = (next: JevKind) => {
    markEdited();
    setJevKind(next);
    setJevModel(JEV_KIND_DEFAULT[next].model);
    setJevBaseUrl(JEV_KIND_DEFAULT[next].baseUrl);
  };
  const setModel = (text: string) => { markEdited(); setJevModel(text); };
  const setBaseUrl = (text: string) => { markEdited(); setJevBaseUrl(text); };
  const setEnabledOn = (next: boolean) => { markEdited(); setJevEnabledOn(next); };
  const setRoutingOn = (next: boolean) => { markEdited(); setJevRoutingOn(next); };
  const setKeyInput = (text: string) => { setJevKeyInput(text); setJevTest(null); };

  return {
    view: jevView,
    kind: jevKind,
    model: jevModel,
    baseUrl: jevBaseUrl,
    enabledOn: jevEnabledOn,
    routingOn: jevRoutingOn,
    dirty: jevDirty,
    busy: jevBusy,
    saved: jevSaved,
    keyInput: jevKeyInput,
    keyBusy: jevKeyBusy,
    test: jevTest,
    testBusy: jevTestBusy,
    loadError: jevLoadError,
    modelError: jevModelError,
    urlError: jevUrlError,
    setKind,
    setModel,
    setBaseUrl,
    setEnabledOn,
    setRoutingOn,
    setKeyInput,
    save,
    saveKey,
    runTest,
    retryLoad: () => { if (target) void loadJev(target); },
  };
}
