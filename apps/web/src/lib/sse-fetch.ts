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
}

export async function connectSSE(options: SSEOptions): Promise<void> {
  const { url, token, onMessage, onOpen, onError, signal } = options;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });

  if (!response.ok) {
    throw new Error(`SSE connection failed: ${response.status}`);
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
    onError?.(err);
  }
}
