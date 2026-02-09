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
    const response = await axios.post(
      "https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0",
      { inputs: `Professional LinkedIn post illustration, business, marketing, minimal, modern: ${postText.substring(0, 200)}` },
      {
        headers: {
          Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
          "Content-Type": "application/json",
        },
        responseType: "arraybuffer",
      }
    );
    
    const base64 = Buffer.from(response.data).toString("base64");
    return `data:image/png;base64,${base64}`;
  } catch (error) {
    console.error("Error generating image:", error.message);
    return null;
  }
}

function getLengthGuide(length) {
  switch(length) {
    case 'short': return '50-100 words. Punchy and tight.';
    case 'long': return '200-300 words. More depth and storytelling.';
    default: return '100-200 words. Balanced.';
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
  const length
