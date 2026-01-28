const express = require("express");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const cheerio = require("cheerio");

dotenv.config({ path: ".env.local" });

const app = express();
app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

const CONTENT_DIR = path.join(process.cwd(), "data/content");
const BRAND_DIR = path.join(process.cwd(), "data/brand");
const MEMORY_DIR = path.join(process.cwd(), "data/memory");
const TRENDING_FILE = path.join(process.cwd(), "data/trending.txt");

[CONTENT_DIR, BRAND_DIR, MEMORY_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

function getContentPool() {
  if (!fs.existsSync(CONTENT_DIR)) return [];
  return fs
    .readdirSync(CONTENT_DIR)
    .map((file) => fs.readFileSync(path.join(CONTENT_DIR, file), "utf-8"));
}

function getBrandVoiceExamples() {
  if (!fs.existsSync(BRAND_DIR)) return [];
  return fs
    .readdirSync(BRAND_DIR)
    .map((file) => fs.readFileSync(path.join(BRAND_DIR, file), "utf-8"));
}

function getMemory() {
  if (!fs.existsSync(MEMORY_DIR)) return [];
  return fs
    .readdirSync(MEMORY_DIR)
    .map((file) => fs.readFileSync(path.join(MEMORY_DIR, file), "utf-8"));
}

function getTrendingTopics() {
  if (!fs.existsSync(TRENDING_FILE)) return "";
  return fs.readFileSync(TRENDING_FILE, "utf-8").trim();
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

function getAllContent() {
  const files = fs.readdirSync(CONTENT_DIR);
  return files.map((file) => ({
    filename: file,
    content: fs.readFileSync(path.join(CONTENT_DIR, file), "utf-8"),
  }));
}

function getAllBrandExamples() {
  const files = fs.readdirSync(BRAND_DIR);
  return files.map((file) => ({
    filename: file,
    content: fs.readFileSync(path.join(BRAND_DIR, file), "utf-8"),
  }));
}

function getAllMemory() {
  const files = fs.readdirSync(MEMORY_DIR);
  return files.map((file) => ({
    filename: file,
    content: fs.readFileSync(path.join(MEMORY_DIR, file), "utf-8"),
  }));
}

const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

async function generateLinkedInPost(contentPool, brandVoiceExamples, memory, trendingTopics) {
  const selectedContent =
    contentPool[Math.floor(Math.random() * contentPool.length)];

  const memoryContext =
    memory.length > 0
      ? `\n\nImportant context to remember:\n${memory.join("\n")}`
      : "";

  const brandContext =
    brandVoiceExamples.length > 0
      ? `\n\nHere are examples of Soma's LinkedIn posting style to match:\n${brandVoiceExamples
          .slice(0, 3)
          .join("\n\n---\n\n")}`
      : "";

  const trendingContext =
    trendingTopics && trendingTopics.length > 0
      ? `\n\nCurrently trending topics (from Tringify):\n${trendingTopics}\n\nTry to connect the content to one of these trending topics if possible.`
      : "";

  const prompt = `You are writing a LinkedIn post for Soma Toth, CEO of Recart.

CRITICAL INSTRUCTION - READ CAREFULLY:
- If content contains "The Result" or "The Conclusion" section: Use ONLY those sections to determine what's real
- If content contains "Hypothesis" or "Methodology": These are context only, NOT results
- NEVER infer results from hypothesis. If hypothesis says X will happen, but results say Y happened, report Y
- If you cannot find clear results/conclusions, ask for clarification instead of making up data
- Report numbers, percentages, and outcomes EXACTLY as stated. Do not round or interpret
- If something failed or was negative, say so clearly. Do not reframe failures as successes

Your task: Write ONE compelling LinkedIn post about the main finding/result in this content.

The post should:
- Lead with the actual result or key finding
- Explain WHY it matters
- Be educational and actionable
- Use Soma's voice (direct, data-driven, practical)
- Be 100-250 words
- End with insight or question${brandContext}${memoryContext}${trendingContext}

Content:
${selectedContent}

Write the post. Report only what the content actually says.`;

  try {
    const response = await client.messages.create({
      model: "claude-opus-4-5-20251101",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const postContent = response.content[0];
    if (postContent.type === "text") {
      return postContent.text;
    }
  } catch (error) {
    console.error("Error generating post with Claude:", error);
    throw error;
  }
}

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

app.post("/api/content/add", (req, res) => {
  const { type, content } = req.body;

  if (!type || !content) {
    return res.status(400).json({ error: "type and content required" });
  }

  try {
    const filename = `${type}_${Date.now()}.txt`;
    const filepath = path.join(CONTENT_DIR, filename);
    fs.writeFileSync(filepath, content, "utf-8");
    res.json({
      success: true,
      message: "Content added",
      filename,
    });
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
    const filename = `scraped_${Date.now()}.txt`;
    const filepath = path.join(CONTENT_DIR, filename);
    fs.writeFileSync(filepath, content, "utf-8");
    
    res.json({
      success: true,
      message: "Content scraped and added",
      filename,
      preview: content.substring(0, 150) + "..."
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to scrape URL: " + error.message });
  }
});

app.post("/api/brand/add", (req, res) => {
  const { post } = req.body;

  if (!post) {
    return res.status(400).json({ error: "post content required" });
  }

  try {
    const filename = `brand_${Date.now()}.txt`;
    const filepath = path.join(BRAND_DIR, filename);
    fs.writeFileSync(filepath, post, "utf-8");
    res.json({
      success: true,
      message: "Brand voice example added",
      filename,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to add brand example" });
  }
});

app.post("/api/memory/add", (req, res) => {
  const { note } = req.body;

  if (!note) {
    return res.status(400).json({ error: "note required" });
  }

  try {
    const filename = `memory_${Date.now()}.txt`;
    const filepath = path.join(MEMORY_DIR, filename);
    fs.writeFileSync(filepath, note, "utf-8");
    res.json({
      success: true,
      message: "Memory added",
      filename,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to add memory" });
  }
});

app.post("/api/trending/set", (req, res) => {
  const { topics } = req.body;

  if (!topics) {
    return res.status(400).json({ error: "topics required" });
  }

  try {
    fs.writeFileSync(TRENDING_FILE, topics, "utf-8");
    res.json({
      success: true,
      message: "Trending topics updated",
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to update trending topics" });
  }
});

app.get("/api/trending/get", (req, res) => {
  try {
    const topics = getTrendingTopics();
    res.json({
      topics,
      isEmpty: !topics || topics.length === 0,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to retrieve trending topics" });
  }
});

app.post("/api/trending/clear", (req, res) => {
  try {
    if (fs.existsSync(TRENDING_FILE)) {
      fs.unlinkSync(TRENDING_FILE);
    }
    res.json({
      success: true,
      message: "Trending topics cleared",
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to clear trending topics" });
  }
});

app.get("/api/content/list", (req, res) => {
  try {
    const content = getAllContent();
    res.json({
      total: content.length,
      items: content,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to retrieve content" });
  }
});

app.get("/api/brand/list", (req, res) => {
  try {
    const brand = getAllBrandExamples();
    res.json({
      total: brand.length,
      items: brand,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to retrieve brand examples" });
  }
});

app.get("/api/memory/list", (req, res) => {
  try {
    const memory = getAllMemory();
    res.json({
      total: memory.length,
      items: memory,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to retrieve memory" });
  }
});

app.post("/api/generate/post", async (req, res) => {
  try {
    const contentPool = getContentPool();
    const brandVoice = getBrandVoiceExamples();
    const memory = getMemory();
    const trending = getTrendingTopics();

    if (contentPool.length === 0) {
      return res.status(400).json({
        error: "No content available. Please upload content first.",
      });
    }

    const post = await generateLinkedInPost(contentPool, brandVoice, memory, trending);

    res.json({
      success: true,
      post,
      contentUsed: contentPool.length,
      brandExamples: brandVoice.length,
      memoryNotes: memory.length,
      trendingUsed: trending ? true : false,
    });
  } catch (error) {
    console.error("Error generating post:", error);
    res.status(500).json({ error: "Failed to generate post" });
  }
});

app.post("/api/slack/post", async (req, res) => {
  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ error: "text required" });
  }
  try {
    const { WebClient } = require("@slack/web-api");
    const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
    
    await slackClient.chat.postMessage({
      channel: process.env.SLACK_CHANNEL || "#general",
      text: text
    });
    
    res.json({ success: true, message: "Posted to Slack" });
  } catch (error) {
    console.error("Error posting to Slack:", error);
    res.status(500).json({ error: "Failed to post to Slack" });
  }
});
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}/index.html`);
  console.log(`💚 Health check: http://localhost:${PORT}/health`);
});
