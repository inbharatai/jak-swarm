/**
 * Client SDK — Behavioral Tests
 *
 * Tests that JakClient builds correct URLs, sends proper headers,
 * handles errors, and provides well-typed resource methods.
 * Uses a mock fetch to avoid real HTTP calls.
 */
import { describe, it, expect, vi } from 'vitest';
import { JakClient, JakApiError } from '@jak-swarm/client';

function mockFetch(response: unknown, status = 200): typeof fetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(response),
    json: async () => response,
    body: null,
  })) as unknown as typeof fetch;
}

describe('JakClient — Behavioral', () => {
  it('builds with config and exposes resource clients', () => {
    const client = new JakClient({
      baseUrl: 'http://localhost:3001',
      apiKey: 'test-key',
    });

    expect(client.workflows).toBeDefined();
    expect(client.memory).toBeDefined();
    expect(client.health).toBeDefined();
  });

  it('workflows.create sends POST with goal', async () => {
    const fetchFn = mockFetch({ success: true, data: { id: 'wf_1', status: 'PENDING' } });
    const client = new JakClient({
      baseUrl: 'http://localhost:3001',
      apiKey: 'test-key',
      fetch: fetchFn,
    });

    const result = await client.workflows.create({ goal: 'Test workflow' });
    expect(result).toEqual({ id: 'wf_1', status: 'PENDING' });

    expect(fetchFn).toHaveBeenCalledWith(
      'http://localhost:3001/api/v1/workflows',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ goal: 'Test workflow' }),
      }),
    );
  });

  it('sends Authorization header when apiKey is provided', async () => {
    const fetchFn = mockFetch({ success: true, data: {} });
    const client = new JakClient({
      baseUrl: 'http://localhost:3001',
      apiKey: 'my-secret-key',
      fetch: fetchFn,
    });

    await client.health.check();

    expect(fetchFn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer my-secret-key',
        }),
      }),
    );
  });

  it('throws JakApiError on non-OK response', async () => {
    const fetchFn = mockFetch('Not Found', 404);
    const client = new JakClient({
      baseUrl: 'http://localhost:3001',
      fetch: fetchFn,
    });

    await expect(client.workflows.get('wf_999')).rejects.toThrow(JakApiError);
  });

  it('JakApiError includes status code', async () => {
    const fetchFn = mockFetch('Forbidden', 403);
    const client = new JakClient({
      baseUrl: 'http://localhost:3001',
      fetch: fetchFn,
    });

    try {
      await client.workflows.get('wf_999');
    } catch (err) {
      expect(err).toBeInstanceOf(JakApiError);
      expect((err as JakApiError).statusCode).toBe(403);
    }
  });

  it('workflows.list builds correct query params', async () => {
    const fetchFn = mockFetch({ success: true, data: { items: [], total: 0 } });
    const client = new JakClient({
      baseUrl: 'http://localhost:3001',
      fetch: fetchFn,
    });

    await client.workflows.list({ page: 2, limit: 10, status: 'COMPLETED' });

    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining('page=2'),
      expect.any(Object),
    );
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining('limit=10'),
      expect.any(Object),
    );
  });

  it('memory.upsert sends PUT with correct body', async () => {
    const fetchFn = mockFetch({ success: true, data: { key: 'k1', value: 42 } });
    const client = new JakClient({
      baseUrl: 'http://localhost:3001',
      fetch: fetchFn,
    });

    await client.memory.upsert({ key: 'test_key', value: { data: 123 } });

    expect(fetchFn).toHaveBeenCalledWith(
      'http://localhost:3001/api/v1/memory/test_key',
      expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('"value":{"data":123}'),
      }),
    );
  });

  it('memory.delete sends DELETE request', async () => {
    const fetchFn = mockFetch(null);
    const client = new JakClient({
      baseUrl: 'http://localhost:3001',
      fetch: fetchFn,
    });

    await client.memory.delete('old_key');

    expect(fetchFn).toHaveBeenCalledWith(
      'http://localhost:3001/api/v1/memory/old_key',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('strips trailing slash from baseUrl', async () => {
    const fetchFn = mockFetch({ success: true, data: {} });
    const client = new JakClient({
      baseUrl: 'http://localhost:3001/',
      fetch: fetchFn,
    });

    await client.health.check();

    // Should NOT have double slash
    expect(fetchFn).toHaveBeenCalledWith(
      'http://localhost:3001/health',
      expect.any(Object),
    );
  });
});
