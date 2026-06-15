import 'dotenv/config';
const TG_TOKEN = process.env.TELEGRAM_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;
export async function sendTelegram(text, reply_markup) {
  try {
    const body = {
      chat_id: TG_CHAT,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };
    if (reply_markup) body.reply_markup = reply_markup;
    const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) console.error('[sendTelegram]', r.status, await r.text());
  } catch (e) { console.error('[sendTelegram]', e.message); }
}
