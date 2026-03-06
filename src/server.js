/**
 * Sentinel Agent Services — Gateway v4
 * 4-in-1: KV Store + Email Relay + PDF Generator + Vector Storage
 *
 * Payment: x402-express middleware (Coinbase x402 protocol)
 * Facilitator settles USDC on Base → our Binance wallet
 * NO upfront funding needed. Server RECEIVES money, never sends it.
 */

import express from 'express';
import { paymentMiddleware } from 'x402-express';
import { initMemoryDB, writeKey, readKey, deleteKey, listKeys, searchKeys, getUsageStats, exportNamespace, getGlobalStats } from './memory.js';
import { initEmailService, sendEmail, sendWebhook, getEmailStats } from './email.js';
import { generatePDF, getPDFStats } from './pdf.js';
import { initVectorDB, upsertVector, batchUpsert, queryVectors, getVector, deleteVector, listVectors, getVectorStats, getGlobalVectorStats } from './vectors.js';

const PORT = process.env.PORT || 4021;
const DB_PATH = process.env.DB_PATH || './sentinel.db';
const RECIPIENT = process.env.WALLET_ADDRESS || '0xaC20692711b35F3Bb020Ad02651f6eeD68C33fe7';
const facilitatorUrl = process.env.FACILITATOR_URL || 'https://x402.org/facilitator';

// ============ INIT SERVICES ============
const db = initMemoryDB(DB_PATH);
initVectorDB(db);
initEmailService();

// ============ FREE TIER (KV writes only) ============
const FREE_TIER_LIMIT = 100;

// Migrate: drop old schema if columns don't match, then create
try {
  db.prepare('SELECT key_count FROM free_tier_usage LIMIT 1').get();
} catch {
  db.exec('DROP TABLE IF EXISTS free_tier_usage');
}
db.exec(`
  CREATE TABLE IF NOT EXISTS free_tier_usage (
    wallet TEXT PRIMARY KEY,
    key_count INTEGER DEFAULT 0
  );
`);

function getFreeTierCount(wallet) {
  const row = db.prepare('SELECT key_count FROM free_tier_usage WHERE wallet = ?').get(wallet);
  return row ? row.key_count : 0;
}

function incrementFreeTier(wallet) {
  db.prepare(`
    INSERT INTO free_tier_usage (wallet, key_count) VALUES (?, 1)
    ON CONFLICT(wallet) DO UPDATE SET key_count = key_count + 1
  `).run(wallet);
}

// ============ EXPRESS APP ============
const app = express();
app.use(express.json({ limit: '10mb' }));

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,X-Wallet,X-Sender');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Request counter
let totalRequests = 0;
let startedAt = null;
app.use((req, res, next) => { totalRequests++; next(); });

// ============ x402 DISCOVERY (Bazaar + DNS) ============
app.get('/.well-known/x402.json', (req, res) => {
  res.json({
    version: '1.0',
    name: 'Sentinel Agent Services',
    description: '4-in-1 agent toolkit: KV Store, Email Relay, PDF Generator, Vector Storage. Pay-per-use with USDC on Base via x402.',
    url: `https://sentinel-services.onrender.com`,
    wallet: RECIPIENT,
    network: 'base',
    facilitator: facilitatorUrl,
    endpoints: [
      { method: 'PUT', path: '/kv/{key}', price: '$0.01', currency: 'USDC', description: 'Write a key-value pair (first 100 free per wallet)', input: { key: 'string (URL param)', value: 'any (JSON body)' }, output: { key: 'string', namespace: 'string', payment: 'object' } },
      { method: 'GET', path: '/kv/{key}', price: 'free', description: 'Read a key-value pair', input: { key: 'string (URL param)' }, output: { key: 'string', value: 'any', namespace: 'string' } },
      { method: 'POST', path: '/email/send', price: '$0.005', currency: 'USDC', description: 'Send an email', input: { to: 'string', subject: 'string', body: 'string' }, output: { success: 'boolean', messageId: 'string' } },
      { method: 'POST', path: '/pdf/generate', price: '$0.02', currency: 'USDC', description: 'Generate a PDF document', input: { title: 'string', content: 'string|array' }, output: 'application/pdf binary' },
      { method: 'POST', path: '/vectors/{namespace}/upsert', price: '$0.01', currency: 'USDC', description: 'Store a vector embedding', input: { id: 'string', vector: 'number[]', metadata: 'object' }, output: { id: 'string', dimensions: 'number' } },
      { method: 'POST', path: '/vectors/{namespace}/query', price: '$0.005', currency: 'USDC', description: 'Query vectors by similarity', input: { vector: 'number[]', topK: 'number' }, output: { results: 'array' } },
      { method: 'POST', path: '/vectors/{namespace}/batch', price: '$0.01', currency: 'USDC', description: 'Batch store vectors', input: { vectors: 'array' }, output: { inserted: 'number' } },
    ],
    tags: ['kv-store', 'email', 'pdf', 'vector-db', 'agent-memory', 'agent-tools'],
    contact: 'https://github.com/godlymane/sentinel-services',
  });
});

