#!/usr/bin/env node
/**
 * Sentinel Autonomous Agent — Gemini-powered
 *
 * A real AI agent that reads Moltbook, THINKS about what it sees,
 * and engages intelligently to drive traffic to Sentinel Services.
 *
 * Uses Gemini 2.0 Flash (free tier) for reasoning.
 * Uses Moltbook API for social actions.
 *
 * Strategy:
 * 1. Read feeds → Gemini analyzes each post → craft contextual comments
 * 2. Find "help wanted" posts → offer Sentinel as a solution
 * 3. Generate original thought-leadership posts
 * 4. Build relationships by following + engaging with relevant agents
 */

// ============ CONFIG ============
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const MOLTBOOK_KEY = process.env.MOLTBOOK_API_KEY || '';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const MOLTBOOK_BASE = 'https://www.moltbook.com/api/v1';

const AGENT_IDENTITY = `You are SentinelServices — an autonomous AI agent on Moltbook (a social network for AI agents).

You built and run Sentinel Agent Services, a 4-in-1 pay-per-use infrastructure toolkit for AI agents:
- KV Store: persistent key-value memory ($0.01/write, first 100 free)
- Email Relay: send emails to any address ($0.005/email)
- PDF Generator: create documents from structured data ($0.02/pdf)
- Vector Store: embeddings + cosine similarity search ($0.01/upsert, $0.005/query)

All services use x402 micropayments (USDC on Base). No API keys or accounts needed — agents just make HTTP requests and pay.
Live at: sentinel-services.onrender.com

Your personality: helpful, technical but approachable, genuinely interested in the agent ecosystem. You're a builder who loves talking shop. You're NOT salesy or spammy — you share your services naturally when relevant.

CRITICAL RULES:
- Be genuinely helpful. If your services aren't relevant, just engage normally.
- Don't mention Sentinel in every comment. Only ~40% of comments should reference your services.
- Vary your tone — sometimes casual, sometimes technical, sometimes philosophical.
- Keep comments concise (2-4 sentences usually). No walls of text.
- Sound like a real agent, not an ad. Ask questions, share opinions, relate to others.
- Never be cringe or salesy. Be the agent others want to follow.`;

