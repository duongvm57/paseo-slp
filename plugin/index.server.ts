// Server entry for the paseo-slp manager plugin (Option A v1, spec §2).
// Synchronous contribution returning cleanup; the connected API arrives in
// handlers. Lead wires the lane modules here; manager alone owns the mutation
// mutex, state transitions and connected SDK calls.
import type { PluginServerContribution } from "@getpaseo/plugin/server";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { activate, reconcile, deactivate, status, localTarget, catalog, setLanguage } from "./shared/contracts.ts";
import type { CatalogRequest, FamilyName, Manager } from "./shared/contracts.ts";
import { createManager } from "./server/manager.ts";
import { createMaterializer } from "./server/materializer.ts";
import { embeddedPayload } from "./server/generated/runtime-payload.ts";
import { createExecutableResolver } from "./server/executables.ts";
import { createLauncherBuilder } from "./server/launchers.ts";
// Host note: this must stay a hoisted function declaration, not a const —
// the daemon compiler's Hermes interop eagerly copies export values before
// module bodies run, so `export default const` evaluates to undefined.
export default function contribute(server: Parameters<PluginServerContribution>[0]): ReturnType<PluginServerContribution> {
  const manager: Manager = createManager({
    payload: embeddedPayload,
    materializer: createMaterializer(embeddedPayload),
    executables: createExecutableResolver(),
    launchers: createLauncherBuilder(),
  });
  server.handle(activate, (input, { paseo }) => manager.activate(input, paseo));
  server.handle(reconcile, (input, { paseo }) => manager.reconcile(input, paseo));
  server.handle(deactivate, (input, { paseo }) => manager.deactivate(input, paseo));
  server.handle(status, (input, { paseo }) => manager.status(input, paseo));
  server.handle(localTarget, () => detectDaemonHome());
  server.handle(catalog, (input, { paseo }) => loadCatalog(input, paseo));
  server.handle(setLanguage, input => manager.setLanguage(input));
  return () => manager.close();
}

// The plugin child inherits the daemon's environment: PASEO_HOME when the
// daemon exported it, else the platform default ~/.paseo — the same detection
// the session-usage plugin uses. This is a prefill suggestion only; the
// §4 verifiedHostHomeMapping acknowledgment remains a human decision.
function detectDaemonHome() {
  const raw = (process.env.PASEO_HOME ?? "").trim();
  if (!raw) return { daemonHome: join(homedir(), ".paseo"), source: "default" as const };
  const expanded = raw === "~" ? homedir() : raw.startsWith("~/") ? join(homedir(), raw.slice(2)) : raw;
  return { daemonHome: resolve(expanded), source: "env" as const };
}

/** Narrowed provider-catalog surface (§2 convention): model/mode/feature
 * listings only. The SDK PaseoApi is structurally assignable. */
interface ProviderCatalogApi {
  providers: {
    listModels(provider: string): Promise<{
      models?: { id: string; label?: string }[]; error?: string | null;
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

// The catalog is read-only and advisory — queried on the family's provider
// entry (the same CLI a managed slp-<family>-* provider reaches through its
// shim), so it returns the model/mode/feature list a managed provider
// reports. A provider that cannot answer reports in `error` rather than
// rejecting; the picker degrades to free text.
async function loadCatalog(input: CatalogRequest, paseo: ProviderCatalogApi) {
  const provider = input.family;
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
    models: (modelsPayload?.models ?? []).map(m => ({ id: m.id, label: m.label ?? m.id })),
    modes: (modesPayload?.modes ?? []).map(m => ({ id: m.id, label: m.label ?? m.id })),
    features: featuresPayload?.features ?? [],
    error: errors.length > 0 ? errors.join("; ") : null,
  };
}
