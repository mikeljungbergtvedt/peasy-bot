// test-erp-write.js — test heftelser + owners write-back
// Run from ~/peasy-auto: node test-erp-write.js

require('dotenv').config();

const TEST_ERP_ID = 1736; // CF75173 — Peugeot Partner

async function getERPToken() {
  const res = await fetch('https://api.biladministrasjon.no/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.ERP_USER, password: process.env.ERP_PASS })
  });
  const data = await res.json();
  return data.data.token.token;
}

async function test() {
  const token = await getERPToken();
  const today = new Date().toISOString().split('T')[0];

  const payload = {
    price_final_min: 70000,
    price_final_max: 77000,
    encumbrance: {
      is_checked: true,
      has_debt: false,
      comment: 'Ingen heftelser',
      date: today,
    },
    owners_check_date: today,
    owners_check_comment: null,
    owners_is_checked: true,
  };

  console.log('Sending payload:', JSON.stringify(payload, null, 2));

  const res = await fetch(`https://api.biladministrasjon.no/c2b_module/driveno/${TEST_ERP_ID}`, {
    method: 'PUT',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  console.log('Status:', res.status);
  const text = await res.text();
  console.log('Response:', text.slice(0, 500));
}

test().catch(console.error);
