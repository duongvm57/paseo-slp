#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { resolve, isAbsolute } from 'node:path';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { identity, install, uninstall, verifyInstall, snapshot, readJson, json } from '../src/package.mjs';
import { launchPlan } from '../src/launch.mjs';
import { installPaseo, uninstallPaseo, initWorkspace } from '../src/paseo-install.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const [command, target, ...args] = process.argv.slice(2);
try {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (Object.hasOwn(options, key)) throw new Error(`Repeated option ${key}`);
    if (key === '--apply' || key === '--reload') options[key] = true;
    else if (key === '--paseo-home') {
      if (!args[i + 1] || !isAbsolute(args[i + 1])) throw new Error('Absolute Paseo home required');
      options[key] = args[++i];
    } else throw new Error(`Unknown flag ${key}`);
  }
  if (args.length && !['install', 'uninstall', 'init'].includes(command)) throw new Error('This command takes no flags');
  if (options['--paseo-home'] && command !== 'install') throw new Error('--paseo-home is only valid for install');
  if (options['--reload'] && (!options['--apply'] || !['install', 'uninstall'].includes(command))) throw new Error('--reload requires install/uninstall --apply');
  let result;
  if (command === 'identity') result = identity(root);
  else if (command === 'snapshot') result = snapshot(target);
  else if (command === 'verify') result = verifyInstall(resolve(target));
  else if (command === 'prepare') result = launchPlan(root, readJson(target));
  else if (command === 'init') result = initWorkspace(root, target, Boolean(options['--apply']));
  else if (command === 'install' || command === 'uninstall') {
    if (!target || !isAbsolute(target)) throw new Error('Absolute destination required');
    const integrated = command === 'install' ? options['--paseo-home'] : existsSync(resolve(target, 'paseo-binding.json'));
    if (options['--reload'] && !integrated) throw new Error('--reload requires a Paseo-integrated installation');
    if (integrated) result = command === 'install'
      ? installPaseo(root, target, options['--paseo-home'], Boolean(options['--apply']))
      : uninstallPaseo(target, Boolean(options['--apply']));
    else if (!options['--apply']) result = { operation: command, destination: target, applied: false, candidate: command === 'install' ? identity(root) : verifyInstall(target).candidate };
    else result = command === 'install' ? install(root, target) : (uninstall(target), { removed: target });
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
  } else throw new Error('Usage: slp.mjs identity | snapshot <repo> | install <absolute-new-dir> [--paseo-home <absolute-home>] [--apply] [--reload] | verify <dir> | uninstall <dir> [--apply] [--reload] | init <absolute-repo> [--apply] | prepare <request.json>');
  process.stdout.write(json(result));
} catch (error) { console.error(error.message); process.exitCode = 1; }
