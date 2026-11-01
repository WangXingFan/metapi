export function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit, options?: {
  timeoutMs?: number;
  maxResponseBytes?: number;
  timeoutMessage?: string;
}): Promise<Response>;
