const express = require("express");
const dotenv = require("dotenv");
const path = require("path");
const { MongoClient } = require("mongodb");
const axios = require("axios");
const cheerio = require("cheerio");
const Anthropic = require("@anthropic-ai/sdk");

dotenv.config({ path: ".env.local" });

const app = express();
app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.VERCEL_MONGO_MONGODB_URI;

let db;

const client = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

async function connectDB() {
  const mongoClient = new MongoClient(MONGODB_URI);
  await mongoClient.connect();
  db = mongoClient.db("social-wizard");
  console.log("✅ MongoDB connected");
}

async function scrapeURL(url) {
  try {
    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    const $ = cheerio.load(data);
    
    $("script").remove();
    $("style").remove();
    
    const title = $("title").text() || $("h1").first().text() || "Untitled";
    let content = $("article").text() || 
                  $("main").text() || 
                  $(".content").text() ||
                  $(".post-content").text() ||
                  $("body").text();
    
    content = content.replace(/\s+/g, " ").trim().substring(0, 5000);
    
    return `Title: ${title}\n\nContent:\n${content}`;
  } catch (error) {
    console.error("Error scraping URL:", error.message);
    throw new Error("Failed to scrape URL: " + error.message);
  }
}

async function generateImage(postText) {
  try {
    const brandPrompt = `Modern tech illustration, dark background, purple and magenta gradient accents, minimal clean design, abstract geometric shapes, data visualization aesthetic, professional B2B SaaS style, no text, no people, subtle grid pattern, glowing purple highlights: ${postText.substring(0, 150)}`;
    
    console.log("Generating image with prompt:", brandPrompt.substring(0, 100));
    
    const response = await axios.post(
      "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell",
      { inputs: brandPrompt },
      {
        headers: {
          Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
          "Content-Type": "application/json",
          "Accept": "image/png",
        },
        responseType: "arraybuffer",
        timeout: 120000,
      }
    );
    
    console.log("Image response status:", response.status);
    console.log("Image response size:", response.data.length);
    
    const base64 = Buffer.from(response.data).toString("base64");
    return `data:image/png;base64,${base64}`;
  } catch (error) {
    console.error("Error generating image:", error.response?.status, error.response?.statusText, error.response?.data?.toString() || error.message);
    return null;
  }
}

function getLengthGuide(length) {
  switch(length) {
    case 'short': return 'STRICT: 50-100 words MAX. 5-7 sentences only. No lists. Super punchy.';
    case 'long': return '200-300 words. More depth, storytelling, can include numbered lists.';
    default: return '100-200 words. Balanced depth.';
  }
}

function getToneGuide(tone) {
  switch(tone) {
    case 'casual': return 'Casual and conversational, like texting a friend.';
    case 'inspirational': return 'Inspirational and motivating, but not cheesy.';
    case 'controversial': return 'Hot take, contrarian, challenge common beliefs. Be bold.';
    default: return 'Data-driven but warm. Confident with vulnerability.';
  }
}

async function generateLinkedInPost(contentPool, brandVoiceExamples, memory, options = {}) {
  const { topic, length, tone } = options;
  
  let selectedContent;
  if (topic) {
    selectedContent = contentPool.find(c => c.toLowerCase().includes(topic.toLowerCase())) || contentPool[Math.floor(Math.random() * contentPool.length)];
  } else {
    selectedContent = contentPool[Math.floor(Math.random() * contentPool.length)];
  }

  const memoryContext = memory.length > 0 ? `\n\nContext to remember:\n${memory.join('\n')}` : "";
  const brandContext = brandVoiceExamples.length > 0 ? `\n\nSoma's real posts to match:\n${brandVoiceExamples.slice(0, 3).join('\n\n---\n\n')}` : "";
  const lengthGuide = getLengthGuide(length);
  const toneGuide = getToneGuide(tone);
  const topicGuide = topic ? `\n\nFocus on this topic: ${topic}` : "";

  const prompt = `You are writing a LinkedIn post as Soma Toth, CEO of Recart.

SOMA'S UNIQUE VOICE - FOLLOW THIS CLOSELY:

1. WARMTH + VULNERABILITY: Start with honest admissions. "70% of my test hypotheses fail." Share struggles before wins.

2. BAIT & SWITCH: Open with something alarming or controversial, then flip it. "SMS is dying. Again. ==== Of course, none of that is happening."

3. SHORT PUNCHY SENTENCES: Use dashes (—) for dramatic pauses. "But sometimes — sometimes — we find a banger."

4. REPETITION FOR EMPHASIS: "Today is one of those days. Today is a good day."

5. SPECIFIC NUMBERS: Never say "many" or "lots". Say "2,000+ downloads", "top 10,000 Shopify stores", "700+ A/B tests".

6. NAME DROP BRANDS: Mention real brands like True Classic, Simple Modern, Her Fantasy Box when relevant.

7. CONTRARIAN + CONFIDENT: Subtle shade at "experts" who got it wrong. "as negatively as some suggested"

8. NO GENERIC PHRASES - NEVER USE:
- "Here's the thing"
- "Let me explain"
- "In today's world"
- "It's no secret that"
- "At the end of the day"
- Generic questions like "What do you think?"

9. "NOT ANOTHER FLUFFY POST" ENERGY: Be direct. Real data. Real insights. No filler.

10. VISUAL BREAKS: Use ==== or line breaks for dramatic effect.

LENGTH REQUIREMENT (MUST FOLLOW): ${lengthGuide}
TONE: ${toneGuide}${topicGuide}${brandContext}${memoryContext}

CONTENT TO BASE THE POST ON:
${selectedContent}

CRITICAL: 
- Extract REAL results from the content. Never make up numbers.
- If it failed, say it failed. Failures make great posts too.
- Write like Soma texts a friend, not like a marketing blog.
- STRICTLY follow the length requirement above.

Write the post now. No preamble. Just the post.`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    });

    return response.content[0].text;
  } catch (error) {
    console.error("Error generating post with Claude:", error);
    throw error;
  }
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.post("/api/content/add", async (req, res) => {
  const { type, content } = req.body;
  if (!type || !content) {
    return res.status(400).json({ error: "type and content required" });
  }
  try {
    await db.collection("content").insertOne({ type, content, createdAt: new Date() });
    res.json({ success: true, message: "Content added" });
  } catch (error) {
    res.status(500).json({ error: "Failed to add content" });
  }
});

