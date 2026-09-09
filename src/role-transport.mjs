// Only instruction-bearing requests change. Host lifecycle and permissions pass through.
export function piRoleArgs(args, instruction) {
  // Pi accepts repeated append flags, preserving host prompt sources and extensions.
  // Insert before -- so the policy cannot become a positional user message.
  const end = args.indexOf('--');
  const options = end < 0 ? args : args.slice(0, end);
  if (options.some(arg => ['--help', '-h', '--version', '-v'].includes(arg))) return [...args];
  const index = end < 0 ? args.length : end;
  return [...args.slice(0, index), '--append-system-prompt', instruction, ...args.slice(index)];
}

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
