// Server entry for the paseo-slp manager plugin (Option A v1, spec §2).
// Synchronous contribution returning cleanup; the connected API arrives in
// handlers. Lead wires the lane modules here; manager alone owns the mutation
// mutex, state transitions and connected SDK calls.
import type { PluginServerContribution } from "@getpaseo/plugin/server";
import { homedir } from "node:os";
import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { activate, reconcile, deactivate, status, localTarget, catalog, setLanguage, getRoleRouting, setRoleRouting } from "./shared/contracts.ts";
import type { CatalogRequest, FamilyName, Manager } from "./shared/contracts.ts";
import { createManager } from "./server/manager.ts";
import { createMaterializer } from "./server/materializer.ts";
import { embeddedPayload } from "./server/generated/runtime-payload.ts";
import { createExecutableResolver } from "./server/executables.ts";
import { createLauncherBuilder } from "./server/launchers.ts";
import { createJournal } from "./server/journal.ts";
import { createRoleInjection } from "./server/role-injection.ts";
// Host note: this must stay a hoisted function declaration, not a const —
// the daemon compiler's Hermes interop eagerly copies export values before
// module bodies run, so `export default const` evaluates to undefined.
export default function contribute(server: Parameters<PluginServerContribution>[0]): ReturnType<PluginServerContribution> {
  const materializer = createMaterializer(embeddedPayload);
  const manager: Manager = createManager({
    payload: embeddedPayload,
    materializer,
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
  server.handle(getRoleRouting, input => manager.getRoleRouting(input));
  server.handle(setRoleRouting, input => manager.setRoleRouting(input));
  // Phase 2 (settings-driven-providers.md §6): the hook-family thin aliases
  // need the two halves the sentinel gate cannot supply — role-bundle
  // injection at agent.create and the session-open grant overlay. Both hooks
  // read the binding lazily per call, so a later activation or rebind is
  // picked up without re-registering; failures propagate to the host, which
  // is what makes the managed path fail closed during a hook gap.
  const journal = createJournal();
  const injection = createRoleInjection({
    readActiveBinding: () => readActiveBinding(journal),
    // O1: the create-hook re-verifies the published candidate (cached once
    // per sha) before importing its role bundle — same verifyPublished the
    // management plane uses; covers the gate transitively (see
    // role-injection.ts header).
    verifyCandidate: binding =>
      materializer.verifyPublished(binding.runtimePath, binding.candidateSha256, binding.payloadSha256),
  });
  const offAgentCreate = server.before("agent.create", injection.agentCreate);
  const offSessionOpen = server.before("agent.session_open", injection.sessionOpen);
  return () => {
    offAgentCreate();
    offSessionOpen();
    manager.close();
  };
}

// The hooks resolve the live binding from the journal receipt under this
// daemon's own <home>/slp-runtime — the same canonical home resolution the
// manager uses (realpath before the stable-root join). null when no
// receipt/binding exists; journal integrity failures propagate (fail closed
// for managed providers, never a silently unroled spawn).
function readActiveBinding(journal: ReturnType<typeof createJournal>) {
  const { daemonHome } = detectDaemonHome();
  const stableRoot = join(realpathSync(daemonHome), "slp-runtime");
  const receipt = journal.read(stableRoot);
  if (receipt === null || receipt.binding === null) return null;
  const binding = receipt.binding;
  return {
    candidateSha256: binding.candidateSha256,
    payloadSha256: binding.payloadSha256,
    runtimePath: binding.runtimePath,
    nodePath: binding.node.path,
    daemonHome: receipt.target.daemonHome,
  };
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
