// plugin/server/jev.ts — Jev per-daemon state, key lifecycle and live probe.
//
// Same class of operation as set-language/set-role-routing: plugin-owned files
// under <stableRoot>/state, no journal, no mutex, no authority gate. Two files:
//   state/jev.json             config + toggles (0600, atomic write)
//   state/jev-<kind>.key       provider key (0600, atomic write)
// The key is the only credential SLP holds: it is never journaled, never
// echoed back — every view reports `hasKey` only. Toggling a capability off
// never removes the stored key.
//
// Parity note: validation mirrors src/jev.mjs (readJevConfig/readJevKey) —
// absent config = unconfigured (Jev OFF), corrupt config = error surfaced,
// key group/other-accessible = reported. Keep the two validators aligned.
// test-jev is the ONLY Jev RPC that touches the network (explicit human
// action — per kind: GET {origin}/api/v1/auth/key for openrouter, GET
// {baseUrl}/v1/models for typesafe); the fetch seam is injectable.

import { lstatSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  GetJevInput,
  JevConfig,
  OperationConflict,
  SetJevInput,
  SetJevKeyInput,
  TestJevInput,
  type GetJevResult,
  type JevConfigValue,
  type JevViewValue,
  type SetJevResult,
  type SetJevKeyResult,
  type TestJevResult,
} from "../shared/contracts.ts";
import { sha256Hex } from "./config-view.ts";
import { resolveDaemonHome } from "./daemon-home.ts";
import { writePrivate } from "./state-store.ts";

const JEV_FILE = join("state", "jev.json");
const keyFileName = (kind: string) => join("state", `jev-${kind}.key`);
const DEFAULT_KIND = "openrouter";
const KIND_LABEL: Record<string, string> = { openrouter: "OpenRouter", typesafe: "TypeSafe" };

// Live auth probe per provider kind — both are documented key-check
// endpoints that answer 401 on a bad Bearer. openrouter's probe lives under
// /api/v1 on the origin regardless of a configured /api/v1 prefix (resolve
// from origin so the prefixed form does not double-prefix). typesafe's
// /v1/models hangs off the configured baseUrl so a custom endpoint/proxy
// with a path prefix is probed at its own mount.
const probeUrl = (provider: { kind: string; baseUrl: string }): string =>
  provider.kind === "typesafe"
    ? `${provider.baseUrl.replace(/\/+$/, "")}/v1/models`
    : `${new URL(provider.baseUrl).origin}/api/v1/auth/key`;

// Remote-controlled text (auth/key labels, API error strings) is untrusted:
// scrub credential-shaped substrings and bound length before it reaches RPC
// details shown in the Manager UI. Mirrors src/jev.mjs sanitizeRemoteText —
// keep the pattern sets AND the flag-preserving rebuild identical: the
// bearer pattern is /i, so rebuilding with 'g' alone would miss lowercase
// `bearer <token>`.
// These three are assembled from fragments so the source never contains a
// detector-matching secret literal; the runtime regexes are unchanged.
const openRouterKeyPattern = new RegExp('\\b' + 'sk-or-' + '[A-Za-z0-9_-]{12,}');
const privateKeyPattern = new RegExp('-----BEGIN ' + '[A-Z0-9 ]*' + 'PRIVATE' + ' KEY-----');
const awsKeyPattern = new RegExp('\\b' + 'AKIA' + '[0-9A-Z]{16}' + '\\b');
const remoteCredentialPatterns = [
  openRouterKeyPattern,
  /\bts-[A-Za-z0-9_-]{12,}/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
  privateKeyPattern,
  awsKeyPattern,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/,
];
const sanitizeRemoteText = (value: string, maxLength = 200): string => {
  let text = String(value);
  for (const pattern of remoteCredentialPatterns) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    text = text.replace(new RegExp(pattern.source, flags), "<redacted>");
  }
  return text.slice(0, maxLength);
};

export interface JevDeps {
  now?: () => Date;
  uuid?: () => string;
  fetchImpl?: typeof fetch;
}

