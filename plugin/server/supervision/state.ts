// plugin/server/supervision/state.ts — private supervision.json route store
// (spec docs/spec/supervision-integration.md §Configuration and authority).
// One explicit route per Lead ID, raw-file SHA-256 CAS on every write,
// atomic 0600 writes through the shared writePrivate helper, and a
// served-home binding: the file lives only under the daemon home THIS plugin
// process serves — the client-supplied target/local-target value is a
// prefill, not proof of host-home mapping.
//
// Same class of operation as jev: plugin-owned file under
// <stableRoot>/state, no journal, no mutex, no authority gate. An absent
// file is "not configured" (empty routes, no error); an invalid or
// unreadable file is off with a visible error — never an empty route list
// the UI could present as a successful save.
import { readFileSync, realpathSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { OperationConflict } from "../../shared/contracts.ts";
import {
  GetSupervisionInput,
  SetSupervisionInput,
  SupervisionFileSchema,
  isSlpLead,
  isSlpSupervisor,
} from "../../shared/supervision.ts";
import type {
  GetSupervisionResult,
  SupervisionRoute,
} from "../../shared/supervision.ts";
import { sha256Hex } from "../config-view.ts";
import { detectDaemonHome, resolveDaemonHome } from "../daemon-home.ts";
import { writePrivate } from "../state-store.ts";

export const SUPERVISION_FILE = join("state", "supervision.json");
export const supervisionPath = (stableRoot: string): string => join(stableRoot, SUPERVISION_FILE);

const invalid = (rpc: string, error: { issues: { message: string }[] }): OperationConflict =>
  new OperationConflict("INVALID_REQUEST", `invalid ${rpc} input: ${error.issues[0]?.message ?? "schema"}`);

// Reads the raw file once — {routes, sha256, error}. sha256 is the CAS token
// over the raw bytes (present even for a broken file so a stale client can
// overwrite it under CAS). A duplicate leadAgentId makes the file invalid:
// one route per Lead is the whole point of the store.
export function readSupervisionFile(file: string): {
  routes: SupervisionRoute[] | null;
  sha256: string | null;
  error: string | null;
} {
  let raw: Buffer;
  try {
    raw = readFileSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { routes: [], sha256: null, error: null };
    }
    // Unreadable is evidence, same class as corrupt — off with a visible
    // error, never an empty route list (spec §Configuration).
    return { routes: null, sha256: null, error: `supervision.json is not readable: ${(error as Error).message}` };
  }
  const sha256 = sha256Hex(raw);
  let parsed;
  try {
    parsed = SupervisionFileSchema.safeParse(JSON.parse(raw.toString("utf8")));
  } catch (error) {
    return { routes: null, sha256, error: `supervision.json is not valid JSON: ${(error as Error).message}` };
  }
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map(issue => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ")
      .slice(0, 400);
    return { routes: null, sha256, error: `supervision.json failed schema validation: ${detail}` };
  }
  const seen = new Set<string>();
  for (const route of parsed.data.routes) {
    if (seen.has(route.leadAgentId)) {
      return { routes: null, sha256, error: `supervision.json has duplicate leadAgentId ${route.leadAgentId} — one route per Lead` };
    }
    seen.add(route.leadAgentId);
  }
  return { routes: parsed.data.routes, sha256, error: null };
}

type ServedHome = () => { daemonHome: string; source: "env" | "default" };

// The refresh surface the route validator needs — a structural subset of
// PaseoApi so tests can double it without the daemon.
type PaseoLike = {
  agents: { ref(id: string): { refresh(): Promise<{ agent: unknown } | null> } };
};

// Refresh a single agent through the connected SDK. `null` means the daemon
// has no such agent. SDK failures propagate — a transport error must not be
// misread as a validation verdict.
async function refreshAgent(paseo: PaseoLike, agentId: string): Promise<unknown> {
  const result = await paseo.agents.ref(agentId).refresh();
  return result?.agent ?? null;
}

