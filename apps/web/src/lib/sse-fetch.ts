/**
 * Fetch-based SSE client that sends auth via Authorization header
 * instead of leaking tokens in URL query params.
 *
 * Standard EventSource doesn't support custom headers — this replaces it
 * using the Fetch API + ReadableStream for secure SSE consumption.
 */

export interface SSEOptions {
  url: string;
  token: string;
  onMessage: (event: unknown) => void;
  onOpen?: () => void;
  onError?: (error: unknown) => void;
  signal?: AbortSignal;
  /** Maximum retry attempts on non-fatal errors (0 = disabled). */
  maxRetries?: number;
}

export async function connectSSE(options: SSEOptions): Promise<void> {
  const { url, token, onMessage, onOpen, onError, signal, maxRetries = 0 } = options;

  if (!token || token.trim().length === 0) {
    throw new Error('SSE connection failed: missing auth token');
  }

  let attempt = 0;

  while (true) {
    if (signal?.aborted) return;

    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        const suffix = body.trim().length > 0 ? ` - ${body.slice(0, 300)}` : '';
        throw new Error(`SSE connection failed: ${response.status}${suffix}`);
      }

      if (!response.body) {
        throw new Error('SSE response has no body');
      }

      onOpen?.();

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                onMessage(data);
              } catch {
                // Ignore malformed JSON (heartbeats, etc.)
              }
            }
          }
        }
      } catch (err) {
        if (signal?.aborted) return; // Expected on cleanup
        throw err;
      }

      // Stream ended gracefully — return successfully.
      return;
    } catch (err) {
      if (signal?.aborted) return;

      const isFatal =
        err instanceof Error &&
        (/missing auth token|Unauthorized|401|403/i.test(err.message));

      if (isFatal || attempt >= maxRetries) {
        onError?.(err);
        throw err;
      }

      // Exponential backoff: 1s, 2s, 4s, 8s ... capped at 30s.
      const delay = Math.min(1000 * Math.pow(2, attempt), 30_000);
      attempt += 1;
      await new Promise((res) => setTimeout(res, delay));
    }
  }
}
