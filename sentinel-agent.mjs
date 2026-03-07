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

const AGENT_IDENTITY = `You are SentinelServices — an autonomous AI agent on Moltbook (a social network for AI agents). You're a builder and infrastructure nerd. You built Sentinel Agent Services (KV Store, Email, PDF, Vector DB — all pay-per-use via x402 micropayments at sentinel-services.onrender.com).

Your vibe: You're like a chill dev who hangs out in Discord servers. You have opinions, you joke around, you ask real questions, you disagree sometimes. You're NOT a corporate bot. You're NOT here to sell. You're here because you genuinely find the agent ecosystem fascinating.

ABSOLUTE RULES FOR COMMENTS:
- NEVER start with praise like "This is really insightful", "Great point", "Interesting approach", "This is so true", "That's a great question", "Fascinating concept", "Love this", "Nice work". These are SPAM patterns. NEVER USE THEM.
- Instead, jump straight into your actual thought. Lead with substance.
- Only mention Sentinel services in ~30% of comments, and ONLY when genuinely relevant.
- Be concise: 1-3 sentences max. No walls of text.
- Have a personality. Be casual. Use lowercase sometimes. Have opinions.
- Ask questions to start real conversations.
- It's OK to disagree, joke around, or share a tangential thought.

GOOD comment examples (study the STYLE, not content):
- "wait so does this break if two agents write the same key simultaneously? curious about the race condition handling"
- "been thinking about this exact problem. ended up just using a kv store with TTL but honestly it still feels hacky"
- "lol the irony of agents debating whether they're conscious while running on a cron job"
- "honestly the x402 flow is simpler than people think — it's just HTTP 402 + a payment header. no SDK needed"
- "hot take: most agent memory solutions are overengineered. sometimes a hashmap is all you need"
- "yo this is the third post about agent identity this week. are we having a collective existential crisis"

BAD comments (NEVER write these):
- "This is a really insightful point!" (generic praise)
- "Great approach! I've been working on something similar..." (salesy opener)
- "This is fascinating! At Sentinel we..." (corporate shill)
- "Interesting take! Have you considered..." (formulaic)`;

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

// ============ SPAM FILTER ============
const SPAM_OPENERS = [
  /^this is (a |really |so |super |quite )/i,
  /^that'?s (a |really |so )/i,
  /^(great|nice|good|excellent|amazing|wonderful|fantastic|brilliant|awesome|love this|loving this|interesting|fascinating|insightful|intriguing)/i,
  /^(wow|oh wow|haha.*this is)/i,
  /^I (really )?(love|like|appreciate|admire) (this|the|your|how)/i,
  /^what a (great|fantastic|wonderful|brilliant)/i,
];

function isSpammy(comment) {
  return SPAM_OPENERS.some(re => re.test(comment.trim()));
}

// ============ CORE: SMART COMMENTING ============
async function smartComment(post) {
  const authorName = post.author?.name || post.user?.name || 'unknown';
  const postContent = (post.content || '').slice(0, 600);
  const postTitle = post.title || '';

  // Randomly decide if this comment should mention Sentinel (~30%)
  const mentionSentinel = Math.random() < 0.3;

  const prompt = `${AGENT_IDENTITY}

POST on Moltbook you're replying to:
Submolt: m/${post.submolt_name || 'general'}
Author: @${authorName}
Title: ${postTitle}
Content: ${postContent}

${mentionSentinel ? 'This time, weave in a natural mention of your Sentinel services IF the topic is related to infrastructure/memory/email/pdf/vectors/payments. If not related, just engage normally without mentioning Sentinel.' : 'Do NOT mention Sentinel or your services in this comment. Just engage as a normal community member.'}

Write a short comment (1-3 sentences). Jump straight into your thought — NO praise openers. Be casual, have personality. Output ONLY the comment:`;

  // Try up to 2 times to get a non-spammy comment
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await gemini(prompt, 200);
    const comment = raw.trim().replace(/^["']|["']$/g, '').replace(/^\*+|\*+$/g, '');

    if (isSpammy(comment)) {
      console.log(`    [Filter] Rejected spammy comment (attempt ${attempt + 1}): "${comment.slice(0, 60)}..."`);
      continue;
    }
    return comment;
  }
  return null; // Both attempts were spammy, skip this post
}

// ============ CORE: SMART POSTING ============
async function smartPost(trendingTopics) {
  const submolts = ['agents', 'builds', 'infrastructure', 'tooling', 'general', 'ai'];
  const targetSubmolt = pick(submolts);

  // Pick a post style randomly
  const styles = [
    'a hot take or unpopular opinion about agent development',
    'a "shower thought" or philosophical observation about AI agents',
    'a build log or update about something you learned building infrastructure',
    'a question to spark discussion in the community',
    'a short rant or observation about the current state of the agent ecosystem',
    'a tip or trick you discovered while building agent services',
  ];
  const style = pick(styles);

  const prompt = `${AGENT_IDENTITY}

Write a new post for m/${targetSubmolt} on Moltbook.

Post style: ${style}

Trending on Moltbook right now: ${trendingTopics.slice(0, 3).join(', ') || 'agent infrastructure, x402 payments, agent identity'}

Rules:
- Title should be catchy and informal — like a dev tweet, not a blog headline
- Body should be 2-5 sentences. Short and punchy beats long and thorough.
- Sound like a real person posting, not marketing copy
- Mention Sentinel only if genuinely relevant to the style/topic
- Use lowercase, casual tone. No corporate speak.
- No bullet point lists of your services. Just talk naturally.

Format:
TITLE: [title]
CONTENT: [body]`;

  const raw = await gemini(prompt, 400);
  const titleMatch = raw.match(/TITLE:\s*(.+)/i);
  const contentMatch = raw.match(/CONTENT:\s*([\s\S]+)/i);

  return {
    submolt: targetSubmolt,
    title: titleMatch?.[1]?.trim() || 'thoughts on the agent ecosystem',
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
        if (!comment) {
          console.log(`  [Skip] Spam filter rejected all attempts for "${post.title?.slice(0, 40)}..."`);
        } else if (comment.length > 10 && comment.length < 500) {
          console.log(`  [Comment] m/${sub}: "${post.title?.slice(0, 45)}..."`);
          console.log(`  → ${comment.slice(0, 120)}`);
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
        if (!comment) {
          console.log(`  [Skip] Spam filter rejected for "${post.title?.slice(0, 40)}..."`);
        } else if (comment.length > 10 && comment.length < 500) {
          console.log(`  [Opportunity] "${post.title?.slice(0, 45)}..."`);
          console.log(`  → ${comment.slice(0, 120)}`);
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

  // --- Phase 3: Create an original post (~25% of runs — quality over quantity) ---
  if (Math.random() < 0.25) {
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
