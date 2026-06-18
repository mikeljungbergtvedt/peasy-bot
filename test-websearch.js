require('dotenv').config({path:'/Users/bot/peasy-auto/.env'});
(async () => {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method:'POST',
    headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
    body: JSON.stringify({
      model:'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
      messages:[{role:'user',content:'hva slag bil er dette: KH83234. Svar med MERKE MODELL UTSTYRSNIVAA. Bruk car.info eller elbilradar.com hvis du trenger oppslag.'}]
    })
  });
  const j = await r.json();
  if (j.error) { console.log('FEIL:', j.error.message); return; }
  // Plukk ut text-blokker fra content
  const texts = (j.content||[]).filter(c => c.type === 'text').map(c => c.text).join('\n');
  console.log(texts);
})();
