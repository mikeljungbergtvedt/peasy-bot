require('dotenv').config();
const nodemailer = require('nodemailer');
const Imap = require('imap');

const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;

if (!EMAIL_USER || !EMAIL_PASS) {
  console.error('❌ Missing EMAIL_USER or EMAIL_PASS in .env');
  process.exit(1);
}

console.log(`\n📧 Testing email: ${EMAIL_USER}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━\n');

async function testIMAP(port, tls) {
  return new Promise((resolve) => {
    console.log(`🔍 IMAP port ${port} (${tls ? 'SSL/TLS' : 'STARTTLS'})...`);
    const imap = new Imap({
      user: EMAIL_USER, password: EMAIL_PASS,
      host: 'mail.uniweb.no', port, tls,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 10000, authTimeout: 10000,
    });
    imap.once('ready', () => { console.log(`  ✅ IMAP port ${port} — connected!`); imap.end(); resolve(true); });
    imap.once('error', (err) => { console.log(`  ❌ IMAP port ${port} — ${err.message}`); resolve(false); });
    imap.connect();
  });
}

async function testSMTP(port, secure) {
  console.log(`🔍 SMTP port ${port} (${secure ? 'SSL/TLS' : 'STARTTLS'})...`);
  const t = nodemailer.createTransport({
    host: 'mail.uniweb.no', port, secure,
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
    tls: { rejectUnauthorized: false },
    connectionTimeout: 10000, greetingTimeout: 10000,
  });
  try { await t.verify(); console.log(`  ✅ SMTP port ${port} — connected!`); return true; }
  catch (err) { console.log(`  ❌ SMTP port ${port} — ${err.message}`); return false; }
}

(async () => {
  console.log('── IMAP ──────────────────');
  await testIMAP(993, true);
  await testIMAP(143, false);
  console.log('\n── SMTP ──────────────────');
  await testSMTP(465, true);
  await testSMTP(587, false);
  console.log('\n✅ Test complete');
})().catch(console.error);
