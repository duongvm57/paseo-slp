// Daemon-home verification (§8.1) — one implementation shared by the
// manager and the jev module: canonical realpath, a real directory, a
// readable regular config.json, and a real slp-runtime directory (a
// symlinked stableRoot would redirect credential writes outside the
// canonical home). Every failure is a HOME_UNVERIFIED OperationConflict.
//
// The two callers keep their distinct message for a non-regular
// config.json — the manager names the link case, jev keeps its generic
// wording — passed as `notRegularConfigMessage`. The returned `configPath`
// is carried by the manager's HomeContext; the jev module ignores it.
import { lstatSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { OperationConflict } from "../shared/contracts.ts";

export interface HomeContext {
  canonicalHome: string;
  configPath: string;
  stableRoot: string;
}

export function resolveDaemonHome(
  target: { hostId: string; daemonHome: string },
  notRegularConfigMessage: string,
): HomeContext {
  let canonicalHome: string;
  try {
    canonicalHome = realpathSync(target.daemonHome);
  } catch {
    throw new OperationConflict(
      "HOME_UNVERIFIED",
      `daemon home does not resolve: ${target.daemonHome}`,
      { path: target.daemonHome },
    );
  }
  const homeStat = lstatSync(canonicalHome);
  if (!homeStat.isDirectory()) {
    throw new OperationConflict("HOME_UNVERIFIED", "daemon home is not a directory", {
      path: canonicalHome,
    });
  }
  const configPath = join(canonicalHome, "config.json");
  let configStat;
  try {
    configStat = lstatSync(configPath);
  } catch {
    throw new OperationConflict(
      "HOME_UNVERIFIED",
      "daemon home lacks a readable regular config.json",
      { path: configPath },
    );
  }
  if (!configStat.isFile() || configStat.isSymbolicLink()) {
    throw new OperationConflict("HOME_UNVERIFIED", notRegularConfigMessage, {
      path: configPath,
    });
  }
  const stableRoot = join(canonicalHome, "slp-runtime");
  try {
    const rootStat = lstatSync(stableRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new OperationConflict(
        "HOME_UNVERIFIED",
        "slp-runtime exists but is not a real directory",
        { path: stableRoot },
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return { canonicalHome, configPath, stableRoot };
}
