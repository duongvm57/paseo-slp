// Provider-catalog RPC (spec settings-driven-providers.md wave 9b): resolves
// the model/mode/feature list the pickers render, riding the host's own
// providers.snapshot path when the daemon supports it. Extracted from
// index.server.ts — the latch below is module-global on purpose: spec §wave-9b
// pins probe-and-latch to plugin-process lifetime, and per-instance state
// would shorten it.
import type { CatalogRequest } from "../shared/contracts.ts";
import { ownedProviderId } from "../shared/families.ts";
import { pickSnapshotEntry, snapshotEntryCatalog } from "../shared/snapshot-catalog.ts";
import type { ProviderSnapshotEntryLike } from "../shared/snapshot-catalog.ts";

/** Narrowed provider-catalog surface (§2 convention): one snapshot call plus
 * model/mode/feature listings. The SDK PaseoApi is structurally assignable. */
export interface ProviderCatalogApi {
  providers: {
    // Optional — daemons predating the snapshot RPC don't implement it.
    // PaseoApi exposes no serverInfo accessor to pre-check the
    // providersSnapshot feature flag (recorded missing host capability),
    // so support is probed once and latched below.
    snapshot?(options?: { cwd?: string }): Promise<{
      entries?: ProviderSnapshotEntryLike[];
      error?: string | null;
    }>;
    listModels(provider: string): Promise<{
      models?: {
        id: string; label?: string;
        thinkingOptions?: {
          id: string; label: string; description?: string;
          isDefault?: boolean; metadata?: Record<string, unknown>;
        }[];
        defaultThinkingOptionId?: string;
      }[];
      error?: string | null;
    }>;
    listModes(provider: string): Promise<{
      modes?: { id: string; label?: string }[]; error?: string | null;
    }>;
    listFeatures(draft: {
      provider: string; cwd: string; modeId?: string;
    }): Promise<{
      features?: (
        | { type: "toggle"; id: string; label: string; description?: string; tooltip?: string; icon?: string; value: boolean }
        | { type: "select"; id: string; label: string; description?: string; tooltip?: string; icon?: string; value: string | null; options: { id: string; label: string; description?: string; isDefault?: boolean; metadata?: Record<string, unknown> }[] }
      )[];
      error?: string | null;
    }>;
  };
}

// Probe-and-latch capability flag: the daemon version is fixed for the life
// of the plugin process, so a confirmed-absent snapshot RPC can never come
// back — latching avoids paying an RPC rejection on every catalog read.
// Latch ONLY on identifiable capability absence (missing method or the
// daemon's unknown_schema "Unknown request" reply); transient transport
// failures degrade that one call to legacy without latching.
let snapshotUnsupported = false;

