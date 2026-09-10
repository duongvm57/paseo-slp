export const roles = ['supervisor', 'lead', 'peer'];
export const families = ['codex', 'pi'];
export const profileId = role => `slp-${role}`;
export const providerId = (role, family = 'codex') => `slp-${family}-${role}`;

export function roleProvider(role, provider) {
  if (!roles.includes(role)) throw new Error('Unknown role');
  const family = families.find(f => provider === f || provider === providerId(role, f));
  if (!family) throw new Error(`Provider must be stock codex/pi or a matching SLP ${role} provider`);
  return family;
}

export function resolveProfile(role, profiles, providers, route = {}) {
  if (!roles.includes(role)) throw new Error('Unknown role');
  if (route.disposition != null && (typeof route.disposition !== 'string' || !/^[a-z][a-z0-9-]*$/i.test(route.disposition))) throw new Error('Invalid Peer disposition');
  const disposition = route.disposition?.toLowerCase();
  if (disposition && role !== 'peer') throw new Error('Disposition requires Peer role');
  const id = route.profileId ?? profileId(role);
  const profile = profiles.find(p => p.id === id);
  if (!profile) throw new Error(`Missing Paseo profile ${id}`);
  const provider = providers?.find(p => p.id === (route.provider ?? profile.provider));
  if (!provider || provider.enabled === false || provider.status === 'unavailable') {
    throw new Error(`Unverified provider for ${id}`);
  }
  const family = roleProvider(role, provider.id);
  if (provider.extends != null && provider.extends !== family) throw new Error(`Unverified provider family for ${id}`);
  const switched = family !== roleProvider(role, profile.provider);
  if (switched && !route.model) throw new Error('Provider switch requires an explicit target model; old provider settings are not portable');
  const setting = (key, fallback) => Object.hasOwn(route, key) ? route[key] : switched ? undefined : fallback;
  return { profileId: id, profileProvider: profile.provider, provider: provider.id,
    model: setting('model', profile.model), modeId: setting('modeId', profile.modeId),
    thinkingOptionId: setting('thinkingOptionId', profile.thinkingOptionId),
    features: structuredClone(setting('features', profile.featureValues) ?? {}) };
}

// Saved profiles are complete Human-owned runtime bundles.
export function savedProfileBinding(role, profiles, providers, route = {}) {
  for (const key of ['provider', 'model', 'modeId', 'thinkingOptionId', 'features', 'optionId', 'catalogSha256', 'catalogFile']) {
    if (Object.hasOwn(route, key)) throw new Error(`Saved profile settings cannot be overridden by route.${key}; ask Human to configure the agent profile`);
  }
  if (!Array.isArray(profiles)) throw new Error('Paseo list_profiles inventory required');
  if (!Array.isArray(providers)) throw new Error('Paseo list_providers inventory required');
  const binding = resolveProfile(role, profiles, providers, route);
  const family = roleProvider(role, binding.provider);
  if (binding.provider !== providerId(role, family)) throw new Error(`Human must configure ${binding.profileId} with the matching SLP role provider`);
  if (typeof binding.model !== 'string' || !binding.model.trim()) throw new Error(`Human must configure a model in agent profile ${binding.profileId}`);
  if (binding.features === null || typeof binding.features !== 'object' || Array.isArray(binding.features)) throw new Error(`Invalid features in agent profile ${binding.profileId}`);
  return binding;
}
