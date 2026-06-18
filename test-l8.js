require('dotenv').config({ path: '/Users/bot/peasy-auto/.env' });
(async () => {
  const ERP = 'https://api.biladministrasjon.no';
  const login = await fetch(`${ERP}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: process.env.ERP_USER, password: process.env.ERP_PASS })
  });
  const ld = await login.json();
  const token = ld.data.token;
  for (const ep of ['auction_finished', 'unfinished_contracts']) {
    const r = await fetch(`${ERP}/c2b_module/peasy/processing/${ep}?per_page=100`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
    });
    const d = await r.json();
    console.log(`=== ${ep} (status ${r.status}) ===`);
    console.log('Top keys:', Object.keys(d));
    console.log('Sample:', JSON.stringify(d).slice(0, 800));
    console.log('');
  }
})().catch(e => console.error('ERR', e.message));
