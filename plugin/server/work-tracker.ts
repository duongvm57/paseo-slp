// plugin/server/work-tracker.ts — the beads work-tracker state RPCs and the
// seat-env overlay for hook-family providers.
//
// Same class of operation as jev/state-store: one plugin-owned file under
// <stableRoot>/state, atomic 0600 whole-file write, no journal, no mutex, no
// authority gate. Detect, never install: nothing here installs, initializes
// or configures beads — `bd version` is the only command ever spawned, and a
// missing or broken `bd` lands in `bdError` as evidence, never an RPC
// failure.
//
// Parity note: readWorkTrackerSetting mirrors src/work-tracker.mjs
// readWorkTrackerSetting — absent file = disabled, unparseable or
// foreign-shape file = disabled plus a surfaced error string, non-ENOENT
// filesystem errors propagate; findBd, the version parse, beadsSeatEnv and
// the forced BD_DISABLE_METRICS=1 are mirrored too (the plugin cannot import
// package code — the no-cross-boundary rule). Keep the check order, defaults
// and reason strings identical; tests/work-tracker.test.mjs pins identical
// results on the same fixtures.
//
// The file root differs by side: the package reader takes a daemon home and
// reads <home>/slp-runtime/state/work-tracker.json; this reader takes the
// stable root (<home>/slp-runtime) and reads state/work-tracker.json — same
// file on disk.

