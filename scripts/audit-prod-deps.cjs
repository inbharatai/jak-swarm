#!/usr/bin/env node
/**
 * audit-prod-deps.cjs — registry-independent high/critical CVE gate (replaces
 * `pnpm audit --audit-level=high --prod`).
 *
 * Why: the npm registry retired /-/npm/v1/security/audits (410 Gone), so
 * `pnpm audit` fails across ALL pnpm versions until pnpm ships bulk-endpoint
 * support. This script keeps the same gate semantics (fail on high/critical in
 * PRODUCTION deps) by:
 *   1. using `pnpm list -r --prod --depth Infinity --json` for the exact prod
 *      dependency closure (dev-only tooling like vite/vitest is excluded, as
 *      `--prod` intended);
 *   2. querying the SUPPORTED npm bulk advisory endpoint
 *      (/-/npm/v1/security/advisories/bulk) for those (name, version) pairs;
 *   3. failing CI only on high/critical advisories.
 *
 * Run after `pnpm install --frozen-lockfile` (so the closure is resolvable).
 */
const { execSync } = require('child_process');
const https = require('https');

const BULK = 'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk';
const FAIL_LEVELS = new Set(['high', 'critical']);
// Workspace-local packages (private, not on the npm registry) — skip auditing.
const SKIP = new Set(['jak-swarm', '@jak-swarm/api', '@jak-swarm/web', '@jak-swarm/swarm', '@jak-swarm/shared', '@jak-swarm/db', '@jak-swarm/tools', '@jak-swarm/agents', '@jak-swarm/security', '@jak-swarm/skills', '@jak-swarm/verification', '@jak-swarm/voice', '@jak-swarm/client', '@jak-swarm/industry-packs', '@jak-swarm/adk', '@jak-swarm/whatsapp-client', '@jak-swarm/tests']);

function baseVersion(v) {
  if (typeof v !== 'string') return null;
  return v.split('(')[0].trim() || null;
}

function collect(tree, out) {
  if (!tree || typeof tree !== 'object') return;
  for (const name of Object.keys(tree)) {
    const dep = tree[name];
    if (!dep || typeof dep !== 'object') continue;
    const v = baseVersion(dep.version);
    if (v && !SKIP.has(name) && !name.startsWith('file:') && !v.startsWith('link:') && !v.startsWith('workspace:') && !v.startsWith('file:')) {
      if (!out.has(name)) out.set(name, new Set());
      out.get(name).add(v);
    }
    if (dep.dependencies) collect(dep.dependencies, out);
  }
}

function postBulk(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request(BULK, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('bad response: ' + d.slice(0, 200))); } });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

(async () => {
  let raw;
  try {
    raw = execSync('pnpm list -r --prod --depth Infinity --json', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    console.error('[audit] pnpm list failed:', e.message);
    process.exit(2);
  }
  const projects = JSON.parse(raw);
  const closure = new Map();
  for (const p of projects) collect(p.dependencies || {}, closure);
  const names = [...closure.keys()];
  console.log('[audit] prod closure:', names.length, 'packages,', [...closure.values()].reduce((a, s) => a + s.size, 0), 'versions');
  const hits = [];
  const BATCH = 100;
  for (let i = 0; i < names.length; i += BATCH) {
    const payload = {};
    for (const n of names.slice(i, i + BATCH)) payload[n] = [...closure.get(n)];
    let resp;
    try { resp = await postBulk(payload); } catch (e) { console.error('[audit] bulk request failed:', e.message); process.exit(2); }
    for (const [name, advisories] of Object.entries(resp)) {
      if (!Array.isArray(advisories)) continue;
      for (const adv of advisories) {
        if (FAIL_LEVELS.has(String(adv.severity).toLowerCase())) {
          hits.push({ name, severity: adv.severity, title: adv.title, url: adv.url, vulnerable_versions: adv.vulnerable_versions });
        }
      }
    }
  }
  if (hits.length === 0) {
    console.log('[audit] OK — no high/critical advisories in production dependencies');
    process.exit(0);
  }
  console.error('[audit] FAIL — ' + hits.length + ' high/critical production advisory/advisories:');
  for (const h of hits) console.error('  - ' + h.name + ' [' + h.severity + '] ' + h.title + ' (' + h.vulnerable_versions + ') ' + h.url);
  process.exit(1);
})();
