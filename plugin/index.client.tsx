// Client entry for the paseo-slp manager plugin (Option A v1, spec §2).
// Registers exactly one settings screen; components receive host.id/host.label,
// never a daemon filesystem path.
import type { PluginClientContribution } from "@getpaseo/plugin/client";
import { SettingsScreen } from "./client/SettingsScreen.tsx";

// Host note: keep this a hoisted function declaration — the bundler's eager
// export interop resolves `export default const` to undefined at load time.
export default function contribute(client: Parameters<PluginClientContribution>[0]): ReturnType<PluginClientContribution> {
  return client.addSettingsScreen({
    id: "manager",
    title: "SLP",
    icon: "Settings",
    Component: SettingsScreen,
  });
}
