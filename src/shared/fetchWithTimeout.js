/** Keep cancellation and limits alive until the response body is consumed. */
export async function fetchWithTimeout(input, init = {}, options = {}) {
  const { timeoutMs = 30_000, maxResponseBytes, timeoutMessage = 'Request timed out' } = options;
  const controller = new AbortController();
  const external = init.signal;
  const timeoutError = new Error(timeoutMessage);
  timeoutError.name = 'TimeoutError';
  const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs);
  const forwardAbort = () => controller.abort(external.reason);
  const cleanup = () => {
    clearTimeout(timer);
    external?.removeEventListener('abort', forwardAbort);
  };
  if (external?.aborted) forwardAbort();
  else external?.addEventListener('abort', forwardAbort, { once: true });
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    const length = Number(response.headers.get('content-length'));
    if (maxResponseBytes !== undefined && length > maxResponseBytes) {
      await response.body?.cancel();
      throw new Error(`Response exceeds ${maxResponseBytes} bytes`);
    }
    if (!response.body) {
      cleanup();
      return response;
    }
    const reader = response.body.getReader();
    let bytes = 0;
    const body = new ReadableStream({
      async pull(stream) {
        try {
          controller.signal.throwIfAborted();
          const { done, value } = await reader.read();
          controller.signal.throwIfAborted();
          if (done) {
            cleanup();
            reader.releaseLock();
            stream.close();
            return;
          }
          bytes += value.byteLength;
          if (maxResponseBytes !== undefined && bytes > maxResponseBytes) {
            throw new Error(`Response exceeds ${maxResponseBytes} bytes`);
          }
          stream.enqueue(value);
        } catch (error) {
          cleanup();
          stream.error(controller.signal.aborted ? controller.signal.reason : error);
          await reader.cancel().catch(() => {});
        }
      },
      async cancel(reason) {
        cleanup();
        await reader.cancel(reason);
      },
    });
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    cleanup();
    throw controller.signal.aborted ? controller.signal.reason : error;
  }
}
