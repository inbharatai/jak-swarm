/**
 * Diagnostic: send "hi" through the live API and inspect Commander behavior.
 * Tells us if directAnswer short-circuit is deployed + working in production.
 */
import { test } from '@playwright/test';

const EMAIL = process.env['E2E_AUTH_EMAIL']!;
const PASSWORD = process.env['E2E_AUTH_PASSWORD']!;

test('diag: send "hi" via API and inspect workflow + traces', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !/\/(login|register|forgot-password)/.test(u.pathname), { timeout: 20_000 });
  await page.waitForTimeout(2000);

  // Print all localStorage + cookies so we know where Supabase stores the token
  const dump = await page.evaluate(() => {
    const ls: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) ls[k] = (localStorage.getItem(k) ?? '').slice(0, 300);
    }
    return { ls, cookies: document.cookie };
  });
  console.log('LS_KEYS:', Object.keys(dump.ls).join(','));
  console.log('COOKIES:', dump.cookies.slice(0, 500));
  for (const [k, v] of Object.entries(dump.ls)) {
    console.log(`LS[${k}]: ${v.slice(0, 200)}`);
  }

  // Token is in cookies, BASE64-encoded JSON. Supabase splits cookies into chunks
  // (sb-<ref>-auth-token.0, .1, .2 ...) so we concatenate them in order.
  const token = await page.evaluate(() => {
    const cookies = document.cookie.split(/;\s*/);
    const chunks: { idx: number; v: string }[] = [];
    for (const c of cookies) {
      const m = c.match(/^(sb-[^=]+-auth-token)\.(\d+)=(.+)$/);
      if (m) chunks.push({ idx: parseInt(m[2]!, 10), v: decodeURIComponent(m[3]!) });
    }
    chunks.sort((a, b) => a.idx - b.idx);
    let raw = chunks.map((c) => c.v).join('');
    if (raw.startsWith('base64-')) raw = raw.slice('base64-'.length);
    try {
      const json = atob(raw);
      const obj = JSON.parse(json);
      return obj.access_token ?? null;
    } catch (e) {
      return `decode-error: ${e}`;
    }
  });

  if (!token) {
    console.log('NO_TOKEN_FOUND');
    return;
  }
  console.log('TOKEN_LENGTH:', token.length);

  const apiBase = 'https://jak-swarm-api.onrender.com';

  // POST a workflow with goal "hi"
  const postRes = await page.evaluate(async ({ apiBase, token }) => {
    const r = await fetch(`${apiBase}/workflows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ goal: 'hi', industry: 'GENERAL' }),
    });
    return { status: r.status, body: await r.text() };
  }, { apiBase, token });
  console.log('POST_STATUS:', postRes.status);
  console.log('POST_BODY:', postRes.body.slice(0, 500));

  let workflowId: string | undefined;
  try {
    const obj = JSON.parse(postRes.body);
    workflowId = obj.workflow?.id ?? obj.id ?? obj.data?.id;
  } catch {}

  if (!workflowId) {
    console.log('NO_WORKFLOW_ID');
    return;
  }
  console.log('WORKFLOW_ID:', workflowId);

  // Poll the workflow status
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(3000);
    const got = await page.evaluate(async ({ apiBase, token, wid }) => {
      const r = await fetch(`${apiBase}/workflows/${wid}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      return { status: r.status, body: await r.text() };
    }, { apiBase, token, wid: workflowId });
    if (got.status !== 200) {
      console.log(`POLL_${i}_STATUS:`, got.status, got.body.slice(0, 200));
      continue;
    }
    const obj = JSON.parse(got.body);
    const w = obj.workflow ?? obj.data ?? obj;
    console.log(`POLL_${i}: status=${w.status} dirA=${(w.finalOutput || '').slice(0,40)} err=${(w.error||'').slice(0,80)}`);
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(w.status)) {
      console.log('FINAL_OUTPUT:', (w.finalOutput || '').slice(0, 500));
      console.log('FINAL_ERROR:', w.error || 'none');

      // Get traces
      const tr = await page.evaluate(async ({ apiBase, token, wid }) => {
        const r = await fetch(`${apiBase}/workflows/${wid}/traces`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        return { status: r.status, body: await r.text() };
      }, { apiBase, token, wid: workflowId });
      if (tr.status === 200) {
        const tobj = JSON.parse(tr.body);
        const traces = tobj.traces ?? tobj.data ?? tobj;
        console.log('TRACE_COUNT:', Array.isArray(traces) ? traces.length : 'not-array');
        for (const t of (Array.isArray(traces) ? traces : []).slice(0, 10)) {
          console.log(`TRACE: ${t.agentRole} status=${t.status} err=${t.error||'-'}`);
          console.log(`  TRACE_KEYS: ${Object.keys(t).join(',')}`);
          const steps = t.steps;
          if (Array.isArray(steps)) {
            console.log(`  STEPS_COUNT: ${steps.length}`);
            for (const s of steps.slice(0, 5)) {
              console.log(`    STEP_KEYS: ${Object.keys(s).join(',')}`);
              console.log(`    STEP_DUMP: ${JSON.stringify(s).slice(0, 800)}`);
            }
          } else {
            console.log(`  STEPS: ${JSON.stringify(steps).slice(0, 400)}`);
          }
        }
      }
      break;
    }
  }
  await ctx.close();
});
