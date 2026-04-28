import { test } from '@playwright/test';
test('raw', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').first().fill(process.env['E2E_AUTH_EMAIL']!);
  await page.locator('input[type="password"]').first().fill(process.env['E2E_AUTH_PASSWORD']!);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !/\/(login|register)/.test(u.pathname), { timeout: 20_000 });
  await page.waitForTimeout(2500);
  const token = await page.evaluate(() => {
    const cookies = document.cookie.split(/;\s*/);
    const chunks: {idx:number;v:string}[] = [];
    for (const c of cookies) {
      const m = c.match(/^(sb-[^=]+-auth-token)\.(\d+)=(.+)$/);
      if (m) chunks.push({idx: parseInt(m[2]!,10), v: decodeURIComponent(m[3]!)});
    }
    chunks.sort((a,b)=>a.idx-b.idx);
    let raw = chunks.map(c=>c.v).join('');
    if (raw.startsWith('base64-')) raw = raw.slice('base64-'.length);
    return JSON.parse(atob(raw)).access_token ?? null;
  });
  const res = await page.evaluate(async ({token}) => {
    const r = await fetch('https://jak-swarm-api.onrender.com/workflows', {
      method: 'POST', headers: {'Content-Type':'application/json','Authorization':`Bearer ${token}`},
      body: JSON.stringify({goal:'I am the CMO of JAK Swarm, an AI multi-agent platform. Write a compelling LinkedIn announcement post (200-300 words) introducing our launch to enterprise buyers. Hook with a tension, list 3 concrete capabilities, end with a CTA.',industry:'GENERAL'}),
    });
    const d = await r.json();
    const wid = d.data.id;
    let text = '';
    for (let i = 0; i < 50; i++) {
      await new Promise(r=>setTimeout(r,10000));
      const g = await fetch(`https://jak-swarm-api.onrender.com/workflows/${wid}`, {headers:{'Authorization':`Bearer ${token}`}});
      text = await g.text();
      try {
        const j = JSON.parse(text);
        if (['COMPLETED','FAILED','CANCELLED'].includes(j?.data?.status)) break;
      } catch {}
    }
    return text;
  }, {token});
  try {
    const obj = JSON.parse(res);
    const w = obj.data;
    console.log(`WORKFLOW: ${w.status} ${w.goal?.slice(0,80)}`);
    console.log(`FINALOUTPUT: ${(w.finalOutput||'').slice(0,200)}`);
    for (const t of (w.traces || [])) {
      console.log(`---`);
      console.log(`TRACE ${t.agentRole} status=${t.status} err=${t.error||'-'}`);
      const o = t.output ?? {};
      for (const [k,v] of Object.entries(o)) {
        const s = typeof v === 'string' ? v : JSON.stringify(v);
        console.log(`  ${k} (${typeof v}, ${s.length} chars): ${s.slice(0, 800)}`);
      }
    }
  } catch(e) {
    console.log('PARSE_ERROR:', e, 'RAW:', res.slice(0, 2500));
  }
  await ctx.close();
});
