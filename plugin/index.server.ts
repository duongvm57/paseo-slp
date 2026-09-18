// Server entry for the paseo-slp manager plugin (Option A v1, spec §2).
// Synchronous contribution returning cleanup; the connected API arrives in
// handlers. Lead wires the lane modules here; manager alone owns the mutation
// mutex, state transitions and connected SDK calls.
import type { PluginServerContribution } from "@getpaseo/plugin/server";
import { activate, reconcile, deactivate, status } from "./shared/contracts.ts";
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
  return () => manager.close();
}