export function createSupervisionState(deps: { servedHome?: ServedHome; uuid?: () => string } = {}) {
  const servedHome = deps.servedHome ?? detectDaemonHome;
  const uuid = deps.uuid ?? randomUUID;

  // Binds the supervision state file to the daemon home this plugin process
  // actually serves. The daemon exports PASEO_HOME when it has one; without
  // it the process's home is a platform-default guess and a UI-selected
  // target can only be verified when it realpath-matches the exported home.
  // A mismatch or missing env is a host capability gap — refuse rather than
  // read or write another daemon home's files (spec: "reject the save and
  // record a host capability gap instead of writing another daemon home's
  // files").
  function servedBinding(target: { hostId: string; daemonHome: string }): { stableRoot: string; error: string | null } {
    const resolved = resolveDaemonHome(target, "daemon home lacks a readable regular config.json");
    const served = servedHome();
    if (served.source !== "env") {
      return {
        stableRoot: resolved.stableRoot,
        error:
          "cannot verify the selected target is the daemon home this plugin serves — the daemon did not export PASEO_HOME to the plugin process, so its own home is only a default guess (host capability gap, tests/fixtures/supervision/README.md row 4); supervision state stays untouched",
      };
    }
    let servedReal: string | null = null;
    try {
      servedReal = realpathSync(served.daemonHome);
    } catch {
      servedReal = null;
    }
    if (servedReal === null || servedReal !== resolved.canonicalHome) {
      return {
        stableRoot: resolved.stableRoot,
        error: `selected target ${resolved.canonicalHome} is not the daemon home this plugin serves (${servedReal ?? "unresolvable"}) — supervision state binds to the served home only`,
      };
    }
    return { stableRoot: resolved.stableRoot, error: null };
  }

  // Exact-route validation through the connected SDK: the named Lead must be
  // an active exact slp-<family>-lead provider in the declared workspace, the
  // named Supervisor (when present) an active exact slp-<family>-supervisor.
  // Non-archived is required; a restored ID needs this fresh verification —
  // no fallback recipient, no inference from title/cwd/workspace.
  async function validateRoutes(paseo: PaseoLike, routes: SupervisionRoute[]): Promise<void> {
    const seen = new Set<string>();
    for (const route of routes) {
      if (seen.has(route.leadAgentId)) {
        throw new OperationConflict("INVALID_REQUEST", `duplicate leadAgentId ${route.leadAgentId} — one route per Lead`);
      }
      seen.add(route.leadAgentId);
      // TODO(notify-gate): "notify" is schema-valid and stored, but every
      // observer evaluation point must treat it as inert — notification
      // delivery is a later Human gate (spec step 4, unimplemented here).
      if (route.mode === "off") continue; // inert route — no liveness required
      const lead = await refreshAgent(paseo, route.leadAgentId);
      if (lead === null) {
        throw new OperationConflict("INVALID_REQUEST", `Lead agent ${route.leadAgentId} not found on this daemon`);
      }
      const leadAgent = lead as { provider?: unknown; archivedAt?: unknown; workspaceId?: unknown; status?: unknown };
      if (!isSlpLead(leadAgent.provider)) {
        throw new OperationConflict(
          "INVALID_REQUEST",
          `Lead ${route.leadAgentId} has provider ${JSON.stringify(leadAgent.provider)} — routes require an exact slp-<family>-lead provider`,
        );
      }
      if (leadAgent.archivedAt != null) {
        throw new OperationConflict("INVALID_REQUEST", `Lead ${route.leadAgentId} is archived — archived agents cannot carry a supervision route`);
      }
      if (leadAgent.status === "closed") {
        throw new OperationConflict("INVALID_REQUEST", `Lead ${route.leadAgentId} is closed — routes require an active agent`);
      }
      if (leadAgent.workspaceId !== route.leadWorkspaceId) {
        throw new OperationConflict(
          "INVALID_REQUEST",
          `Lead ${route.leadAgentId} is in workspace ${JSON.stringify(leadAgent.workspaceId)}, not ${route.leadWorkspaceId} — the workspace binding is exact`,
        );
      }
      if (route.supervisorAgentId !== null) {
        const supervisor = await refreshAgent(paseo, route.supervisorAgentId);
        if (supervisor === null) {
          throw new OperationConflict("INVALID_REQUEST", `Supervisor agent ${route.supervisorAgentId} not found on this daemon`);
        }
        const supAgent = supervisor as { provider?: unknown; archivedAt?: unknown; status?: unknown };
        if (!isSlpSupervisor(supAgent.provider)) {
          throw new OperationConflict(
            "INVALID_REQUEST",
            `Supervisor ${route.supervisorAgentId} has provider ${JSON.stringify(supAgent.provider)} — routes require an exact slp-<family>-supervisor provider`,
          );
        }
        if (supAgent.archivedAt != null) {
          throw new OperationConflict("INVALID_REQUEST", `Supervisor ${route.supervisorAgentId} is archived`);
        }
        if (supAgent.status === "closed") {
          throw new OperationConflict("INVALID_REQUEST", `Supervisor ${route.supervisorAgentId} is closed — routes require an active agent`);
        }
      }
    }
  }

  async function getSupervision(input: unknown): Promise<GetSupervisionResult> {
    const parsed = GetSupervisionInput.safeParse(input);
    if (!parsed.success) throw invalid("get-supervision", parsed.error);
    const binding = servedBinding(parsed.data.target);
    if (binding.error !== null) {
      return { schemaVersion: 1, routes: null, sha256: null, error: binding.error };
    }
    const stored = readSupervisionFile(supervisionPath(binding.stableRoot));
    return { schemaVersion: 1, routes: stored.routes, sha256: stored.sha256, error: stored.error };
  }

  async function setSupervision(input: unknown, paseo: PaseoLike): Promise<GetSupervisionResult> {
    const parsed = SetSupervisionInput.safeParse(input);
    if (!parsed.success) throw invalid("set-supervision", parsed.error);
    const binding = servedBinding(parsed.data.target);
    if (binding.error !== null) {
      throw new OperationConflict("HOME_UNVERIFIED", binding.error);
    }
    const file = supervisionPath(binding.stableRoot);
    const before = readSupervisionFile(file);
    if (before.sha256 !== parsed.data.expectedSha256) {
      throw new OperationConflict(
        "IDEMPOTENCY_CONFLICT",
        `supervision.json changed since the client's read — reload and retry (expected sha256 ${parsed.data.expectedSha256 ?? "<none>"}, found ${before.sha256 ?? "<none>"})`,
      );
    }
    await validateRoutes(paseo, parsed.data.routes);
    // Recheck the token after the awaited agent validation — a concurrent
    // save could have landed while the SDK calls were in flight (spec:
    // "Recheck the token after any awaited agent validation").
    const after = readSupervisionFile(file);
    if (after.sha256 !== parsed.data.expectedSha256) {
      throw new OperationConflict("IDEMPOTENCY_CONFLICT", "supervision.json changed during agent validation — reload and retry");
    }
    const body = `${JSON.stringify({ schemaVersion: 1, routes: parsed.data.routes }, null, 2)}\n`;
    writePrivate(binding.stableRoot, SUPERVISION_FILE, body, uuid);
    return { schemaVersion: 1, routes: parsed.data.routes, sha256: sha256Hex(body), error: null };
  }

  return { getSupervision, setSupervision };
}