app.post("/api/content/scrape-url", async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: "url required" });
  }
  try {
    const content = await scrapeURL(url);
    await db.collection("content").insertOne({ type: "scraped", content, url, createdAt: new Date() });
    res.json({ success: true, message: "Content scraped and added", preview: content.substring(0, 150) + "..." });
  } catch (error) {
    res.status(500).json({ error: "Failed to scrape URL: " + error.message });
  }
});

app.post("/api/brand/add", async (req, res) => {
  const { post } = req.body;
  if (!post) {
    return res.status(400).json({ error: "post content required" });
  }
  try {
    await db.collection("brand").insertOne({ post, createdAt: new Date() });
    res.json({ success: true, message: "Brand voice example added" });
  } catch (error) {
    res.status(500).json({ error: "Failed to add brand example" });
  }
});

app.post("/api/memory/add", async (req, res) => {
  const { note } = req.body;
  if (!note) {
    return res.status(400).json({ error: "note required" });
  }
  try {
    await db.collection("memory").insertOne({ note, createdAt: new Date() });
    res.json({ success: true, message: "Memory added" });
  } catch (error) {
    res.status(500).json({ error: "Failed to add memory" });
  }
});

app.get("/api/content/list", async (req, res) => {
  try {
    const content = await db.collection("content").find({}).toArray();
    res.json({ total: content.length, items: content });
  } catch (error) {
    res.status(500).json({ error: "Failed to retrieve content" });
  }
});

app.get("/api/brand/list", async (req, res) => {
  try {
    const brand = await db.collection("brand").find({}).toArray();
    res.json({ total: brand.length, items: brand });
  } catch (error) {
    res.status(500).json({ error: "Failed to retrieve brand examples" });
  }
});

app.get("/api/memory/list", async (req, res) => {
  try {
    const memory = await db.collection("memory").find({}).toArray();
    res.json({ total: memory.length, items: memory });
  } catch (error) {
    res.status(500).json({ error: "Failed to retrieve memory" });
  }
});

app.post("/api/generate/post", async (req, res) => {
  try {
    const { topic, length, tone, generateImage: shouldGenerateImage } = req.body;
    
    const contentDocs = await db.collection("content").find({}).toArray();
    const brandDocs = await db.collection("brand").find({}).toArray();
    const memoryDocs = await db.collection("memory").find({}).toArray();

    if (contentDocs.length === 0) {
      return res.status(400).json({ error: "No content available" });
    }

    const contentPool = contentDocs.map(d => d.content);
    const brandVoice = brandDocs.map(d => d.post);
    const memory = memoryDocs.map(d => d.note);

    const post = await generateLinkedInPost(contentPool, brandVoice, memory, { topic, length, tone });

    let imageUrl = null;
    if (shouldGenerateImage) {
      imageUrl = await generateImage(post);
    }

    res.json({
      success: true,
      post,
      imageUrl,
      contentUsed: contentPool.length,
      brandExamples: brandVoice.length,
      memoryNotes: memory.length,
    });
  } catch (error) {
    console.error("Error generating post:", error);
    res.status(500).json({ error: "Failed to generate post" });
  }
});

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/index.html`);
  });
}).catch(err => {
  console.error("Failed to connect to MongoDB:", err);
  process.exit(1);
});
