// Server entry for the paseo-slp manager plugin (Option A v1, spec §2).
// Synchronous contribution returning cleanup; the connected API arrives in
// handlers. Lead wires the lane modules here; manager alone owns the mutation
// mutex, state transitions and connected SDK calls.
import type { PluginServerContribution } from "@getpaseo/plugin/server";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { activate, reconcile, deactivate, status, localTarget } from "./shared/contracts.ts";
import type { Manager } from "./shared/contracts.ts";
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
