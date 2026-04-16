import {
  makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { toDataURL } from 'qrcode';
import { createServer } from 'http';
import { join } from 'path';
import pino from 'pino';

type WAStatus = 'starting' | 'qr' | 'connected' | 'disconnected' | 'error';

const API_URL = process.env['WHATSAPP_API_URL'] || 'http://localhost:4000';
const AUTH_DIR = process.env['WHATSAPP_AUTH_DIR'] || join(process.cwd(), '.whatsapp-auth');
const HTTP_PORT = Number.parseInt(process.env['WHATSAPP_CLIENT_PORT'] || '47891', 10);
const HTTP_HOST = process.env['WHATSAPP_CLIENT_HOST'] || '127.0.0.1';
const BRIDGE_TOKEN = process.env['WHATSAPP_BRIDGE_TOKEN'] || '';
const LOG_LEVEL = process.env['LOG_LEVEL'] || 'info';

const logger = pino({ level: LOG_LEVEL });

let currentStatus: WAStatus = 'starting';
let currentQrDataUrl = '';
function parseList(value?: string): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (BRIDGE_TOKEN) headers['Authorization'] = `Bearer ${BRIDGE_TOKEN}`;
  return headers;
}

function extractText(message: Record<string, unknown>): string {
  const msg = message as {
    conversation?: string;
    extendedTextMessage?: { text?: string };
    imageMessage?: { caption?: string };
  };
  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    ''
  );
}

async function requestCommand(from: string, text: string): Promise<{ reply?: string; ignore: boolean }> {
  try {
    const res = await fetch(`${API_URL}/whatsapp/command`, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({ from, text }),
    });

    if (!res.ok) {
      logger.warn({ status: res.status }, '[whatsapp-client] Command rejected');
      return { ignore: true };
    }

    const payload = (await res.json()) as { data?: { reply?: string; ignore?: boolean }; reply?: string; ignore?: boolean };
    const reply = payload?.data?.reply || payload?.reply || '';
    const ignore = payload?.data?.ignore ?? payload?.ignore ?? false;
    return { reply, ignore };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[whatsapp-client] Command failed');
    return { ignore: true };
  }
}

function startHttpServer(): void {
  const server = createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' };

    if (req.method === 'GET' && req.url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
      res.end(
        JSON.stringify({
          status: currentStatus,
          qr: currentStatus === 'qr' ? currentQrDataUrl : undefined,
        }),
      );
      return;
    }

    if (req.method === 'GET' && req.url === '/qr.png') {
      if (currentStatus !== 'qr' || !currentQrDataUrl) {
        res.writeHead(204, cors);
        res.end();
        return;
      }

      try {
        const b64 = currentQrDataUrl.replace(/^data:image\/png;base64,/, '');
        const buf = Buffer.from(b64, 'base64');
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(buf.length), ...cors });
        res.end(buf);
      } catch {
        res.writeHead(500, cors);
        res.end('QR generation error');
      }
      return;
    }

    res.writeHead(404, cors);
    res.end('Not found');
  });

  server.listen(HTTP_PORT, HTTP_HOST, () => {
    const baseUrl = `http://${HTTP_HOST}:${HTTP_PORT}`;
    console.log(`[whatsapp-client] QR server listening on ${baseUrl}`);
    console.log(`[whatsapp-client] Status: GET ${baseUrl}/status`);
    console.log(`[whatsapp-client] QR PNG: GET ${baseUrl}/qr.png`);
  });
}

async function startWhatsApp(): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const socket = makeWASocket({
    version,
    logger,
    printQRInTerminal: true,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
  });

  socket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentStatus = 'qr';
      try {
        currentQrDataUrl = await toDataURL(qr, { width: 300, margin: 2 });
      } catch {
        currentQrDataUrl = '';
      }
    }

    if (connection === 'open') {
      currentStatus = 'connected';
      currentQrDataUrl = '';
      console.log('[whatsapp-client] WhatsApp connected.');
    }

    if (connection === 'close') {
      const reason = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      const shouldReconnect = reason !== DisconnectReason.loggedOut;
      currentStatus = shouldReconnect ? 'disconnected' : 'error';
      currentQrDataUrl = '';

      console.log(`[whatsapp-client] Connection closed (${reason ?? 'unknown'}). Reconnect: ${shouldReconnect}`);
      if (shouldReconnect) {
        setTimeout(() => startWhatsApp(), 3000);
      } else {
        console.log('[whatsapp-client] Logged out — delete .whatsapp-auth/ and restart to re-pair.');
      }
    }
  });

  socket.ev.on('creds.update', saveCreds);

  socket.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (msg.key.fromMe) continue;

      const from = msg.key.remoteJid || '';
      if (!from || from.endsWith('@g.us')) continue;

      const text = extractText(msg.message as Record<string, unknown>);
      if (!text.trim()) continue;

      const { reply, ignore } = await requestCommand(from, text);

      if (ignore || !reply) continue;

      try {
        await socket.sendMessage(from, { text: reply });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ err: message }, '[whatsapp-client] Failed to send reply');
      }
    }
  });
}

console.log('[whatsapp-client] Starting JAK WhatsApp client...');
console.log(`[whatsapp-client] API: ${API_URL}`);
console.log(`[whatsapp-client] Auth dir: ${AUTH_DIR}`);
const allowed = parseList(process.env['WHATSAPP_ALLOWED_NUMBERS']);
if (allowed.length > 0) {
  console.log(`[whatsapp-client] Allowed numbers (local override): ${allowed.join(', ')}`);
}

startHttpServer();
startWhatsApp().catch((err) => {
  console.error('[whatsapp-client] Fatal error:', err);
  process.exit(1);
});
