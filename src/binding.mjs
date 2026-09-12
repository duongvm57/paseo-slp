// A Binding is the complete runtime bundle handed to Paseo create_agent:
// provider, model and the optional mode/thinking/features settings.
// This module owns every rule a Binding must satisfy, whatever produced it.
// Leaf module: it imports nothing from the package, so every producer can use it.

export const settingIdPattern = /^[a-zA-Z0-9._-]+$/;
export const unsafeModelPattern = /[\s\x00-\x1f\x7f]/;
export const dispositionPattern = /^[a-z][a-z0-9-]*$/i;

// Route keys a caller may never use to override a chosen runtime bundle.
export const runtimeSettingKeys = ['provider', 'model', 'modeId', 'thinkingOptionId', 'features'];
// Keys that only mean something on the catalog path...
export const catalogRouteKeys = ['optionId', 'catalogSha256', 'catalogFile'];
// ...and the key that only means something on the saved-profile path.
export const profileRouteKeys = ['profileId'];

export function rejectRouteKeys(route, keys, message) {
  for (const key of keys) if (Object.hasOwn(route, key)) throw new Error(message(key));
}

// One provider-health rule for every Binding source. familyFor resolves the
// expected provider family from the observed provider id, and may itself reject.
export function verifyProvider(inventory, id, familyFor, label = id) {
  if (!Array.isArray(inventory)) throw new Error('Paseo list_providers inventory required: pass the discovered providers array as request.providers, not the tool response envelope');
  const observed = inventory?.find(item => item.id === id);
  if (!observed || observed.enabled === false || observed.status === 'unavailable') throw new Error(`Unverified provider ${label}`);
  const family = familyFor(observed.id);
  if (observed.extends != null && observed.extends !== family) throw new Error(`Unverified provider family ${label}`);
  return { observed, family };
}

export function bindingCheck(binding) {
  if (!binding || typeof binding.provider !== 'string' || !settingIdPattern.test(binding.provider)) throw new Error('Provider required');
  if (binding.modeId != null && (typeof binding.modeId !== 'string' || !settingIdPattern.test(binding.modeId))) throw new Error('Invalid mode');
  if (typeof binding.model !== 'string' || !binding.model || unsafeModelPattern.test(binding.model)) throw new Error('Explicit model required');
  if (binding.thinkingOptionId != null && (typeof binding.thinkingOptionId !== 'string' || !settingIdPattern.test(binding.thinkingOptionId))) throw new Error('Invalid thinking option');
}
