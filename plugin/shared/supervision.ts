// Supervision wire contracts + role predicates (spec docs/spec/supervision-
// integration.md §Configuration and authority). One explicit route per Lead
// ID — IDs are exact agent UUIDs, never inferred from title, cwd, workspace,
// or "nearest active Supervisor". The mode enum carries "notify" as reserved
// vocabulary: schema-valid and loadable from the file, but every evaluation
// point must treat it as inert — notification delivery is a later Human gate
// (spec step 4, not implemented in this package version).
import { z } from "zod";
import { defineRpc } from "@getpaseo/plugin";
import { Id, Sha, Target } from "./contracts.ts";
import { OWNED_PROVIDER_ID_RE, ROLES } from "./families.ts";
import type { RoleName } from "./families.ts";

// Exact SLP role predicates — derived from the shared family/role registry,
// never a parallel provider list (spec: "derive role from
// plugin/shared/families.ts, not a new provider list").
export function roleFromProviderId(provider: unknown): RoleName | null {
  if (typeof provider !== "string") return null;
  const match = provider.match(OWNED_PROVIDER_ID_RE);
  if (!match) return null;
  const role = match[2];
  return (ROLES as readonly string[]).includes(role) ? (role as RoleName) : null;
}
export const isSlpLead = (provider: unknown): boolean => roleFromProviderId(provider) === "lead";
export const isSlpSupervisor = (provider: unknown): boolean => roleFromProviderId(provider) === "supervisor";
export const isSlpPeer = (provider: unknown): boolean => roleFromProviderId(provider) === "peer";

export const SUPERVISION_PENDING_DELAY_DEFAULT_MS = 60_000;
// A pending-delay bound: anything past 24h would silently disable the
// pending-brief gate, so the schema rejects it instead of storing a disabled
// detector that looks configured.
export const SUPERVISION_PENDING_DELAY_MAX_MS = 86_400_000;

export const SupervisionMode = z.enum(["off", "shadow", "notify"]);
export type SupervisionMode = z.infer<typeof SupervisionMode>;

export const SupervisionRoute = z
  .object({
    leadAgentId: Id,
    leadWorkspaceId: z.string().min(1),
    supervisorAgentId: Id.nullable(),
    mode: SupervisionMode,
    pendingDelayMs: z.number().int().min(0).max(SUPERVISION_PENDING_DELAY_MAX_MS).default(SUPERVISION_PENDING_DELAY_DEFAULT_MS),
  })
  .strict()
  .check(ctx => {
    const route = ctx.value;
    if (route.mode === "notify" && route.supervisorAgentId === null) {
      ctx.issues.push({
        code: "custom",
        path: ["supervisorAgentId"],
        message: 'mode "notify" requires a Supervisor agent ID',
        input: route.supervisorAgentId,
      });
    }
    if (route.supervisorAgentId !== null && route.supervisorAgentId === route.leadAgentId) {
      ctx.issues.push({
        code: "custom",
        path: ["supervisorAgentId"],
        message: "supervisorAgentId must differ from leadAgentId",
        input: route.supervisorAgentId,
      });
    }
  });
export type SupervisionRoute = z.infer<typeof SupervisionRoute>;

// On-disk shape of <daemonHome>/slp-runtime/state/supervision.json.
// Duplicate leadAgentId is a file-level invariant enforced by the reader
// (broken file = off with a visible error) and by the writer.
export const SupervisionFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    routes: z.array(SupervisionRoute),
  })
  .strict();
export type SupervisionFile = z.infer<typeof SupervisionFileSchema>;

// routes: null = the file is invalid or the target is not the served daemon
// home — off with a visible error, never presented as an empty saved list.
// sha256: raw-file CAS token (null when no file exists).
export const GetSupervisionOutput = z.object({
  schemaVersion: z.literal(1),
  routes: z.array(SupervisionRoute).nullable(),
  sha256: Sha.nullable(),
  error: z.string().nullable(),
}).strict();
export type GetSupervisionResult = z.infer<typeof GetSupervisionOutput>;

export const GetSupervisionInput = z.object({
  schemaVersion: z.literal(1),
  target: Target,
}).strict();
export const getSupervision = defineRpc({ name: "get-supervision", input: GetSupervisionInput, output: GetSupervisionOutput });
export type GetSupervisionRequest = z.input<typeof GetSupervisionInput>;

/** Whole-file overwrite of the route store. `expectedSha256` is the sha256
 *  get-supervision returned (null = expect the file to be absent); a
 *  mismatch is an IDEMPOTENCY_CONFLICT and the client must reload first.
 *  The server rechecks the token after the awaited agent validation so a
 *  concurrent save cannot land in between. */
export const SetSupervisionInput = z.object({
  schemaVersion: z.literal(1),
  target: Target,
  routes: z.array(SupervisionRoute),
  expectedSha256: Sha.nullable(),
}).strict();
export const setSupervision = defineRpc({ name: "set-supervision", input: SetSupervisionInput, output: GetSupervisionOutput });
export type SetSupervisionRequest = z.input<typeof SetSupervisionInput>;
export type SetSupervisionResult = z.infer<typeof GetSupervisionOutput>;
