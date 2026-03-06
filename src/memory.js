/**
 * Agent Memory-as-a-Service
 * Persistent key-value store for AI agents.
 * SQLite backend, x402 payments, free tier (100 writes).
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

let db;

export function initMemoryDB(dbPath) {
  const Database = require('better-sqlite3');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory (
      namespace TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      content_type TEXT DEFAULT 'text/plain',
      size_bytes INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT DEFAULT NULL,
      PRIMARY KEY (namespace, key)
    );

    CREATE INDEX IF NOT EXISTS idx_memory_ns ON memory(namespace);
    CREATE INDEX IF NOT EXISTS idx_memory_updated ON memory(updated_at);
    CREATE INDEX IF NOT EXISTS idx_memory_expires ON memory(expires_at);

    CREATE TABLE IF NOT EXISTS usage_stats (
      namespace TEXT NOT NULL,
      total_writes INTEGER DEFAULT 0,
      total_reads INTEGER DEFAULT 0,
      total_bytes INTEGER DEFAULT 0,
      last_activity TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (namespace)
    );

    CREATE TABLE IF NOT EXISTS access_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      namespace TEXT,
      operation TEXT,
      key TEXT,
      paid_amount INTEGER DEFAULT 0,
      timestamp TEXT DEFAULT (datetime('now'))
    );
  `);

  // Clean expired keys periodically
  setInterval(() => {
    db.prepare("DELETE FROM memory WHERE expires_at IS NOT NULL AND expires_at < datetime('now')").run();
  }, 60000);

  return db;
}

// PUT /memory/:namespace/:key
export function writeKey(namespace, key, value, options = {}) {
  const { contentType = 'text/plain', ttlSeconds = null } = options;
  const sizeBytes = Buffer.byteLength(value, 'utf8');
  const expiresAt = ttlSeconds
    ? new Date(Date.now() + ttlSeconds * 1000).toISOString()
    : null;

  db.prepare(`
    INSERT INTO memory (namespace, key, value, content_type, size_bytes, updated_at, expires_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'), ?)
    ON CONFLICT(namespace, key) DO UPDATE SET
      value = excluded.value,
      content_type = excluded.content_type,
      size_bytes = excluded.size_bytes,
      updated_at = datetime('now'),
      expires_at = excluded.expires_at
  `).run(namespace, key, value, contentType, sizeBytes, expiresAt);

  // Update usage stats
  db.prepare(`
    INSERT INTO usage_stats (namespace, total_writes, total_bytes, last_activity)
    VALUES (?, 1, ?, datetime('now'))
    ON CONFLICT(namespace) DO UPDATE SET
      total_writes = total_writes + 1,
      total_bytes = total_bytes + ?,
      last_activity = datetime('now')
  `).run(namespace, sizeBytes, sizeBytes);

  return { namespace, key, size_bytes: sizeBytes, expires_at: expiresAt };
}

// GET /memory/:namespace/:key
export function readKey(namespace, key) {
  const row = db.prepare('SELECT * FROM memory WHERE namespace = ? AND key = ?').get(namespace, key);
  if (!row) return null;

  // Check expiration
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    db.prepare('DELETE FROM memory WHERE namespace = ? AND key = ?').run(namespace, key);
    return null;
  }

  // Update read stats
  db.prepare(`
    UPDATE usage_stats SET total_reads = total_reads + 1, last_activity = datetime('now')
    WHERE namespace = ?
  `).run(namespace);

  return row;
}

// DELETE /memory/:namespace/:key
export function deleteKey(namespace, key) {
  const result = db.prepare('DELETE FROM memory WHERE namespace = ? AND key = ?').run(namespace, key);
  return { deleted: result.changes > 0 };
}

// GET /memory/:namespace (list keys)
export function listKeys(namespace, limit = 100, offset = 0) {
  const rows = db.prepare(
    'SELECT key, content_type, size_bytes, updated_at, expires_at FROM memory WHERE namespace = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?'
  ).all(namespace, limit, offset);

  const count = db.prepare('SELECT COUNT(*) as total FROM memory WHERE namespace = ?').get(namespace);
  return { keys: rows, total: count.total, limit, offset };
}

// GET /memory/search?q=...&namespace=...
export function searchKeys(namespace, query, limit = 20) {
  const rows = db.prepare(`
    SELECT key, value, content_type, size_bytes, updated_at
    FROM memory
    WHERE namespace = ? AND (key LIKE ? OR value LIKE ?)
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(namespace, `%${query}%`, `%${query}%`, limit);
  return { results: rows, query, count: rows.length };
}

// GET /memory/stats/:namespace
export function getUsageStats(namespace) {
  const stats = db.prepare('SELECT * FROM usage_stats WHERE namespace = ?').get(namespace);
  const keyCount = db.prepare('SELECT COUNT(*) as count FROM memory WHERE namespace = ?').get(namespace);
  return {
    namespace,
    total_keys: keyCount?.count || 0,
    total_writes: stats?.total_writes || 0,
    total_reads: stats?.total_reads || 0,
    total_bytes: stats?.total_bytes || 0,
    last_activity: stats?.last_activity || null,
  };
}

// Export all keys for a namespace
export function exportNamespace(namespace) {
  return db.prepare('SELECT key, value, content_type, updated_at FROM memory WHERE namespace = ?').all(namespace);
}

// Global stats
export function getGlobalStats() {
  const totals = db.prepare('SELECT COUNT(*) as keys, SUM(size_bytes) as bytes FROM memory').get();
  const namespaces = db.prepare('SELECT COUNT(DISTINCT namespace) as count FROM memory').get();
  const agents = db.prepare('SELECT COUNT(*) as count FROM usage_stats').get();

  // Storage billing: count persistent keys older than 30 days (no TTL or TTL > 30d)
  const persistentKeys = db.prepare(`
    SELECT COUNT(*) as count, SUM(size_bytes) as bytes
    FROM memory
    WHERE (expires_at IS NULL OR expires_at > datetime('now', '+30 days'))
    AND created_at < datetime('now', '-30 days')
  `).get();

  return {
    total_keys: totals?.keys || 0,
    total_bytes: totals?.bytes || 0,
    total_namespaces: namespaces?.count || 0,
    total_agents: agents?.count || 0,
    persistent_keys_30d: persistentKeys?.count || 0,
    persistent_bytes_30d: persistentKeys?.bytes || 0,
    // Each persistent key costs 0.5 credits/month (recurring)
    monthly_storage_credits: (persistentKeys?.count || 0) * 0.5,
  };
}
