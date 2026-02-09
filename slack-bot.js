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

// Open modal when /suggest-post is called
app.command('/suggest-post', async ({ ack, body, client }) => {
  await ack();
  
  try {
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'generate_post_modal',
        title: { type: 'plain_text', text: '✨ Generate Post' },
        submit: { type: 'plain_text', text: 'Generate' },
        close: { type: 'plain_text', text: 'Cancel' },
        private_metadata: body.channel_id,
        blocks: [
          {
            type: 'input',
            block_id: 'topic_block',
            optional: true,
            element: {
              type: 'plain_text_input',
              action_id: 'topic_input',
              placeholder: { type: 'plain_text', text: 'e.g. popup optimization, SMS costs...' }
            },
            label: { type: 'plain_text', text: 'Topic (optional)' }
          },
          {
            type: 'input',
            block_id: 'length_block',
            element: {
              type: 'static_select',
              action_id: 'length_select',
              initial_option: { text: { type: 'plain_text', text: 'Medium (100-200 words)' }, value: 'medium' },
              options: [
                { text: { type: 'plain_text', text: 'Short (50-100 words)' }, value: 'short' },
                { text: { type: 'plain_text', text: 'Medium (100-200 words)' }, value: 'medium' },
                { text: { type: 'plain_text', text: 'Long (200-300 words)' }, value: 'long' }
              ]
            },
            label: { type: 'plain_text', text: 'Length' }
          },
          {
            type: 'input',
            block_id: 'tone_block',
            element: {
              type: 'static_select',
              action_id: 'tone_select',
              initial_option: { text: { type: 'plain_text', text: 'Data-driven (Soma\'s default)' }, value: 'data-driven' },
              options: [
                { text: { type: 'plain_text', text: 'Data-driven (Soma\'s default)' }, value: 'data-driven' },
                { text: { type: 'plain_text', text: 'Casual & conversational' }, value: 'casual' },
                { text: { type: 'plain_text', text: 'Inspirational' }, value: 'inspirational' },
                { text: { type: 'plain_text', text: 'Controversial / Hot take' }, value: 'controversial' }
              ]
            },
            label: { type: 'plain_text', text: 'Tone' }
          }
        ]
      }
    });
  } catch (error) {
    console.error('Error opening modal:', error);
  }
});

// Handle modal submission
app.view('generate_post_modal', async ({ ack, body, view, client }) => {
  await ack();
  
  const channelId = view.private_metadata;
  const topic = view.state.values.topic_block?.topic_input?.value || '';
  const length = view.state.values.length_block.length_select.selected_option.value;
  const tone = view.state.values.tone_block.tone_select.selected_option.value;
  
  try {
    // Send "generating" message
    await client.chat.postMessage({
      channel: channelId,
      text: '⏳ Generating your LinkedIn post...'
    });
    
    // Call Vercel API with options
    const response = await fetch('https://social-wizard-ivory.vercel.app/api/generate/post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, length, tone, generateImage: false })
    });
    
    const data = await response.json();
    
    if (data.post) {
      await client.chat.postMessage({
        channel: channelId,
        text: `✨ *LinkedIn Post*\n\n${data.post}\n\n_Settings: ${length}, ${tone}${topic ? ', topic: ' + topic : ''}_`
      });
    } else {
      await client.chat.postMessage({
        channel: channelId,
        text: '❌ Error: ' + (data.error || 'No post generated')
      });
    }
  } catch (error) {
    console.error('Error:', error);
    await client.chat.postMessage({
      channel: channelId,
      text: '❌ Error generating post.'
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