// Home verification lives in server/daemon-home.ts (§8.1, shared with the
// manager) — this caller keeps its generic "lacks a readable regular
// config.json" message for a non-regular config.json.
const resolveHome = (target: { hostId: string; daemonHome: string }): { canonicalHome: string; stableRoot: string } =>
  resolveDaemonHome(target, "daemon home lacks a readable regular config.json");

// Absent file = unconfigured (null); corrupt or schema-mismatched content is
// evidence — surfaced as an error string, never silently treated as OFF.
// sha256 is the raw-file CAS token: present whenever the file exists, even
// broken, so a stale client can still overwrite it under CAS.
function readConfig(stableRoot: string): { config: JevConfigValue | null; sha256: string | null; error: string | null } {
  const file = join(stableRoot, JEV_FILE);
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { config: null, sha256: null, error: null };
    throw error;
  }
  const sha256 = sha256Hex(raw);
  try {
    const parsed = JevConfig.safeParse(JSON.parse(raw));
    return parsed.success
      ? { config: parsed.data, sha256, error: null }
      : { config: null, sha256, error: `jev.json failed schema validation: ${parsed.error.issues[0]?.message ?? "schema"}` };
  } catch (error) {
    return { config: null, sha256, error: `jev.json is not valid JSON: ${(error as Error).message}` };
  }
}

function keyProbe(stableRoot: string, kind: string): { hasKey: boolean; keyPermissionsOk: boolean | null } {
  try {
    const stat = lstatSync(join(stableRoot, keyFileName(kind)));
    return { hasKey: stat.isFile(), keyPermissionsOk: stat.isFile() ? (stat.mode & 0o077) === 0 : null };
  } catch {
    return { hasKey: false, keyPermissionsOk: null };
  }
}

function view(stableRoot: string): JevViewValue {
  const { config, sha256, error } = readConfig(stableRoot);
  const probe = keyProbe(stableRoot, config?.provider.kind ?? DEFAULT_KIND);
  if (config === null) {
    // A file that exists but fails validation is configured-but-broken, not
    // unconfigured — the error field carries the evidence.
    return { configured: error !== null, enabled: null, capabilities: null, provider: null, ...probe, sha256, error };
  }
  return {
    configured: true,
    enabled: config.enabled,
    capabilities: config.capabilities,
    provider: config.provider,
    ...probe,
    sha256,
    error,
  };
}

// Atomic 0600 write — shared with the manager's state-file writes via
// ./state-store.ts.

