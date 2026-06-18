require('dotenv').config();
(async () => {
  const BASE = 'https://api.biladministrasjon.no';
  const lr = await fetch(BASE + '/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({email:process.env.ERP_USER,password:process.env.ERP_PASS}) });
  const lj = await lr.json();
  const token = lj.data && lj.data.token;
  if (!token) { console.log('LOGIN FAIL:', JSON.stringify(lj).slice(0,400)); return; }
  console.log('Login OK');
  const ids = [2713, 2719, 2720, 2721, 2723, 2735];
  for (const id of ids) {
    try {
      const r = await fetch(BASE + '/c2b_module/peasy/processing/update/' + id + '/sd_received', { method:'PUT', headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'}, body: JSON.stringify({price_temp_min:null,price_temp_max:null,purchase_price_estimate_min:null,purchase_price_estimate_max:null,change_status:true}) });
      const body = await r.text();
      console.log(id, 'Status:', r.status, '-', body.slice(0,200));
    } catch (e) {
      console.log(id, 'CATCH:', e.message);
    }
  }
})();
