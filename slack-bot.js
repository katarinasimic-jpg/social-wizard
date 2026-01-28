const { App } = require('@slack/bolt');
const dotenv = require('dotenv');
const http = require('http');

dotenv.config({ path: '.env.local' });

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

app.command('/suggest-post', async ({ ack, body, client: slackClient }) => {
  await ack();
  
  try {
    const response = await fetch('https://social-wizard-ivory.vercel.app/api/generate/post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await response.json();
    
    if (data.post) {
      await slackClient.chat.postMessage({
        channel: body.channel_id,
        text: `✨ LinkedIn Post:\n\n${data.post}`,
      });
    } else {
      await slackClient.chat.postMessage({
        channel: body.channel_id,
        text: '❌ Error: ' + (data.error || 'No post generated'),
      });
    }
  } catch (error) {
    console.error('Error:', error);
    await slackClient.chat.postMessage({
      channel: body.channel_id,
      text: '❌ Error generating post.',
    });
  }
});

// Start the bot
(async () => {
  await app.start();
  console.log('⚡ Slack bot connected!');
})();

// Keep Render happy with a port
http.createServer((req, res) => res.end('Bot running')).listen(process.env.PORT || 3000);
