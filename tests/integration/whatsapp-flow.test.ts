import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

type ApiResponse<T> = { success: boolean; data: T };

type RegisterResult = {
  token: string;
};

type WhatsAppNumberResult = {
  number: string | null;
  status: 'PENDING' | 'VERIFIED' | 'EXPIRED';
  verificationCode?: string | null;
  expiresAt?: string | null;
  verifiedAt?: string | null;
};

type WhatsAppCommandResult = {
  reply?: string;
  ignore?: boolean;
};

const bridgeToken = 'test-bridge-token';

let app: FastifyInstance;

async function injectJson<T>(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: T | null }> {
  const res = await app.inject({
    method,
    url,
    payload: body ? JSON.stringify(body) : undefined,
    headers: { 'content-type': 'application/json', ...headers },
  });

  if (!res.payload) {
    return { status: res.statusCode, body: null };
  }

  const parsed = JSON.parse(res.payload) as T;
  return { status: res.statusCode, body: parsed };
}

beforeAll(async () => {
  process.env['NODE_ENV'] = 'test';
  if (process.env['DIRECT_URL']) {
    process.env['DATABASE_URL'] = process.env['DIRECT_URL'];
  }
  process.env['WHATSAPP_AUTO_START'] = '0';
  process.env['WHATSAPP_BRIDGE_TOKEN'] = bridgeToken;
  process.env['WHATSAPP_CLIENT_PORT'] = '47891';

  vi.resetModules();
  const mod = await import('../../apps/api/src/index.js');
  app = await mod.buildApp();
  await app.ready();
});

afterAll(async () => {
  if (app) {
    await app.close();
  }
});

describe('WhatsApp verification flow', () => {
  it('issues a challenge, verifies it, and allows commands', async () => {
    const suffix = Date.now();
    const uniqueDigits = String(suffix).slice(-7);
    const testNumber = `+1555${uniqueDigits}`;
    const register = await injectJson<ApiResponse<RegisterResult>>(
      'POST',
      '/auth/register',
      {
        email: `whatsapp-test-${suffix}@jaktest.dev`,
        password: 'TestPass123!',
        name: 'WhatsApp Test',
        tenantName: `whatsapp-test-${suffix}`,
        tenantSlug: `whatsapp-test-${suffix}`,
      },
    );

    expect(register.status).toBe(201);
    const token = register.body?.data.token ?? '';
    expect(token).toBeTruthy();

    const initialStatus = await injectJson<ApiResponse<WhatsAppNumberResult>>(
      'GET',
      '/whatsapp/number',
      undefined,
      { authorization: `Bearer ${token}` },
    );

    expect(initialStatus.status).toBe(200);
    expect(initialStatus.body?.data.number).toBeNull();
    expect(initialStatus.body?.data.status).toBe('PENDING');

    const registerNumber = await injectJson<ApiResponse<WhatsAppNumberResult>>(
      'POST',
      '/whatsapp/number',
      { number: testNumber },
      { authorization: `Bearer ${token}` },
    );

    expect(registerNumber.status).toBe(200);
    expect(registerNumber.body?.data.status).toBe('PENDING');
    expect(registerNumber.body?.data.number).toBe(testNumber);

    const verificationCode = registerNumber.body?.data.verificationCode ?? '';
    expect(verificationCode).toMatch(/^\d{6}$/);

    const wrongCode = await injectJson<ApiResponse<WhatsAppCommandResult>>(
      'POST',
      '/whatsapp/command',
      { from: `whatsapp:${testNumber}`, text: '000000' },
      { authorization: `Bearer ${bridgeToken}` },
    );

    expect(wrongCode.status).toBe(200);
    expect(wrongCode.body?.data.ignore).toBe(true);

    const verify = await injectJson<ApiResponse<WhatsAppCommandResult>>(
      'POST',
      '/whatsapp/command',
      { from: `whatsapp:${testNumber}`, text: verificationCode },
      { authorization: `Bearer ${bridgeToken}` },
    );

    expect(verify.status).toBe(200);
    expect(verify.body?.data.reply).toContain('Number verified');

    const verifiedStatus = await injectJson<ApiResponse<WhatsAppNumberResult>>(
      'GET',
      '/whatsapp/number',
      undefined,
      { authorization: `Bearer ${token}` },
    );

    expect(verifiedStatus.status).toBe(200);
    expect(verifiedStatus.body?.data.status).toBe('VERIFIED');
    expect(verifiedStatus.body?.data.verificationCode).toBeNull();
    expect(verifiedStatus.body?.data.verifiedAt).toBeTruthy();

    const help = await injectJson<ApiResponse<WhatsAppCommandResult>>(
      'POST',
      '/whatsapp/command',
      { from: `whatsapp:${testNumber}`, text: 'help' },
      { authorization: `Bearer ${bridgeToken}` },
    );

    expect(help.status).toBe(200);
    expect(help.body?.data.reply).toContain('WhatsApp Control');
  }, 20000);
});