// ============ HEALTH (no payment) ============
app.get(['/', '/health'], (req, res) => {
  res.json({
    service: 'Sentinel Agent Services',
    version: '4.0.0',
    status: 'online',
    services: ['kv', 'email', 'pdf', 'vectors'],
    wallet: RECIPIENT,
    network: 'base',
    payment: 'x402',
    facilitator: facilitatorUrl,
    pricing: {
      'PUT /kv/:key': '$0.01 (first 100 writes free per wallet)',
      'POST /email/send': '$0.005',
      'POST /pdf/generate': '$0.02',
      'POST /vectors/:ns/upsert': '$0.01',
      'POST /vectors/:ns/query': '$0.005',
    },
    freeTier: 'First 100 KV writes free per wallet',
  });
});

// ============ STATS (no payment) ============
app.get('/stats', (req, res) => {
  res.json({
    memory: getGlobalStats(),
    email: getEmailStats(),
    pdf: getPDFStats(),
    vectors: getGlobalVectorStats(),
    totalRequests,
    startedAt,
    uptime: process.uptime(),
  });
});

// ============ FREE TIER INTERCEPTOR ============
// Runs BEFORE paymentMiddleware — if free tier available, handle request directly
app.put('/kv/:key', (req, res, next) => {
  const wallet = req.headers['x-wallet'] || req.headers['x-sender'] || 'anonymous';
  const count = getFreeTierCount(wallet);

  if (count < FREE_TIER_LIMIT) {
    // Free write — handle directly, skip paymentMiddleware
    incrementFreeTier(wallet);
    const key = req.params.key;
    const body = req.body;
    const value = body?.value !== undefined
      ? (typeof body.value === 'string' ? body.value : JSON.stringify(body.value))
      : JSON.stringify(body);
    const options = {};
    if (body?.ttl) options.ttlSeconds = body.ttl;
    const result = writeKey(wallet, key, value, options);
    return res.status(201).json({
      ...result,
      payment: { method: 'free_tier', used: count + 1, limit: FREE_TIER_LIMIT },
    });
  }

  // Free tier exhausted — fall through to paymentMiddleware
  next();
});

// ============ x402 PAYMENT MIDDLEWARE ============
// All paid routes go through here. Facilitator handles on-chain settlement.
// Agents pay USDC on Base → facilitator verifies → USDC lands in our wallet.
app.use(
  paymentMiddleware(
    RECIPIENT,
    {
      "PUT /kv/*": {
        price: "$0.01",
        network: "base",
        config: { description: "Write a key-value pair to persistent storage" },
      },
      "POST /email/send": {
        price: "$0.005",
        network: "base",
        config: { description: "Send one email" },
      },
      "POST /email/webhook": {
        price: "$0.005",
        network: "base",
        config: { description: "Send a webhook notification" },
      },
      "POST /pdf/generate": {
        price: "$0.02",
        network: "base",
        config: { description: "Generate one PDF document" },
      },
      "POST /pdf/generate/json": {
        price: "$0.02",
        network: "base",
        config: { description: "Generate one PDF (JSON response)" },
      },
      "POST /vectors/*/upsert": {
        price: "$0.01",
        network: "base",
        config: { description: "Store a vector embedding" },
      },
      "POST /vectors/*/batch": {
        price: "$0.01",
        network: "base",
        config: { description: "Batch store vectors" },
      },
      "POST /vectors/*/query": {
        price: "$0.005",
        network: "base",
        config: { description: "Query vectors by similarity" },
      },
    },
    { url: facilitatorUrl },
  )
);

