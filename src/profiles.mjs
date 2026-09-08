export function resolveProfile(role, profiles, providers, route = {}) {
  const id = `slp-${role}`;
  const profile = profiles.find(p => p.id === id);
  if (!profile) throw new Error(`Missing Paseo profile ${id}`);
  const provider = providers?.find(p => p.id === (route.provider ?? profile.provider));
  if (!provider || (provider.id !== 'codex' && provider.id !== 'pi' && provider.extends !== 'codex' && provider.extends !== 'pi')) {
    throw new Error(`Unverified provider for ${id}`);
  }
  return { profileId: id, profileProvider: profile.provider, provider: provider.id, model: profile.model,
    modeId: route.modeId ?? profile.modeId, thinkingOptionId: profile.thinkingOptionId,
    features: structuredClone(profile.featureValues ?? {}) };
}
