require('dotenv').config();

async function getERPToken() {
  const res = await fetch('https://api.biladministrasjon.no/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.ERP_USER, password: process.env.ERP_PASS })
  });
  const data = await res.json();
  return data.data.token.token;
}

async function main() {
  const token = await getERPToken();
  console.log('✅ Token obtained');
  for (const endpoint of ['estimating_ar_final', 'estimating_ar_temp']) {
    const res = await fetch(`https://api.biladministrasjon.no/c2b_module/driveno/processing/${endpoint}?per_page=50`, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const data = await res.json();
    const list = data.data?.data?.data || [];
    console.log(`${endpoint}: ${list.length} cars`);
    list.forEach(c => console.log(' ', c.id, c.registration_number, c.manufacturer, c.model_series, c.model_year, c.mileage, 'comment:', c.has_sd_comment));
  }
}

main().catch(console.error);