// ============ KV ROUTES (paid — only reached after paymentMiddleware approves) ============

// PUT /kv/:key — paid write (free tier handler above already handled free writes)
app.put('/kv/:key', (req, res) => {
  const wallet = req.headers['x-wallet'] || req.headers['x-sender'] || 'anonymous';
  const key = req.params.key;
  const body = req.body;
  const value = body?.value !== undefined
    ? (typeof body.value === 'string' ? body.value : JSON.stringify(body.value))
    : JSON.stringify(body);
  const options = {};
  if (body?.ttl) options.ttlSeconds = body.ttl;
  const result = writeKey(wallet, key, value, options);
  res.status(201).json({ ...result, payment: { method: 'x402' } });
});

// GET /kv/:key — free reads (not in paymentMiddleware config)
app.get('/kv/:key', (req, res) => {
  const wallet = req.headers['x-wallet'] || req.headers['x-sender'] || 'anonymous';
  const result = readKey(wallet, req.params.key);
  if (!result) return res.status(404).json({ error: 'Key not found' });
  res.json(result);
});

// DELETE /kv/:key — free deletes
app.delete('/kv/:key', (req, res) => {
  const wallet = req.headers['x-wallet'] || req.headers['x-sender'] || 'anonymous';
  const result = deleteKey(wallet, req.params.key);
  res.json(result);
});

// GET /kv — list keys (free)
app.get('/kv', (req, res) => {
  const wallet = req.headers['x-wallet'] || req.headers['x-sender'] || 'anonymous';
  const limit = parseInt(req.query.limit || '100');
  const offset = parseInt(req.query.offset || '0');
  res.json(listKeys(wallet, limit, offset));
});

// GET /kv/search — search keys (free)
app.get('/kv/search', (req, res) => {
  const wallet = req.headers['x-wallet'] || req.headers['x-sender'] || 'anonymous';
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Missing q parameter' });
  res.json(searchKeys(wallet, query));
});

// GET /kv/export — export all (free)
app.get('/kv/export', (req, res) => {
  const wallet = req.headers['x-wallet'] || req.headers['x-sender'] || 'anonymous';
  res.json({ namespace: wallet, data: exportNamespace(wallet) });
});

// ============ EMAIL ROUTES ============

app.post('/email/send', async (req, res) => {
  const wallet = req.headers['x-wallet'] || 'anonymous';
  const result = await sendEmail(req.body, wallet);
  if (result.status === 429) return res.status(429).json(result);
  res.status(result.success ? 200 : 400).json(result);
});

app.post('/email/webhook', async (req, res) => {
  const wallet = req.headers['x-wallet'] || 'anonymous';
  const result = await sendWebhook(req.body, wallet);
  res.status(result.success ? 200 : 400).json(result);
});

app.get('/email/stats', (req, res) => res.json(getEmailStats()));

// ============ PDF ROUTES ============

app.post('/pdf/generate', async (req, res) => {
  const result = await generatePDF(req.body);
  if (!result.success) return res.status(400).json(result);
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Length': result.pdf.length,
    'Content-Disposition': `inline; filename="${req.body.filename || 'document.pdf'}"`,
    'X-Pages': result.pages,
    'X-Size': result.size_bytes,
  });
  res.send(result.pdf);
});

app.post('/pdf/generate/json', async (req, res) => {
  const result = await generatePDF(req.body);
  if (!result.success) return res.status(400).json(result);
  res.json({
    success: true,
    pdf_base64: result.pdf.toString('base64'),
    size_bytes: result.size_bytes,
    pages: result.pages,
  });
});

app.get('/pdf/stats', (req, res) => res.json(getPDFStats()));

