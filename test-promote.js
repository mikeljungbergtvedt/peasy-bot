require('dotenv').config({path:'/Users/bot/peasy-auto/.env'});
(async () => {
  const ERP_USER = process.env.ERP_USER;
  const ERP_PASS = process.env.ERP_PASS;
  const ERP_BASE = process.env.ERP_BASE || 'https://api.biladministrasjon.no';
  console.log('ERP_BASE:', ERP_BASE);
  console.log('ERP_USER:', ERP_USER ? 'SET' : 'MISSING');
  const lr = await fetch(ERP_BASE + '/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({email:ERP_USER,password:ERP_PASS}) });
  const lj = await lr.json();
  const token = lj.data && lj.data.token;
  console.log('Login:', token ? 'OK' : 'FAILED');
  if (!token) { console.log(JSON.stringify(lj,null,2)); return; }
  const r = await fetch(ERP_BASE + '/c2b_module/peasy/processing/update/2713/sd_received', { method:'PUT', headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'}, body: JSON.stringify({price_temp_min:null,price_temp_max:null,purchase_price_estimate_min:null,purchase_price_estimate_max:null,change_status:true}) });
  console.log('Status:', r.status, r.statusText);
  const t = await r.text();
  console.log('Body:', t.slice(0, 1000));
})().catch(e => console.error('FAIL:', e.message));
