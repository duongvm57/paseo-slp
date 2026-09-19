// plugin/server/role-injection.ts — the agent.create / agent.session_open
// before-hooks (settings-driven-providers.md §6 Phase 2).
//
// Hook families (codex/pi/claude) reach a managed seat through a sentinel-
// gated thin alias: the provider entry keeps its slp-* identity and native
// `extends`, its command runs the candidate's bin/slp-gate.mjs, and this
// module supplies the two halves the gate cannot supply itself —
//
//   agent.create       → roleBundle() rendered from the materialized
//                        candidate is prepended to config.systemPrompt, so
//                        the native seat starts with the role contract in
//                        its durable instructions (role authority leads: a
//                        pre-existing systemPrompt is appended after it).
//   agent.session_open → a non-empty per-open SLP_SESSION_OPEN_GRANT env
//                        overlay, which is the only thing that lets the gate
//                        forward to the real family binary. During a hook
//                        gap the grant stays the empty sentinel and the
//                        gate fails closed.
//
// slp-devin-* and non-slp providers pass through untouched — devin keeps the
// shim+wrapper transport (the 0.8.0 ACP adapter drops systemPrompt anyway).
//
// The role bundle is dynamically imported from the binding's materialized
// candidate (<stableRoot>/<candidateSha256>/src/role-bundle.mjs) — never from
// this plugin checkout (the §2 no-cross-boundary rule); imports are cached
// per candidate sha so a hook call costs one receipt read plus a render.
//
// Candidate verification (review finding O1): the devin shim re-verifies the
// launch manifest and candidate on every launch; the hook path gets the same
// parity through a per-create verification — the published candidate tree is
// re-verified against its anchored record before any of its code is imported.
// Verification is cached once per candidate sha per plugin process (the tree
// is immutable, so a verified sha never goes stale), and failures are evicted
// so a repaired candidate verifies on the next create. The same check
// transitively covers bin/slp-gate.mjs: the gate launcher execs it after
// this hook in the same launch flow, so its bytes are verified before they
// run. agent.session_open does not verify — it only mints a grant and never
// loads candidate code.

import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { PluginBeforeRequests } from "@getpaseo/plugin/server";
import { HOOK_PROVIDER_ID_RE, ROLES, WRAPPER_PROVIDER_ID_RE } from "../shared/families.ts";

type AgentCreateRequest = PluginBeforeRequests["agent.create"];
type SessionOpenRequest = PluginBeforeRequests["agent.session_open"];

/** The fields of a live binding the hooks need. index.server.ts resolves
 *  them from the journal receipt at <daemonHome>/slp-runtime/state/. */
export interface ActiveBinding {
  candidateSha256: string;
  /** The candidate's recorded payload identity — verifyPublished's second
   *  anchor alongside candidateSha256. */
  payloadSha256: string;
  /** <stableRoot>/<candidateSha256> — the immutable candidate root. */
  runtimePath: string;
  /** The binding's verified ordinary-Node path (SLP_NODE_BIN). */
  nodePath: string;
  /** The binding's canonical daemon home (SLP_DAEMON_HOME). */
  daemonHome: string;
}

/** Minimal structural type of the candidate's src/role-bundle.mjs. */
export interface RoleBundleModule {
  roleBundle(
    root: string,
    role: string,
    env: Record<string, string>,
    options?: Record<string, unknown>,
  ): { role: string; instructions: string };
}

export interface RoleInjectionDeps {
  /** Return the live binding, or null when no receipt/binding exists. May
   *  throw on unreadable/corrupt journal state — the hooks propagate it as
   *  fail-closed behavior for managed providers. */
  readActiveBinding(): ActiveBinding | null;
  /** Re-verify the binding's published candidate before any of its code is
   *  loaded — production wires `materializer.verifyPublished(runtimePath,
   *  candidateSha256, payloadSha256)`. Called once per candidate sha per
   *  process (success is cached); a throw aborts the create and is evicted,
   *  so a repaired candidate verifies on the next attempt. Required: there
   *  is no safe default that skips verification. */
  verifyCandidate: (binding: ActiveBinding) => Promise<void> | void;
  /** Dynamic-import seam; production uses import(pathToFileURL(...).href). */
  importModule?: (specifier: string) => Promise<RoleBundleModule>;
  /** Grant-token derivation seam for tests; must return a non-empty token. */
  grantToken?: (request: { agentId: string; reason: string }) => string;
}

// The id classes derive from the family registry (shared/families.ts): hook
// transport = thin alias + gate launcher; wrapper transport = devin's shim.
const HOOK_FAMILY_PROVIDER = HOOK_PROVIDER_ID_RE;
const DEVIN_PROVIDER = WRAPPER_PROVIDER_ID_RE;
const VALID_ROLES = new Set<string>(ROLES);

/** Resolve the role a provider id carries, or null for pass-through
 *  providers (non-slp and the devin wrapper path). Every other slp-* id must
 *  resolve — through the owned suffix or the `slp_role` feature marker (the
 *  4-provider variant seam) — or the create fails closed: an slp-* provider
 *  we cannot map would otherwise spawn a silently unroled managed seat. */