import { execFileSync } from "node:child_process";
import { accessSync, constants, readFileSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { delimiter, isAbsolute, join } from "node:path";
import {
  GetWorkTrackerInput,
  OperationConflict,
  SetWorkTrackerInput,
  type GetWorkTrackerResult,
  type SetWorkTrackerResult,
  type WorkTrackerViewValue,
} from "../shared/contracts.ts";
import { resolveDaemonHome } from "./daemon-home.ts";
import { writePrivate } from "./state-store.ts";

export const WORK_TRACKER_FILE = join("state", "work-tracker.json");

// The five schema checks and their reason strings are the wire between this
// reader and the package's — a mismatch must surface identically on both
// sides.
const schemaFail = (reason: string): string => `work-tracker.json failed schema validation: ${reason}`;

export interface WorkTrackerSetting {
  enabled: boolean;
  error: string | null;
  /** True only when a valid setting file exists on disk. */
  configured: boolean;
}

export function readWorkTrackerSetting(stableRoot: string): WorkTrackerSetting {
  let raw: string;
  try {
    raw = readFileSync(join(stableRoot, WORK_TRACKER_FILE), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { enabled: false, error: null, configured: false };
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { enabled: false, error: `work-tracker.json is not valid JSON: ${(error as Error).message}`, configured: false };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { enabled: false, error: schemaFail("expected an object"), configured: false };
  }
  const record = parsed as Record<string, unknown>;
  if (record.schemaVersion !== 1) {
    return { enabled: false, error: schemaFail("expected schemaVersion 1"), configured: false };
  }
  if (record.tracker !== "beads") {
    return { enabled: false, error: schemaFail('expected tracker "beads"'), configured: false };
  }
  if (typeof record.enabled !== "boolean") {
    return { enabled: false, error: schemaFail("expected enabled to be a boolean"), configured: false };
  }
  const extra = Object.keys(record).filter(key => !["schemaVersion", "tracker", "enabled"].includes(key)).sort();
  if (extra.length > 0) {
    return { enabled: false, error: schemaFail(`unexpected keys: ${extra.join(", ")}`), configured: false };
  }
  return { enabled: record.enabled as boolean, error: null, configured: true };
}

// First executable `bd` on the given PATH, in order. Only absolute PATH
// entries are eligible — a relative entry would resolve against whatever cwd
// the probe happens to run in. On Windows the binary lands as bd.exe; plain
// `bd` is checked last there so an extensionless shim cannot shadow it.
export function findBd(env: Record<string, string | undefined>): string | null {
  const pathEnv = typeof env.PATH === "string" ? env.PATH : "";
  const names = process.platform === "win32" ? ["bd.exe", "bd.cmd", "bd.bat", "bd"] : ["bd"];
  for (const entry of pathEnv.split(delimiter)) {
    if (!isAbsolute(entry)) continue;
    for (const name of names) {
      const candidate = join(entry, name);
      try {
        if (!statSync(candidate).isFile()) continue;
        if (process.platform !== "win32") accessSync(candidate, constants.X_OK);
        return candidate;
      } catch { /* not here — keep scanning */ }
    }
  }
  return null;
}

// `bd version` prints `bd version <semver> (…)` [verify]. Accept the exact
// documented shape first, then fall back to any semver-looking token so an
// upstream format tweak still yields a version instead of a gap.
const VERSION_LINE = /bd\s+version\s+(\S+)/;
const SEMVER_TOKEN = /(\d+\.\d+\.\d+[^\s]*)/;
const parseBdVersion = (output: string): string | null =>
  VERSION_LINE.exec(output)?.[1] ?? SEMVER_TOKEN.exec(output)?.[1] ?? null;

const summarize = (value: unknown, max = 160): string => {
  const text = String(value).replaceAll("\n", " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

export type BdRun = (file: string, args: string[], options: { env: Record<string, string | undefined> }) => string;

// execFileSync with the probe's fixed bounds — the only side effect is
// spawning the read-only command; a nonzero exit, timeout or oversized output
// throws and lands in bdError.
const defaultRun: BdRun = (file, args, { env }) => execFileSync(file, args, {
  env: env as NodeJS.ProcessEnv,
  encoding: "utf8",
  timeout: 5000,
  maxBuffer: 64 * 1024,
  stdio: ["ignore", "pipe", "pipe"],
});

export interface BdDetection {
  bd: { path: string; version: string | null } | null;
  bdError: string | null;
}

// `bd` on the plugin process PATH (= the daemon's PATH) — local exec, no
// network, 5 s timeout, telemetry forced off. Every failure is evidence in
// bdError; the RPC itself never fails on detection.
export function detectBd(
  env: Record<string, string | undefined> = process.env,
  run: BdRun = defaultRun,
): BdDetection {
  const path = findBd(env);
  if (path === null) {
    return { bd: null, bdError: "bd not found on PATH — install is a Human action (brew install beads, npm i -g @beads/bd, or the upstream install.sh)" };
  }
  const runEnv = { ...env, BD_DISABLE_METRICS: "1" };
  try {
    const output = run(path, ["version"], { env: runEnv });
    const version = parseBdVersion(output);
    if (version === null) {
      return { bd: { path, version: null }, bdError: `bd version output unrecognized: ${summarize(output)}` };
    }
    return { bd: { path, version }, bdError: null };
  } catch (error) {
    return { bd: { path, version: null }, bdError: `bd version failed: ${summarize((error as Error).message)}` };
  }
}

// Seat env overlay for hook-family providers (spec §6.3). BEADS_ACTOR is
// always SLP's per-seat identity — a daemon-wide or user-set actor would
// erase attribution in bd history. BD_AGENT_PROFILE and BD_DISABLE_METRICS
// are defaults only: an explicit Human-set env wins.
export function beadsSeatEnv(
  { role, agentId, env = {} }: { role: string; agentId: string; env?: Record<string, string | undefined> },
): Record<string, string> {
  const overlay: Record<string, string> = { BEADS_ACTOR: `slp-${role}-${agentId}` };
  if (env.BD_AGENT_PROFILE === undefined) overlay.BD_AGENT_PROFILE = "conservative";
  if (env.BD_DISABLE_METRICS === undefined) overlay.BD_DISABLE_METRICS = "1";
  return overlay;
}

// The session-open dep: true only when a valid setting file enables the
// tracker. Read errors propagate to the caller — sessionOpen converts any
// throw into "disabled" so an unreadable file never aborts an agent open.
export function readWorkTrackerEnabled(stableRoot: string): boolean {
  return readWorkTrackerSetting(stableRoot).enabled;
}

export interface WorkTrackerDeps {
  uuid?: () => string;
  env?: Record<string, string | undefined>;
  run?: BdRun;
}

export function createWorkTracker(deps: WorkTrackerDeps = {}) {
  const uuid = deps.uuid ?? randomUUID;
  const env = deps.env ?? process.env;
  const run = deps.run ?? defaultRun;
  const resolveHome = (target: { hostId: string; daemonHome: string }) =>
    resolveDaemonHome(target, "daemon home lacks a readable regular config.json");

  function view(stableRoot: string): WorkTrackerViewValue {
    const setting = readWorkTrackerSetting(stableRoot);
    const { bd, bdError } = detectBd(env, run);
    return {
      configured: setting.configured,
      enabled: setting.enabled,
      error: setting.error,
      bd,
      bdError,
    };
  }

  async function getWorkTracker(input: unknown): Promise<GetWorkTrackerResult> {
    const parsed = GetWorkTrackerInput.safeParse(input);
    if (!parsed.success) {
      throw new OperationConflict(
        "INVALID_REQUEST",
        `invalid get-work-tracker input: ${parsed.error.issues[0]?.message ?? "schema"}`,
      );
    }
    const ctx = resolveHome(parsed.data.target);
    return { schemaVersion: 1, workTracker: view(ctx.stableRoot) };
  }

  // Sole writer of work-tracker.json — atomic 0600 whole-file write, same
  // class as set-role-routing. The response re-reads the file and re-probes
  // `bd` so the returned view is post-write reality, not the request echo.
  async function setWorkTracker(input: unknown): Promise<SetWorkTrackerResult> {
    const parsed = SetWorkTrackerInput.safeParse(input);
    if (!parsed.success) {
      throw new OperationConflict(
        "INVALID_REQUEST",
        `invalid set-work-tracker input: ${parsed.error.issues[0]?.message ?? "schema"}`,
      );
    }
    const ctx = resolveHome(parsed.data.target);
    const bytes = `${JSON.stringify({ schemaVersion: 1, tracker: "beads", enabled: parsed.data.enabled }, null, 2)}\n`;
    writePrivate(ctx.stableRoot, WORK_TRACKER_FILE, bytes, uuid);
    return { schemaVersion: 1, workTracker: view(ctx.stableRoot) };
  }

  return { getWorkTracker, setWorkTracker };
}
