// Only instruction-bearing requests change. Host lifecycle and permissions pass through.
export function injectRole(message, instruction) {
  if (!['thread/start', 'thread/resume', 'turn/start'].includes(message?.method)) return message;
  const result = structuredClone(message);
  const params = result.params ??= {};
  const append = value => typeof value === 'string' && value.includes(instruction)
    ? value : [value, instruction].filter(Boolean).join('\n\n');
  // Current Codex keeps instructions on the thread; older hosts also send turn overrides.
  if (message.method !== 'turn/start' || Object.hasOwn(params, 'developerInstructions')) {
    params.developerInstructions = append(params.developerInstructions);
  }
  if (params.collaborationMode?.settings) {
    params.collaborationMode.settings.developer_instructions = append(params.collaborationMode.settings.developer_instructions);
  }
  return result;
}