// The catalog is read-only and advisory — queried on the role's managed
// provider entry (slp-<family>-<role>) when the daemon answers
// providers.snapshot, matching how the host's own agent profile resolves
// provider data; older daemons keep the legacy per-family listModels/
// listModes path verbatim. A provider that cannot answer reports in `error`
// rather than rejecting; the picker degrades to free text.
export async function loadCatalog(input: CatalogRequest, paseo: ProviderCatalogApi) {
  const provider = input.family;
  // Entry selection parity with the host agent profile: the managed
  // provider id for the request's role, then the base family entry.
  const preferredId = input.role ? ownedProviderId(input.family, input.role) : input.family;
  if (!snapshotUnsupported) {
    if (typeof paseo.providers.snapshot === "function") {
      try {
        const snapshot = await paseo.providers.snapshot(input.cwd ? { cwd: input.cwd } : undefined);
        const errors: string[] = [];
        if (snapshot.error) errors.push(snapshot.error);
        const entry = pickSnapshotEntry(snapshot.entries ?? [], preferredId, provider);
        if (!entry) {
          // The daemon just proved snapshot-capable — a missing entry is a
          // real absence, not a reason to re-ask the legacy endpoints.
          errors.push(`provider ${preferredId} not found in providers.snapshot`);
          return { schemaVersion: 1 as const, models: [], modes: [], features: [], error: errors.join("; ") };
        }
        const mapped = snapshotEntryCatalog(entry);
        if (mapped.error) errors.push(mapped.error);
        // Snapshot entries carry no features field — listFeatures stays,
        // but on the RESOLVED provider id (host still calls
        // listProviderFeatures per entry).
        let features: Awaited<ReturnType<ProviderCatalogApi["providers"]["listFeatures"]>>["features"] = [];
        if (input.model) {
          try {
            const result = await paseo.providers.listFeatures({
              provider: `${entry.provider}/${input.model}`,
              cwd: input.cwd ?? "/",
              ...(input.modeId ? { modeId: input.modeId } : {}),
            });
            features = result.features ?? [];
            if (result.error) errors.push(result.error);
          } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
          }
        }
        return {
          schemaVersion: 1 as const,
          resolvedProvider: entry.provider,
          models: mapped.models,
          modes: mapped.modes,
          features,
          error: errors.length > 0 ? errors.join("; ") : null,
        };
      } catch (error) {
        // Capability absence is the only latch condition: the daemon
        // answers unrecognized RPCs with code "unknown_schema" and an
        // "Unknown request, try upgrading the daemon" message
        // (websocket-server.ts). Any other throw — daemon restart
        // mid-call, malformed payload — falls through to the legacy path
        // for THIS call and the next read retries the snapshot.
        const code = typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: unknown }).code)
          : "";
        const message = error instanceof Error ? error.message : String(error);
        if (/unknown_schema|unknown request/i.test(`${code} ${message}`)) {
          snapshotUnsupported = true;
          console.warn(`slp: providers.snapshot unavailable (${message || code}); using legacy provider listings`);
        }
      }
    } else {
      snapshotUnsupported = true;
      console.warn("slp: providers.snapshot not implemented by this daemon; using legacy provider listings");
    }
  }
  // Legacy path (pre-snapshot daemons) — unchanged.
  const errors: string[] = [];
  const settle = <T,>(result: PromiseSettledResult<T>): T | null => {
    if (result.status === "fulfilled") return result.value;
    errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
    return null;
  };
  // listFeatures runs on a draft config — the host requires provider/model
  // format, so feature definitions are only queried when a model is chosen.
  const [modelsResult, modesResult, featuresResult] = await Promise.allSettled([
    paseo.providers.listModels(provider),
    paseo.providers.listModes(provider),
    input.model
      ? paseo.providers.listFeatures({
          provider: `${provider}/${input.model}`,
          cwd: input.cwd ?? "/",
          ...(input.modeId ? { modeId: input.modeId } : {}),
        })
      : Promise.resolve({ features: [] as never[], error: null as string | null }),
  ]);
  const modelsPayload = settle(modelsResult);
  const modesPayload = settle(modesResult);
  const featuresPayload = settle(featuresResult);
  if (modelsPayload?.error) errors.push(modelsPayload.error);
  if (modesPayload?.error) errors.push(modesPayload.error);
  if (featuresPayload?.error) errors.push(featuresPayload.error);
  return {
    schemaVersion: 1 as const,
    // Per-model thinking options pass through untouched (§9 corrected
    // finding — the host's AgentModelDefinition carries them; an absent
    // key stays absent so the wire shape records "not declared").
    models: (modelsPayload?.models ?? []).map(m => ({
      id: m.id,
      label: m.label ?? m.id,
      ...(m.thinkingOptions ? { thinkingOptions: m.thinkingOptions } : {}),
      ...(m.defaultThinkingOptionId ? { defaultThinkingOptionId: m.defaultThinkingOptionId } : {}),
    })),
    modes: (modesPayload?.modes ?? []).map(m => ({ id: m.id, label: m.label ?? m.id })),
    features: featuresPayload?.features ?? [],
    error: errors.length > 0 ? errors.join("; ") : null,
  };
}
