import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { hash } from './package.mjs';
import { families, roles, providerId } from './profiles.mjs';
import { settingIdPattern, unsafeModelPattern, rejectRouteKeys, verifyProvider,
  runtimeSettingKeys, profileRouteKeys, swe2ModelPattern } from './binding.mjs';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const statuses = ['ready', 'quota-exhausted', 'paused', 'unknown'];
export const emptyCatalog = () => ({ version: 1, policy: 'Human maintains model suitability and quota. Lead chooses within the current assignment budget.', quotaFallback: { enabled: false, optionIds: [] }, options: [] });

export function validateCatalog(catalog) {
  if (!record(catalog) || catalog.version !== 1 || !nonempty(catalog.policy) || !Array.isArray(catalog.options)) throw new Error('Routing catalog requires version=1, policy and options[]');
  const ids = new Set();
  for (const option of catalog.options) {
    if (!record(option) || !nonempty(option.id) || !/^[a-z][a-z0-9-]*$/.test(option.id) || ids.has(option.id)) throw new Error('Invalid or duplicate routing option id');
    ids.add(option.id);
    if (!families.includes(option.provider)) throw new Error(`Routing option ${option.id}: provider must be one of ${families.join(', ')}`);
    if (!Array.isArray(option.roles) || !option.roles.length || option.roles.some(role => !roles.includes(role))) throw new Error(`Routing option ${option.id}: invalid roles`);
    if (typeof option.enabled !== 'boolean' || !statuses.includes(option.availability)) throw new Error(`Routing option ${option.id}: explicit enabled and availability required`);
    if (typeof option.model !== 'string' || (option.enabled && !option.model) || unsafeModelPattern.test(option.model)) throw new Error(`Routing option ${option.id}: invalid model`);
    if (option.provider === 'devin' && !swe2ModelPattern.test(option.model)) throw new Error(`Routing option ${option.id}: devin options require a swe-2 model`);
    for (const key of ['thinkingOptionId', 'modeId']) {
      if (option[key] != null && (typeof option[key] !== 'string' || !settingIdPattern.test(option[key]))) throw new Error(`Routing option ${option.id}: invalid ${key}`);
    }
    if (option.features != null && !record(option.features)) throw new Error(`Routing option ${option.id}: invalid features`);
    if (!Number.isFinite(option.priority)) throw new Error(`Routing option ${option.id}: priority required`);
    for (const key of ['suitableFor', 'avoidFor']) {
      if (!Array.isArray(option[key]) || option[key].some(value => !nonempty(value))) throw new Error(`Routing option ${option.id}: ${key} must be a string list`);
    }
    if (!nonempty(option.notes)) throw new Error(`Routing option ${option.id}: suitability notes required`);
  }
  if (catalog.quotaFallback != null) {
    const fallback = catalog.quotaFallback;
    if (!record(fallback) || typeof fallback.enabled !== 'boolean'
        || !Array.isArray(fallback.optionIds)
        || fallback.optionIds.some(id => !ids.has(id))
        || new Set(fallback.optionIds).size !== fallback.optionIds.length
        || Object.keys(fallback).some(key => !['enabled', 'optionIds'].includes(key))) {
      throw new Error('quotaFallback requires enabled and unique optionIds from this pool');
    }
    if (fallback.enabled && fallback.optionIds.length === 0) throw new Error('Enabled quotaFallback needs pool optionIds');
  }
  return catalog;
}

export function routingPath(repository) {
  if (typeof repository !== 'string' || !isAbsolute(repository) || !lstatSync(repository).isDirectory()) throw new Error('Absolute repository directory required');
  return join(realpathSync(repository), '.paseo-slp', 'slp-routing.json');
}

export function readCatalog(repository) {
  const path = routingPath(repository);
  try {
    if (!lstatSync(join(path, '..')).isDirectory()) throw new Error('Repository .paseo-slp must be a regular directory');
    if (!lstatSync(path).isFile()) throw new Error('Repository routing catalog must be a regular file');
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Missing repository routing catalog ${path}; run init for this repository or use paseo-slp-onboarding`);
    throw error;
  }
  const bytes = readFileSync(path, 'utf8');
  return { ...validateCatalog(JSON.parse(bytes)), path, sha256: hash(bytes) };
}

// Lead chooses the option, not an enum/disposition-to-profile mapping.
export function catalogBinding(repository, role, providers, route) {
  if (Object.hasOwn(route, 'catalogFile')) throw new Error('Routing is repository-scoped; use repository/.paseo-slp/slp-routing.json, not route.catalogFile');
  const catalog = readCatalog(repository);
  if (route.catalogSha256 !== catalog.sha256) throw new Error('Routing catalog changed or hash missing; read routes again before selecting');
  const option = catalog.options.find(item => item.id === route.optionId);
  if (!option) throw new Error(`Unknown routing option ${route.optionId}`);
  if (!option.enabled || option.availability !== 'ready' || !option.roles.includes(role)) throw new Error(`Routing option ${option.id} is disabled, unavailable or excluded for ${role}`);
  rejectRouteKeys(route, [...profileRouteKeys, ...runtimeSettingKeys],
    key => `Routing option settings are complete; conflicting route.${key}`);
  if (Object.hasOwn(route, 'quotaFallbackFrom')) {
    const from = catalog.options.find(item => item.id === route.quotaFallbackFrom);
    if (!from || from.id === option.id || !from.roles.includes(role)) throw new Error('Quota fallback requires a different source option for this role');
    if (catalog.quotaFallback?.enabled !== true || !catalog.quotaFallback.optionIds.includes(option.id)) {
      throw new Error('Quota fallback is disabled or target option is not authorized');
    }
  }
  const provider = providerId(role, option.provider);
  verifyProvider(providers, provider, () => option.provider, provider);
  return {
    binding: { provider, model: option.model, modeId: option.modeId, thinkingOptionId: option.thinkingOptionId, features: structuredClone(option.features ?? {}) },
    routing: { catalogFile: catalog.path, catalogSha256: catalog.sha256, optionId: option.id, ...(route.quotaFallbackFrom ? { quotaFallbackFrom: route.quotaFallbackFrom } : {}) },
  };
}
