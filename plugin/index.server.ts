// Server entry for the paseo-slp manager plugin (Option A v1, spec §2).
// Synchronous contribution returning cleanup; the connected API arrives in
// handlers. Lead wires the lane modules here; manager alone owns the mutation
// mutex, state transitions and connected SDK calls.
import type { PluginServerContribution } from "@getpaseo/plugin/server";
import { homedir } from "node:os";
import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { activate, reconcile, deactivate, status, localTarget, catalog, setLanguage, getRoleRouting, setRoleRouting, getPeerPool, setPeerPool, getJev, setJev, setJevKey, testJev } from "./shared/contracts.ts";
import type { Manager } from "./shared/contracts.ts";
import { loadCatalog } from "./server/provider-catalog.ts";
import { createManager } from "./server/manager.ts";
import { createJev } from "./server/jev.ts";
import { createStateStore } from "./server/state-store.ts";
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
  // Plugin-owned state files under slp-runtime/state — same class of
  // operation as jev: no journal, no mutex, no authority gate.
  const store = createStateStore();
  server.handle(setLanguage, input => store.setLanguage(input));
  server.handle(getRoleRouting, input => store.getRoleRouting(input));
  server.handle(setRoleRouting, input => store.setRoleRouting(input));
  server.handle(getPeerPool, input => store.getPeerPool(input));
  server.handle(setPeerPool, input => store.setPeerPool(input));
  // Jev (OpenRouter Decisions) — per-daemon config/key under slp-runtime/state;
  // test-jev is the only handler that touches the network (explicit action).
  const jev = createJev();
  server.handle(getJev, input => jev.getJev(input));
  server.handle(setJev, input => jev.setJev(input));
  server.handle(setJevKey, input => jev.setJevKey(input));
  server.handle(testJev, input => jev.testJev(input));
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
