import 'dotenv/config';
import { createRequire } from 'module';
const { telegramSendMessage } = createRequire(import.meta.url)('../shared/outbound.js');
const TG_TOKEN = process.env.TELEGRAM_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;
export async function sendTelegram(text, reply_markup) {
  try {
    const r = await telegramSendMessage(TG_TOKEN, TG_CHAT, text, { reply_markup });
    if (!r.ok) console.error('[sendTelegram]', r.status, await r.text());
  } catch (e) { console.error('[sendTelegram]', e.message); }
}