export function createJev(deps: JevDeps = {}) {
  const uuid = deps.uuid ?? randomUUID;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = () => (deps.now ?? (() => new Date()))().getTime();

  async function getJev(input: unknown): Promise<GetJevResult> {
    const parsed = GetJevInput.safeParse(input);
    if (!parsed.success) {
      throw new OperationConflict("INVALID_REQUEST", `invalid get-jev input: ${parsed.error.issues[0]?.message ?? "schema"}`);
    }
    const ctx = resolveHome(parsed.data.target);
    return { schemaVersion: 1, jev: view(ctx.stableRoot) };
  }

  async function setJev(input: unknown): Promise<SetJevResult> {
    const parsed = SetJevInput.safeParse(input);
    if (!parsed.success) {
      throw new OperationConflict("INVALID_REQUEST", `invalid set-jev input: ${parsed.error.issues[0]?.message ?? "schema"}`);
    }
    const ctx = resolveHome(parsed.data.target);
    // CAS on the raw jev.json bytes — a save that overwrote a concurrent
    // client's capability keys would silently flip supervision; reject and
    // let the stale client reload first.
    const current = readConfig(ctx.stableRoot);
    if (current.sha256 !== parsed.data.expectedSha256) {
      throw new OperationConflict(
        "IDEMPOTENCY_CONFLICT",
        `jev.json changed since the client's read — reload and retry (expected sha256 ${parsed.data.expectedSha256 ?? "<none>"}, found ${current.sha256 ?? "<none>"})`,
      );
    }
    writePrivate(ctx.stableRoot, JEV_FILE, `${JSON.stringify(parsed.data.jev, null, 2)}\n`, uuid);
    return { schemaVersion: 1, jev: view(ctx.stableRoot) };
  }

  // `key` writes the file; `null` removes it. The value is written and
  // forgotten — never returned, never journaled.
  async function setJevKey(input: unknown): Promise<SetJevKeyResult> {
    const parsed = SetJevKeyInput.safeParse(input);
    if (!parsed.success) {
      throw new OperationConflict("INVALID_REQUEST", `invalid set-jev-key input: ${parsed.error.issues[0]?.message ?? "schema"}`);
    }
    const ctx = resolveHome(parsed.data.target);
    const { config } = readConfig(ctx.stableRoot);
    const file = keyFileName(config?.provider.kind ?? DEFAULT_KIND);
    if (parsed.data.key === null) {
      rmSync(join(ctx.stableRoot, file), { force: true });
    } else {
      if (/\s/.test(parsed.data.key)) {
        throw new OperationConflict("INVALID_REQUEST", "key must not contain whitespace");
      }
      writePrivate(ctx.stableRoot, file, `${parsed.data.key}\n`, uuid);
    }
    return { schemaVersion: 1, hasKey: parsed.data.key !== null };
  }

  // Live probe of the stored key against OpenRouter's key-info endpoint.
  // Returns ok:false + detail on any failure — never throws on network/API
  // errors, and never includes key material in the detail string.
  async function testJev(input: unknown): Promise<TestJevResult> {
    const parsed = TestJevInput.safeParse(input);
    if (!parsed.success) {
      throw new OperationConflict("INVALID_REQUEST", `invalid test-jev input: ${parsed.error.issues[0]?.message ?? "schema"}`);
    }
    const ctx = resolveHome(parsed.data.target);
    const { config, error } = readConfig(ctx.stableRoot);
    const fail = (detail: string, latencyMs = 0): TestJevResult => ({ schemaVersion: 1, ok: false, detail, latencyMs });
    if (config === null) return fail(error ?? "Jev is not configured for this daemon");
    const probe = keyProbe(ctx.stableRoot, config.provider.kind);
    if (!probe.hasKey) return fail(`no key stored — set the ${KIND_LABEL[config.provider.kind] ?? config.provider.kind} key first`);
    if (probe.keyPermissionsOk === false) return fail("key file is group/other-accessible — chmod 600 the jev key file");
    let key: string;
    try {
      key = readFileSync(join(ctx.stableRoot, keyFileName(config.provider.kind)), "utf8").trim();
    } catch (readError) {
      return fail(`key file unreadable: ${(readError as Error).message}`);
    }
    const started = now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const label0 = KIND_LABEL[config.provider.kind] ?? config.provider.kind;
    try {
      const response = await fetchImpl(probeUrl(config.provider), {
        headers: { authorization: `Bearer ${key}` },
        signal: controller.signal,
      });
      const latencyMs = now() - started;
      if (!response.ok) return fail(`${label0} answered HTTP ${response.status}`, latencyMs);
      // OpenRouter's key-info answers {data:{label}}; /v1/models returns a
      // model list — a 2xx already proves the key, no field is consumed.
      const body: unknown = await response.json().catch(() => null);
      const label = config.provider.kind === "openrouter" && typeof body === "object" && body !== null && typeof (body as { data?: { label?: unknown } }).data?.label === "string"
        ? (body as { data: { label: string } }).data.label
        : null;
      return { schemaVersion: 1, ok: true, detail: label ? `key accepted (label ${sanitizeRemoteText(label, 120)})` : "key accepted", latencyMs };
    } catch (networkError) {
      return fail(`request failed: ${sanitizeRemoteText((networkError as Error).message)}`, now() - started);
    } finally {
      clearTimeout(timer);
    }
  }

  return { getJev, setJev, setJevKey, testJev };
}
export type Jev = ReturnType<typeof createJev>;
