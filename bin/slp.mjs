#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { resolve, isAbsolute, join } from 'node:path';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { identity, install, uninstall, update, verifyInstall, snapshot, readJson, json } from '../src/package.mjs';
import { launchPlan, handoffPlan, launchCheck, requestSchema } from '../src/launch.mjs';
import { roleBundle } from '../src/role-bundle.mjs';
import { readCatalog } from '../src/routing.mjs';
import { resolveHome } from '../src/managed-home.mjs';
import { installPaseo, uninstallPaseo, upgradePaseo, initWorkspace, materializeWorkspace, installHome } from '../src/paseo-install.mjs';
import { inventory } from '../src/inventory.mjs';
import { agents } from '../src/agents.mjs';
import { monitor } from '../src/monitor.mjs';
import { notebook } from '../src/notebook.mjs';
import { localTarget, runtimeStatus } from '../src/runtime-state.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const [command, ...rest] = argv;
let [target, ...args] = rest[0]?.startsWith('--') ? [undefined, ...rest] : rest;
try {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (Object.hasOwn(options, key)) throw new Error(`Repeated option ${key}`);
    if (key === '--apply' || key === '--reload' || key === '--check' || key === '--schema') options[key] = true;
    else if (key === '--emit') {
      if (args[i + 1] !== 'create') throw new Error('--emit requires create');
      options[key] = args[++i];
    } else if (key === '--from' || key === '--routing-from') {
      if (!args[i + 1] || !isAbsolute(args[i + 1])) throw new Error(`Absolute path required for ${key}`);
      options[key] = args[++i];
    } else if (key === '--paseo-home') {
      if (args[i + 1] && !args[i + 1].startsWith('--')) {
        if (!isAbsolute(args[i + 1])) throw new Error(`Absolute path required for ${key}`);
        options[key] = args[++i];
      } else options[key] = resolveHome(); // bare flag: managed mode resolves SLP_DAEMON_HOME/PASEO_HOME or fails, never ~/.paseo
    } else if (!key.startsWith('-')) {
      // Positional target may come after flags (e.g. prepare --check req.json).
      if (target !== undefined) throw new Error(`Unexpected argument ${key}`);
      target = key;
    } else throw new Error(`Unknown flag ${key}`);
  }
  const commandFlags = { install: ['--paseo-home', '--apply', '--reload'], uninstall: ['--apply', '--reload'], upgrade: ['--from', '--apply', '--reload'], init: ['--routing-from', '--apply'], materialize: ['--from', '--apply'], routes: ['--paseo-home'], inventory: ['--paseo-home'], agents: ['--paseo-home'], monitor: [], notebook: ['--paseo-home'], prepare: ['--check', '--emit', '--schema'], 'prepare-handoff': ['--check', '--emit', '--schema'], status: ['--paseo-home'], 'local-target': ['--paseo-home'] };
  for (const key of Object.keys(options)) if (!commandFlags[command]?.includes(key)) throw new Error(`${key} is not valid for ${command}`);
  const prepareModes = ['--check', '--emit', '--schema'].filter(key => options[key]);
  if (prepareModes.length > 1) throw new Error(`${prepareModes.join(' and ')} are separate modes — pick one`);
  if (command === 'upgrade' && !options['--from']) throw new Error('upgrade requires --from <previous-installation>');
  if (command === 'materialize' && !options['--from']) throw new Error('materialize requires --from <source-repository>');
  if (options['--reload'] && !options['--apply']) throw new Error('--reload requires --apply');
  const targetArg = { snapshot: 'repository', verify: 'dir', prepare: 'request.json', 'prepare-handoff': 'request.json', routes: 'repository', init: 'repository', materialize: 'repository', monitor: 'request.json', notebook: 'repository', instructions: 'role' };
  if (targetArg[command] && !target && !options['--schema']) throw new Error(`${command} requires <${targetArg[command]}>`);
  if (target && !targetArg[command] && !['install', 'uninstall', 'upgrade'].includes(command)) throw new Error(`${command} takes no arguments`);
  let result;
  if (command === 'identity') result = identity(root);
  else if (command === 'snapshot') result = snapshot(target);
  else if (command === 'verify') result = verifyInstall(resolve(target));
  else if (command === 'prepare' || command === 'prepare-handoff') {
    const handoff = command === 'prepare-handoff';
    if (options['--schema']) {
      if (target) throw new Error(`${command} --schema takes no request file`);
      result = requestSchema(handoff);
    } else if (options['--check']) {
      // Preflight only: named stage results, never a plan and never a spawn.
      // Exit 1 when any check fails so scripts can gate on it.
      result = launchCheck(root, readJson(target), { handoff });
      if (!result.ok) process.exitCode = 1;
    } else {
      const planned = handoff ? handoffPlan(root, readJson(target)) : launchPlan(root, readJson(target));
      // --emit create prints the create_agent argument record verbatim —
      // initialPrompt, title, settings and workspaceId pass through untrimmed.
      result = options['--emit'] ? planned.create : planned;
    }
  }
  else if (command === 'routes') result = readCatalog(target, options['--paseo-home']);
  else if (command === 'inventory') result = inventory(options['--paseo-home']);
  else if (command === 'agents') result = agents(options['--paseo-home']);
  else if (command === 'local-target') result = localTarget(options['--paseo-home']);
  else if (command === 'status') result = runtimeStatus(options['--paseo-home']);
  else if (command === 'init') result = initWorkspace(root, target, Boolean(options['--apply']), options['--routing-from']);
  else if (command === 'materialize') result = materializeWorkspace(options['--from'], target, Boolean(options['--apply']));
  else if (command === 'monitor') result = monitor(readJson(target));
  else if (command === 'instructions') {
    // Raw preview: the exact bytes roleBundle would inject, unwrapped — stdout
    // stays diffable against a live bundle; provenance goes to stderr. A
    // managed render already reads SLP_* env (exact Node/runtime/home, and the
    // language state file at render time) and fails closed when they are
    // absent; a source-checkout render is a preview, never the bytes a live
    // shim emitted.
    const managed = process.env.SLP_MANAGED_RUNTIME === '1';
    const installed = existsSync(join(root, 'installed.json'));
    process.stderr.write(`instructions preview — role: ${target}, root: ${root}, managed: ${managed}\n`);
    if (!installed) process.stderr.write('note: source checkout — these bytes come from this tree, not from a live managed shim render\n');
    process.stdout.write(roleBundle(root, target, process.env).instructions);
  }
  else if (command === 'notebook') result = notebook(target, options['--paseo-home']);
  else if (command === 'install' || command === 'uninstall' || command === 'upgrade') {
    if (command === 'install' && !target) target = process.env.SLP_HOME || installHome();
    if (!target || !isAbsolute(target)) throw new Error('Absolute destination required');
    const integrated = command === 'upgrade' || (command === 'install' ? options['--paseo-home'] : existsSync(resolve(target, 'paseo-binding.json')));
    if (options['--reload'] && !integrated) throw new Error('--reload requires a Paseo-integrated installation');
    if (command === 'upgrade') result = upgradePaseo(root, target, options['--from'], Boolean(options['--apply']));
    else if (integrated) result = command === 'install'
      ? installPaseo(root, target, options['--paseo-home'], Boolean(options['--apply']))
      : uninstallPaseo(target, Boolean(options['--apply']));
    else if (!options['--apply']) result = { operation: command, destination: target, applied: false, candidate: command === 'install' ? identity(root) : verifyInstall(target).candidate };
    else result = command === 'install' ? (existsSync(target) ? update(root, target) : install(root, target)) : (uninstall(target), { removed: target });
    if (options['--reload']) {
      try {
        const env = { ...process.env, PASEO_HOME: resolve(result.configPath, '..') };
        delete env.PASEO_HOST;
        const daemon = readJson(resolve(env.PASEO_HOME, 'paseo.pid'));
        const endpoint = daemon.listen ?? daemon.sockPath;
        if (typeof endpoint !== 'string' || !endpoint) throw new Error('No local daemon endpoint recorded for this Paseo home');
        result.reload = JSON.parse(execFileSync('paseo', ['reload', '--host', endpoint, '--json'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }));
        if (!Array.isArray(result.reload.restartRequiredPaths) || !Array.isArray(result.reload.overrideControlledPaths)) throw new Error('Unrecognized reload response');
        result.reloadRequired = result.reload.restartRequiredPaths.length > 0 || result.reload.overrideControlledPaths.length > 0;
        if (result.reloadRequired) process.exitCode = 1;
      } catch {
        result.reloadError = 'Files applied, but Paseo reload failed. Run paseo reload with PASEO_HOME set to the config directory.';
        process.exitCode = 1;
      }
    }
  } else throw new Error('Usage: slp.mjs identity | snapshot <repo> | install [absolute-dir] [--paseo-home <absolute-home>] [--apply] [--reload] | upgrade <absolute-new-dir> --from <previous-installation> [--apply] [--reload] | verify <dir> | uninstall <dir> [--apply] [--reload] | init <absolute-repo> [--routing-from <absolute-json>] [--apply] | routes <absolute-repo> [--paseo-home <absolute-home>] | inventory [--paseo-home <absolute-home>] | agents [--paseo-home <absolute-home>] | prepare <request.json> [--check | --emit create | --schema] | prepare-handoff <request.json> [--check | --emit create | --schema] | materialize <repository> --from <source-repository> [--apply] | monitor <request.json> | notebook <repository> [--paseo-home <absolute-home>] | instructions <role> | status [--paseo-home <absolute-home>] | local-target [--paseo-home <absolute-home>]');
  if (result !== undefined) process.stdout.write(json(result));
} catch (error) { console.error(error.message); process.exitCode = 1; }
