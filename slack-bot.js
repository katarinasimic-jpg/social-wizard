const { App } = require('@slack/bolt');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

dotenv.config({ path: '.env.local' });

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

const client = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

const CONTENT_DIR = path.join(process.cwd(), 'data/content');
const BRAND_DIR = path.join(process.cwd(), 'data/brand');
const MEMORY_DIR = path.join(process.cwd(), 'data/memory');

function getContentPool() {
  if (!fs.existsSync(CONTENT_DIR)) return [];
  return fs.readdirSync(CONTENT_DIR).map((file) => fs.readFileSync(path.join(CONTENT_DIR, file), 'utf-8'));
}

function getBrandVoiceExamples() {
  if (!fs.existsSync(BRAND_DIR)) return [];
  return fs.readdirSync(BRAND_DIR).map((file) => fs.readFileSync(path.join(BRAND_DIR, file), 'utf-8'));
}

function getMemory() {
  if (!fs.existsSync(MEMORY_DIR)) return [];
  return fs.readdirSync(MEMORY_DIR).map((file) => fs.readFileSync(path.join(MEMORY_DIR, file), 'utf-8'));
}

async function generateLinkedInPost(contentPool, brandVoiceExamples, memory) {
  const selectedContent = contentPool[Math.floor(Math.random() * contentPool.length)];
  const memoryContext = memory.length > 0 ? `\n\nImportant context:\n${memory.join('\n')}` : "";
  const brandContext = brandVoiceExamples.length > 0 ? `\n\nExamples:\n${brandVoiceExamples.slice(0, 3).join('\n\n---\n\n')}` : "";

  const prompt = `You are writing a LinkedIn post for Soma Toth, CEO of Recart. Write ONE engaging post about the main finding in this content. Be literal with numbers and data.${brandContext}${memoryContext}\n\nContent:\n${selectedContent}`;

  const response = await client.messages.create({
    model: 'claude-opus-4-5-20251101',
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].text;
}

app.command('/suggest-post', async ({ ack, body, client: slackClient }) => {
  await ack();
  
  try {
    const contentPool = getContentPool();
    if (contentPool.length === 0) {
      await slackClient.chat.postMessage({
        channel: body.channel_id,
        text: '❌ No content available yet.',
      });
      return;
    }

    const response = await fetch('https://social-wizard-ivory.vercel.app/api/generate/post', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
});
const data = await response.json();
const post = data.post;
    
    await slackClient.chat.postMessage({
      channel: body.channel_id,
      text: `✨ LinkedIn Post:\n\n${post}`,
    });
  } catch (error) {
    console.error('Error:', error);
    await slackClient.chat.postMessage({
      channel: body.channel_id,
      text: '❌ Error generating post.',
    });
  }
});

(async () => {
  await app.start();
  console.log('⚡ Slack bot connected!');
})();
// Keep Render happy with a port
const http = require('http');
http.createServer((req, res) => res.end('Bot running')).listen(process.env.PORT || 3000);