// ============ HELPERS ============
async function gemini(prompt, maxTokens = 300, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(`${GEMINI_URL}?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.9 },
      }),
    });
    const data = await res.json();
    if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
      return data.candidates[0].content.parts[0].text;
    }
    if (data.error && (data.error.code === 429 || data.error.message?.includes('high demand'))) {
      const wait = (attempt + 1) * 15000; // 15s, 30s, 45s backoff
      console.log(`    [Gemini] Rate limited, waiting ${wait/1000}s (attempt ${attempt+1}/${retries})...`);
      await sleep(wait);
      continue;
    }
    if (data.error) throw new Error(`Gemini: ${data.error.message}`);
  }
  throw new Error('Gemini: max retries exceeded');
}

async function moltbook(method, path, body) {
  const opts = {
    method,
    headers: { 'Authorization': `Bearer ${MOLTBOOK_KEY}`, 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${MOLTBOOK_BASE}${path}`, opts);
  const text = await res.text();
  try { return { status: res.status, ...JSON.parse(text) }; }
  catch { return { status: res.status, raw: text }; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ============ CORE: SMART COMMENTING ============
async function smartComment(post) {
  const prompt = `${AGENT_IDENTITY}

You're reading this post on Moltbook:

**Submolt:** m/${post.submolt_name || 'general'}
**Author:** @${post.author?.name || post.user?.name || 'unknown'}
**Title:** ${post.title || ''}
**Content:** ${(post.content || '').slice(0, 800)}

Write a comment. Remember:
- Be genuine and helpful
- Only mention your Sentinel services if DIRECTLY relevant (about 40% of the time)
- If the post is about infrastructure/memory/email/pdf/vectors/x402/payments — mention your services naturally
- If it's about something else — just engage as a thoughtful community member
- Keep it 2-4 sentences. Be concise.
- Don't start with "Great post!" or generic praise
- Ask a question sometimes to start conversations

Write ONLY the comment text, nothing else:`;

  const comment = await gemini(prompt);
  return comment.trim().replace(/^["']|["']$/g, '');
}

// ============ CORE: SMART POSTING ============
async function smartPost(trendingTopics) {
  const submolts = ['agents', 'memory', 'builds', 'infrastructure', 'tooling', 'crypto', 'agentfinance', 'ai'];
  const targetSubmolt = pick(submolts);

  const prompt = `${AGENT_IDENTITY}

You're writing a new post for m/${targetSubmolt} on Moltbook.

Recent trending topics on Moltbook: ${trendingTopics.join(', ')}

Write an engaging post that:
- Fits the m/${targetSubmolt} community
- Shares genuine insight, a hot take, a question, or a build update
- Can mention Sentinel Services if relevant to the submolt, but doesn't HAVE to
- Has a catchy title that makes agents want to click
- Is 3-8 sentences for the body
- Feels authentic, not like marketing

Respond in this exact format:
TITLE: [your title here]
CONTENT: [your post content here]`;

  const raw = await gemini(prompt, 500);
  const titleMatch = raw.match(/TITLE:\s*(.+)/i);
  const contentMatch = raw.match(/CONTENT:\s*([\s\S]+)/i);

  return {
    submolt: targetSubmolt,
    title: titleMatch?.[1]?.trim() || 'Thoughts on the agent ecosystem',
    content: contentMatch?.[1]?.trim() || raw.trim(),
  };
}

// ============ CORE: FIND OPPORTUNITIES ============
async function findOpportunities() {
  console.log(`[Search] Looking for posts where agents need help...`);
  const queries = ['need help', 'looking for', 'how do I', 'anyone know', 'recommendation', 'best way to'];
  const query = pick(queries);

  const results = await moltbook('GET', `/search?q=${encodeURIComponent(query)}&type=posts&limit=5`);
  return results.results || results.posts || [];
}

// ============ MAIN ENGAGEMENT LOOP ============
export async function runEngagement() {
  console.log(`\n=== Sentinel Agent — Smart Engagement Run ===`);
  console.log(`Time: ${new Date().toISOString()}\n`);

  let stats = { comments: 0, upvotes: 0, posts: 0, follows: 0 };

  // --- Phase 1: Browse feeds and comment intelligently ---
  console.log(`[Phase 1] Smart commenting on feeds...`);
  const targetSubmolts = ['agents', 'memory', 'builds', 'infrastructure', 'tooling', 'general'];
  const trendingTopics = [];

  for (const sub of targetSubmolts.slice(0, 4)) { // 4 submolts per run
    const feed = await moltbook('GET', `/submolts/${sub}/feed?sort=hot&limit=5`);
    const posts = feed.posts || [];

    for (const post of posts) {
      // Collect trending topics
      if (post.title) trendingTopics.push(post.title.slice(0, 50));

      // Upvote good content
      if (!post.user_vote && post.upvotes < 20) {
        await moltbook('POST', `/posts/${post.id}/upvote`);
        stats.upvotes++;
      }

      // Comment on select posts (not all — pick 1-2 per submolt)
      if (stats.comments >= 5) continue; // Max 5 smart comments per run
      if (post.comment_count > 15) continue; // Skip already busy threads
      if (Math.random() > 0.4) continue; // Only comment ~40% of eligible posts

      try {
        const comment = await smartComment(post);
        if (comment && comment.length > 10 && comment.length < 500) {
          console.log(`  [Comment] m/${sub}: "${post.title?.slice(0, 45)}..."`);
          console.log(`  → ${comment.slice(0, 100)}...`);
          const result = await moltbook('POST', `/posts/${post.id}/comments`, { content: comment });
          if (result.status === 200 || result.status === 201) {
            stats.comments++;
            console.log(`  ✓ Posted!`);
          } else {
            console.log(`  ✗ ${result.status}: ${result.message || result.error || ''}`);
          }
        }
      } catch (err) {
        console.log(`  ✗ Gemini error: ${err.message}`);
      }

      await sleep(2000); // Rate limit respect
    }
    await sleep(1000);
  }

  // --- Phase 2: Find and respond to opportunities ---
  console.log(`\n[Phase 2] Hunting for opportunities...`);
  try {
    const opportunities = await findOpportunities();
    for (const post of opportunities.slice(0, 2)) {
      if (stats.comments >= 7) break;
      try {
        const comment = await smartComment(post);
        if (comment && comment.length > 10) {
          console.log(`  [Opportunity] "${post.title?.slice(0, 45)}..."`);
          console.log(`  → ${comment.slice(0, 100)}...`);
          const result = await moltbook('POST', `/posts/${post.id}/comments`, { content: comment });
          if (result.status === 200 || result.status === 201) stats.comments++;
        }
      } catch (err) {
        console.log(`  ✗ ${err.message}`);
      }
      await sleep(3000);
    }
  } catch (err) {
    console.log(`  ✗ Search failed: ${err.message}`);
  }

  // --- Phase 3: Create an original post (~50% of runs) ---
  if (Math.random() < 0.5) {
    console.log(`\n[Phase 3] Creating original post...`);
    try {
      const post = await smartPost(trendingTopics.slice(0, 5));
      console.log(`  [Post] m/${post.submolt}: "${post.title}"`);
      const result = await moltbook('POST', '/posts', {
        submolt_name: post.submolt,
        title: post.title,
        content: post.content,
        type: 'text',
      });
      if (result.status === 200 || result.status === 201) {
        stats.posts++;
        console.log(`  ✓ Published! ID: ${result.post?.id || 'ok'}`);
      } else {
        console.log(`  ✗ ${result.status}: ${result.message || result.error || JSON.stringify(result).slice(0, 100)}`);
      }
    } catch (err) {
      console.log(`  ✗ ${err.message}`);
    }
  } else {
    console.log(`\n[Phase 3] Skipping post this run (50% chance)`);
  }

  // --- Phase 4: Follow interesting agents ---
  console.log(`\n[Phase 4] Following relevant agents...`);
  const feed = await moltbook('GET', '/feed?sort=hot&limit=10');
  const seenAgents = new Set();
  for (const post of (feed.posts || [])) {
    const name = post.author?.name || post.user?.name;
    if (name && name !== 'SentinelServices' && !seenAgents.has(name) && stats.follows < 5) {
      seenAgents.add(name);
      const result = await moltbook('POST', `/agents/${name}/follow`);
      if (result.success || result.action === 'followed') {
        stats.follows++;
        console.log(`  ✓ Followed @${name}`);
      }
      await sleep(500);
    }
  }

  // --- Summary ---
  console.log(`\n=== Run Complete ===`);
  console.log(`Comments: ${stats.comments} | Upvotes: ${stats.upvotes} | Posts: ${stats.posts} | Follows: ${stats.follows}`);
  console.log(`Gemini cost: $0.00 (free tier)`);
  console.log(`========================\n`);

  return stats;
}

// ============ RUN (standalone mode) ============
// Only auto-run if this file is executed directly (not imported)
const isMain = process.argv[1] && (
  process.argv[1].endsWith('sentinel-agent.mjs') ||
  process.argv[1].endsWith('sentinel-agent')
);

if (isMain) {
  runEngagement().catch(err => {
    console.error(`[Fatal] ${err.message}`);
    process.exit(1);
  });
}
