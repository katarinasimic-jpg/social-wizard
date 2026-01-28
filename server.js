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

async function generateLinkedInPost(contentPool, brandVoiceExamples, memory) {
  const selectedContent = contentPool[Math.floor(Math.random() * contentPool.length)];
  const memoryContext = memory.length > 0 ? `\n\nImportant context:\n${memory.join('\n')}` : "";
  const brandContext = brandVoiceExamples.length > 0 ? `\n\nExamples:\n${brandVoiceExamples.slice(0, 3).join('\n\n---\n\n')}` : "";

  const prompt = `You are writing a LinkedIn post for Soma Toth, CEO of Recart.

CRITICAL INSTRUCTION - READ CAREFULLY:
- If content contains "The Result" or "The Conclusion" section: Use ONLY those sections to determine what's real
- If content contains "Hypothesis" or "Methodology": These are context only, NOT results
- NEVER infer results from hypothesis
- Report numbers, percentages, and outcomes EXACTLY as stated
- If something failed or was negative, say so clearly

Your task: Write ONE compelling LinkedIn post about the main finding/result in this content.

The post should:
- Lead with the actual result or key finding
- Explain WHY it matters
- Be educational and actionable
- Use Soma's voice
- Be 100-250 words${brandContext}${memoryContext}

Content:
${selectedContent}

Write the post. Report only what the content actually says.`;

  const response = await client.messages.create({
    model: "claude-opus-4-5-20251101",
    max_tokens: 500,
    messages: [{ role: "user", content: prompt }],
  });

  return response.content[0].text;
}

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
    const contentDocs = await db.collection("content").find({}).toArray();
    const brandDocs = await db.collection("brand").find({}).toArray();
    const memoryDocs = await db.collection("memory").find({}).toArray();

    if (contentDocs.length === 0) {
      return res.status(400).json({ error: "No content available" });
    }

    const contentPool = contentDocs.map(d => d.content);
    const brandVoice = brandDocs.map(d => d.post);
    const memory = memoryDocs.map(d => d.note);

    const post = await generateLinkedInPost(contentPool, brandVoice, memory);

    res.json({
      success: true,
      post,
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
