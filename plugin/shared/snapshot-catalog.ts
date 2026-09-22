// providers.snapshot → catalog decision logic (host parity). The host agent
// profile resolves provider data from ONE providers.snapshot({cwd}) call and
// picks the entry by the agent's MANAGED provider id — slp-<family>-<role>
// for SLP — falling back to the base family entry. The rules here mirror
// packages/app's agent-controls: models filter `isSelectable !== false`
// (filterSelectableModels), modes ship only when `entry.status === "ready"`
// (resolveSnapshotModeIds), and the entry's own error/non-ready status fold
// into the catalog's non-fatal error instead of swallowing.
// Pure module — no node builtins (same constraint as families.ts), so the
// server handler and the unit tests share it.
import type { CatalogModelValue, CatalogOptionValue } from "./contracts.ts";

/** Structural subset of the host's ProviderSnapshotEntry the catalog needs —
 *  declared rather than imported because the plugin build cannot resolve
 *  protocol types. */
export interface ProviderSnapshotModelLike {
  id: string;
  label?: string;
  isSelectable?: boolean;
  thinkingOptions?: {
    id: string; label: string; description?: string;
    isDefault?: boolean; metadata?: Record<string, unknown>;
  }[];
  defaultThinkingOptionId?: string;
}

export interface ProviderSnapshotEntryLike {
  provider: string;
  status?: string;
  models?: ProviderSnapshotModelLike[];
  modes?: { id: string; label?: string }[];
  error?: string | null;
}

/** Entry selection (agent-controls/index.tsx): the managed provider id first
 *  — `slp-<family>-<role>` for SLP profiles — then the base family entry so
 *  an unmanaged/extra provider still answers. */
export function pickSnapshotEntry<E extends { provider: string }>(
  entries: readonly E[],
  preferredId: string,
  family: string,
): E | undefined {
  return (
    entries.find(entry => entry.provider === preferredId) ??
    entries.find(entry => entry.provider === family)
  );
}

/** Snapshot entry → catalog models/modes + a non-fatal error string.
 *  Features are NOT part of the snapshot entry (the host still calls
 *  listProviderFeatures separately) so they are resolved by the caller. */
export function snapshotEntryCatalog(entry: ProviderSnapshotEntryLike): {
  models: CatalogModelValue[];
  modes: CatalogOptionValue[];
  error: string | null;
} {
  const errors: string[] = [];
  if (entry.error) errors.push(entry.error);
  if (entry.status !== undefined && entry.status !== "ready") {
    errors.push(`provider ${entry.provider} is ${entry.status}`);
  }
  return {
    // filterSelectableModels parity — `isSelectable !== false`, no status gate.
    models: (entry.models ?? [])
      .filter(model => model.isSelectable !== false)
      .map(model => ({
        id: model.id,
        label: model.label ?? model.id,
        ...(model.thinkingOptions ? { thinkingOptions: model.thinkingOptions } : {}),
        ...(model.defaultThinkingOptionId ? { defaultThinkingOptionId: model.defaultThinkingOptionId } : {}),
      })),
    // resolveSnapshotModeIds parity — modes exist only on a ready entry.
    modes: entry.status === "ready"
      ? (entry.modes ?? []).map(mode => ({ id: mode.id, label: mode.label ?? mode.id }))
      : [],
    error: errors.length > 0 ? errors.join("; ") : null,
  };
}