function roleForCreate(provider: string, featureValues: Record<string, unknown> | undefined): string | null {
  const owned = HOOK_FAMILY_PROVIDER.exec(provider);
  if (owned !== null) return owned[2];
  if (!provider.startsWith("slp-") || DEVIN_PROVIDER.test(provider)) return null;
  const marker = featureValues?.["slp_role"];
  if (typeof marker === "string" && VALID_ROLES.has(marker)) return marker;
  throw new Error(
    `SLP role injection cannot resolve a role for provider ${provider}: ` +
      "not an owned slp-<hook-family>-<role> id and no valid featureValues.slp_role marker",
  );
}

function defaultGrantToken(request: { agentId: string; reason: string }): string {
  return createHash("sha256")
    .update(`slp-session-open:${request.agentId}:${request.reason}:${randomUUID()}`)
    .digest("hex");
}

export function createRoleInjection(deps: RoleInjectionDeps) {
  const importModule = deps.importModule ?? ((specifier: string) => import(specifier) as Promise<RoleBundleModule>);
  const grantToken = deps.grantToken ?? defaultGrantToken;
  // Imported role-bundle modules keyed by candidate sha: the candidate is
  // immutable, so a resolved module never goes stale. Failures are evicted
  // so a transient filesystem error can retry on the next create instead of
  // pinning the candidate to its first failure.
  const moduleCache = new Map<string, Promise<RoleBundleModule>>();
  // Successful candidate verifications keyed by candidate sha — the tree is
  // immutable, so one verified sha never goes stale. Failures evict, like
  // moduleCache, so a repaired candidate re-verifies on the next create
  // rather than pinning the sha to its first failure.
  const verifyCache = new Map<string, Promise<void>>();

  function verifyCandidateOnce(binding: ActiveBinding): Promise<void> {
    const cached = verifyCache.get(binding.candidateSha256);
    if (cached !== undefined) return cached;
    const promise = Promise.resolve().then(() => deps.verifyCandidate(binding));
    promise.catch(() => {
      if (verifyCache.get(binding.candidateSha256) === promise) {
        verifyCache.delete(binding.candidateSha256);
      }
    });
    verifyCache.set(binding.candidateSha256, promise);
    return promise;
  }

  function loadRoleBundleModule(binding: ActiveBinding): Promise<RoleBundleModule> {
    const cached = moduleCache.get(binding.candidateSha256);
    if (cached !== undefined) return cached;
    const specifier = pathToFileURL(join(binding.runtimePath, "src", "role-bundle.mjs")).href;
    const promise = Promise.resolve(importModule(specifier));
    promise.catch(() => {
      if (moduleCache.get(binding.candidateSha256) === promise) {
        moduleCache.delete(binding.candidateSha256);
      }
    });
    moduleCache.set(binding.candidateSha256, promise);
    return promise;
  }

  return {
    /** agent.create before-hook. Returns nothing for pass-through providers;
     *  throws (aborts the create) for slp-* providers whose role, binding or
     *  candidate cannot be resolved — never a silent unroled spawn. */
    async agentCreate(input: { request: AgentCreateRequest }) {
      const config = input.request.config;
      const provider = config?.provider;
      if (typeof provider !== "string" || !provider.startsWith("slp-")) return;
      const role = roleForCreate(provider, config.featureValues);
      if (role === null) return; // slp-devin-* — wrapper transport handles it
      const binding = deps.readActiveBinding();
      if (binding === null) {
        throw new Error(
          `SLP role injection cannot run for provider ${provider}: no active binding ` +
            "(the plugin has no verified candidate to render the role bundle from)",
        );
      }
      // O1: re-verify the published candidate before importing any of its
      // code — same verifyPublished the management plane uses, cached once
      // per sha. This also covers bin/slp-gate.mjs transitively: the gate
      // launcher execs it after this hook in the same launch flow.
      await verifyCandidateOnce(binding);
      const mod = await loadRoleBundleModule(binding);
      const bundle = mod.roleBundle(binding.runtimePath, role, {
        SLP_MANAGED_RUNTIME: "1",
        SLP_NODE_BIN: binding.nodePath,
        SLP_RUNTIME_ROOT: binding.runtimePath,
        SLP_DAEMON_HOME: binding.daemonHome,
      });
      const existing = config.systemPrompt;
      const systemPrompt =
        typeof existing === "string" && existing.length > 0
          ? bundle.instructions.endsWith("\n")
            ? bundle.instructions + existing
            : `${bundle.instructions}\n${existing}`
          : bundle.instructions;
      return {
        ...input.request,
        config: { ...config, systemPrompt },
      };
    },

    /** agent.session_open before-hook: overlay the per-open grant onto the
     *  provider env for hook-family managed ids. All other fields are
     *  returned unchanged (the host rejects changes beyond env). Runs for
     *  every open reason — create, resume, refresh, import. */
    sessionOpen(input: { request: SessionOpenRequest }) {
      const request = input.request;
      if (!HOOK_FAMILY_PROVIDER.test(request.provider)) return;
      return {
        ...request,
        env: { ...request.env, SLP_SESSION_OPEN_GRANT: grantToken(request) },
      };
    },
  };
}
