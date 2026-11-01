import { antigravityExecutor } from './executors/antigravityExecutor.js';
import { claudeExecutor } from './executors/claudeExecutor.js';
import { codexExecutor } from './executors/codexExecutor.js';
import { geminiCliExecutor } from './executors/geminiCliExecutor.js';
import type { RuntimeDispatchInput, RuntimeResponse } from './executors/types.js';

export async function dispatchRuntimeRequest(
  input: RuntimeDispatchInput,
): Promise<RuntimeResponse> {
  const executor = input.request.runtime?.executor || 'default';
  if (executor === 'codex') {
    return codexExecutor.dispatch(input);
  }
  if (executor === 'claude') {
    return claudeExecutor.dispatch(input);
  }
  if (executor === 'gemini-cli') {
    return geminiCliExecutor.dispatch(input);
  }
  if (executor === 'antigravity') {
    return antigravityExecutor.dispatch(input);
  }
  return codexExecutor.dispatch(input);
}
