require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function test() {
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',  // <-- this is the correct model name right now (March 2026)
      max_tokens: 100,
      messages: [{ role: 'user', content: 'Hei, fungerer API-et nå? Svar på norsk.' }]
    });
    console.log('Success:', msg.content[0].text);
  } catch (err) {
    console.error('Error:', err.message);
  }
}

test();
