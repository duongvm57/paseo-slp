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

// Generic ACP has no system-instruction channel; the role policy leads the
// first session/prompt of each session as a text block. `seen` tracks injected
// sessionIds; loading/resuming/forking a session re-arms its next prompt.
export function acpRolePrompt(message, instruction, seen) {
  const sessionId = message?.params?.sessionId;
  if (['session/load', 'session/resume', 'session/fork'].includes(message?.method)) {
    if (typeof sessionId === 'string') seen.delete(sessionId);
    return message;
  }
  if (message?.method !== 'session/prompt') return message;
  if (typeof sessionId !== 'string' || !Array.isArray(message.params.prompt)) throw new Error('Malformed session/prompt');
  if (seen.has(sessionId)) return message;
  seen.add(sessionId);
  const result = structuredClone(message);
  result.params.prompt = [{ type: 'text', text: instruction }, ...result.params.prompt];
  return result;
}
