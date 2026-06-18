(async () => {
  const ERP = 'https://api.biladministrasjon.no';
  const login = await fetch(`${ERP}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.ERP_USER, password: process.env.ERP_PASS })
  });
  const ld = await login.json();
  if (!ld.success) { console.error('Login feilet:', JSON.stringify(ld).slice(0,300)); return; }
  const token = ld.data.token;
  console.log('Token OK');
  const r = await fetch(`${ERP}/c2b_module/peasy/processing/auction_finished?per_page=100`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
  });
  const d = await r.json();
  console.log('Status:', r.status);
  console.log('Top keys:', Object.keys(d));
  console.log('data.data type:', Array.isArray(d.data?.data) ? 'ARRAY len='+d.data.data.length : typeof d.data?.data);
  console.log('data.data.data type:', Array.isArray(d.data?.data?.data) ? 'ARRAY len='+d.data.data.data.length : typeof d.data?.data?.data);
  if (Array.isArray(d.data?.data)) console.log('First reg:', d.data.data[0]?.registration_number);
  if (Array.isArray(d.data?.data?.data)) console.log('First reg (3deep):', d.data.data.data[0]?.registration_number);
})().catch(e => console.error('ERR', e.message));