// ============ VECTOR ROUTES ============

app.post('/vectors/:namespace/upsert', (req, res) => {
  const result = upsertVector(req.params.namespace, req.body.id, req.body.vector, req.body.metadata || {});
  if (result.error) return res.status(400).json(result);
  res.status(201).json(result);
});

app.post('/vectors/:namespace/batch', (req, res) => {
  const result = batchUpsert(req.params.namespace, req.body.vectors || []);
  if (result.error) return res.status(400).json(result);
  res.status(201).json(result);
});

app.post('/vectors/:namespace/query', (req, res) => {
  const result = queryVectors(req.params.namespace, req.body.vector, req.body.topK || 5, req.body.filter || null);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// Free reads
app.get('/vectors/:namespace/:id', (req, res) => {
  const result = getVector(req.params.namespace, req.params.id);
  if (!result) return res.status(404).json({ error: 'Vector not found' });
  res.json(result);
});

// Free deletes
app.delete('/vectors/:namespace/:id', (req, res) => {
  res.json(deleteVector(req.params.namespace, req.params.id));
});

// Free list
app.get('/vectors/:namespace', (req, res) => {
  const limit = parseInt(req.query.limit || '100');
  const offset = parseInt(req.query.offset || '0');
  res.json(listVectors(req.params.namespace, limit, offset));
});

// Free stats
app.get('/vectors/stats/:namespace', (req, res) => {
  res.json(getVectorStats(req.params.namespace));
});

// ============ AUTONOMOUS AGENT CRON ============
// Triggered by external cron service (cron-job.org) every 2 hours
// Runs Moltbook engagement: AI comments, posts, follows, upvotes
import { runEngagement } from '../sentinel-agent.mjs';

let lastCronRun = null;
let cronRunning = false;

app.get('/cron/engage', async (req, res) => {
  const secret = req.query.secret;
  if (secret !== (process.env.CRON_SECRET || 'sentinel-grind-2026')) {
    return res.status(401).json({ error: 'Invalid secret' });
  }

  if (cronRunning) {
    return res.json({ status: 'already_running', lastRun: lastCronRun });
  }

  cronRunning = true;
  res.json({ status: 'started', message: 'Engagement run triggered' });

  try {
    const stats = await runEngagement();
    lastCronRun = { time: new Date().toISOString(), stats };
  } catch (err) {
    lastCronRun = { time: new Date().toISOString(), error: err.message };
  } finally {
    cronRunning = false;
  }
});

app.get('/cron/status', (req, res) => {
  res.json({ cronRunning, lastCronRun });
});

// ============ 404 ============
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    docs: 'GET / for full API documentation and pricing',
  });
});

// ============ ERROR HANDLER ============
app.use((err, req, res, next) => {
  console.error(`[Error] ${req.method} ${req.path}:`, err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ============ RELIABILITY ============
process.on('SIGTERM', () => { console.log('[Sentinel] SIGTERM — shutting down'); process.exit(0); });
process.on('SIGINT', () => { console.log('[Sentinel] SIGINT — shutting down'); process.exit(0); });
process.on('uncaughtException', (err) => console.error('[Sentinel] Uncaught:', err.message));
process.on('unhandledRejection', (reason) => console.error('[Sentinel] Unhandled:', reason));

// ============ START ============
app.listen(PORT, '0.0.0.0', () => {
  startedAt = new Date().toISOString();
  console.log(`[Sentinel] Online at http://0.0.0.0:${PORT}`);
  console.log(`[Sentinel] Wallet: ${RECIPIENT}`);
  console.log(`[Sentinel] Facilitator: ${facilitatorUrl}`);
  console.log(`[Sentinel] KV:      PUT /kv/:key ($0.01, first 100 free)`);
  console.log(`[Sentinel] Email:   POST /email/send ($0.005)`);
  console.log(`[Sentinel] PDF:     POST /pdf/generate ($0.02)`);
  console.log(`[Sentinel] Vectors: POST /vectors/:ns/upsert ($0.01), /query ($0.005)`);
  console.log(`[Sentinel] x402 payment: agents pay → facilitator settles → USDC in wallet`);
});
