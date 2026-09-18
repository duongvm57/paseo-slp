// Client entry for the paseo-slp manager plugin (Option A v1, spec §2).
// Registers exactly one settings screen; components receive host.id/host.label,
// never a daemon filesystem path.
import type { PluginClientContribution } from "@getpaseo/plugin/client";
import { SettingsScreen } from "./client/SettingsScreen.tsx";

const contribute: PluginClientContribution = client =>
  client.addSettingsScreen({
    id: "manager",
    title: "SLP",
    icon: "settings",
    Component: SettingsScreen,
  });
export default contribute;
