#!/usr/bin/env node
/**
 * audit-prod-deps.cjs — registry-independent high/critical CVE gate (replaces
 * `pnpm audit --audit-level=high --prod`).
 *
 * In addition to the console result, this writes a compact JSON report so a
 * failed CI run has an inspectable artifact instead of burying the advisory
 * names at the end of a long setup log.
 *
 * Documented temporary exceptions are read from
 * package.json#pnpm.auditConfig.ignoreGhsas. They remain visible in the report
 * and console; they simply do not fail the build. This matches the repository's
 * existing security policy and prevents the custom audit client from silently
 * ignoring the configured exception list.
 */
const { execSync } = require('child_process');
const https = require('https');
const fs = require('fs');

const BULK = 'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk';
const REPORT_PATH = process.env.AUDIT_REPORT_PATH || 'audit-prod-deps-report.json';
const FAIL_LEVELS = new Set(['high', 'critical']);
const SKIP = new Set(['jak-swarm', '@jak-swarm/api', '@jak-swarm/web', '@jak-swarm/swarm', '@jak-swarm/shared', '@jak-swarm/db', '@jak-swarm/tools', '@jak-swarm/agents', '@jak-swarm/security', '@jak-swarm/skills', '@jak-swarm/verification', '@jak-swarm/voice', '@jak-swarm/client', '@jak-swarm/industry-packs', '@jak-swarm/adk', '@jak-swarm/whatsapp-client', '@jak-swarm/tests']);

function loadIgnoredGhsas() {
  try {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const values = pkg?.pnpm?.auditConfig?.ignoreGhsas;
    return new Set(
      Array.isArray(values)
        ? values
            .filter((value) => typeof value === 'string')
            .map((value) => value.toUpperCase())
        : [],
    );
  } catch (error) {
    console.error('[audit] failed to read package.json audit exceptions:', error.message);
    return new Set();
  }
}

const IGNORED_GHSAS = loadIgnoredGhsas();

function ghsaFromAdvisory(advisory) {
  const candidates = [advisory?.url, advisory?.github_advisory_url, advisory?.id, advisory?.ghsa_id];
  for (const candidate of candidates) {
    const match = String(candidate || '').match(/GHSA-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}/i);
    if (match) return match[0].toUpperCase();
  }
  return null;
}

function writeReport(report) {
  try {
    fs.writeFileSync(REPORT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), ...report }, null, 2) + '\n');
  } catch (error) {
    console.error('[audit] failed to write report:', error.message);
  }
}

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
  } catch (error) {
    writeReport({ status: 'error', stage: 'pnpm-list', error: error.message });
    console.error('[audit] pnpm list failed:', error.message);
    process.exit(2);
  }

  const projects = JSON.parse(raw);
  const closure = new Map();
  for (const project of projects) collect(project.dependencies || {}, closure);
  const names = [...closure.keys()];
  const versionCount = [...closure.values()].reduce((sum, versions) => sum + versions.size, 0);
  console.log('[audit] prod closure:', names.length, 'packages,', versionCount, 'versions');

  const hits = [];
  const ignored = [];
  const BATCH = 100;
  for (let i = 0; i < names.length; i += BATCH) {
    const payload = {};
    for (const name of names.slice(i, i + BATCH)) payload[name] = [...closure.get(name)];
    let response;
    try {
      response = await postBulk(payload);
    } catch (error) {
      writeReport({ status: 'error', stage: 'bulk-advisory-request', packageCount: names.length, versionCount, error: error.message });
      console.error('[audit] bulk request failed:', error.message);
      process.exit(2);
    }
    for (const [name, advisories] of Object.entries(response)) {
      if (!Array.isArray(advisories)) continue;
      for (const advisory of advisories) {
        if (!FAIL_LEVELS.has(String(advisory.severity).toLowerCase())) continue;
        const ghsa = ghsaFromAdvisory(advisory);
        const finding = {
          name,
          ghsa,
          severity: advisory.severity,
          title: advisory.title,
          url: advisory.url,
          vulnerable_versions: advisory.vulnerable_versions,
        };
        if (ghsa && IGNORED_GHSAS.has(ghsa)) ignored.push(finding);
        else hits.push(finding);
      }
    }
  }

  for (const finding of ignored) {
    console.warn('[audit] TEMPORARY EXCEPTION — ' + finding.name + ' [' + finding.severity + '] ' + (finding.ghsa || 'unknown-GHSA') + ' ' + finding.title);
  }

  if (hits.length === 0) {
    writeReport({ status: 'ok', packageCount: names.length, versionCount, findings: [], ignoredFindings: ignored });
    console.log('[audit] OK — no unexcepted high/critical advisories in production dependencies');
    process.exit(0);
  }

  writeReport({ status: 'failed', packageCount: names.length, versionCount, findings: hits, ignoredFindings: ignored });
  console.error('[audit] FAIL — ' + hits.length + ' unexcepted high/critical production advisory/advisories:');
  for (const hit of hits) {
    console.error('  - ' + hit.name + ' [' + hit.severity + '] ' + (hit.ghsa || '') + ' ' + hit.title + ' (' + hit.vulnerable_versions + ') ' + hit.url);
  }
  process.exit(1);
})();
