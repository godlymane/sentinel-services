/**
 * Vector Storage Service (Premium Tier)
 *
 * Agents store embeddings and query by cosine similarity.
 * No heavy vector DB needed — SQLite + JS math.
 *
 * Why this is the moat: re-embedding millions of records
 * is computationally expensive. Once vectors live here,
 * switching cost is enormous.
 *
 * Pricing: 10 credits/upsert, 5 credits/query (premium)
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

let db;

export function initVectorDB(database) {
  db = database;

  db.exec(`
    CREATE TABLE IF NOT EXISTS vectors (
      namespace TEXT NOT NULL,
      id TEXT NOT NULL,
      vector TEXT NOT NULL,
      metadata TEXT DEFAULT '{}',
      dimensions INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (namespace, id)
    );

    CREATE INDEX IF NOT EXISTS idx_vectors_ns ON vectors(namespace);
    CREATE INDEX IF NOT EXISTS idx_vectors_dims ON vectors(dimensions);

    CREATE TABLE IF NOT EXISTS vector_stats (
      namespace TEXT PRIMARY KEY,
      total_vectors INTEGER DEFAULT 0,
      total_queries INTEGER DEFAULT 0,
      last_activity TEXT DEFAULT (datetime('now'))
    );
  `);
}

// ============ COSINE SIMILARITY ============

function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

// ============ UPSERT ============

export function upsertVector(namespace, id, vector, metadata = {}) {
  if (!Array.isArray(vector) || vector.length === 0) {
    return { error: 'Vector must be a non-empty array of numbers' };
  }

  // Validate vector values
  for (let i = 0; i < vector.length; i++) {
    if (typeof vector[i] !== 'number' || !isFinite(vector[i])) {
      return { error: `Invalid vector value at index ${i}` };
    }
  }

  const dimensions = vector.length;
  const vectorJson = JSON.stringify(vector);
  const metadataJson = JSON.stringify(metadata);

  db.prepare(`
    INSERT INTO vectors (namespace, id, vector, metadata, dimensions, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(namespace, id) DO UPDATE SET
      vector = excluded.vector,
      metadata = excluded.metadata,
      dimensions = excluded.dimensions,
      updated_at = datetime('now')
  `).run(namespace, id, vectorJson, metadataJson, dimensions);

  // Update stats
  db.prepare(`
    INSERT INTO vector_stats (namespace, total_vectors, last_activity)
    VALUES (?, 1, datetime('now'))
    ON CONFLICT(namespace) DO UPDATE SET
      total_vectors = (SELECT COUNT(*) FROM vectors WHERE namespace = ?),
      last_activity = datetime('now')
  `).run(namespace, namespace);

  return { namespace, id, dimensions, stored: true };
}

// ============ BATCH UPSERT ============

export function batchUpsert(namespace, vectors) {
  if (!Array.isArray(vectors)) return { error: 'Vectors must be an array' };
  if (vectors.length > 100) return { error: 'Max 100 vectors per batch' };

  const upsertStmt = db.prepare(`
    INSERT INTO vectors (namespace, id, vector, metadata, dimensions, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(namespace, id) DO UPDATE SET
      vector = excluded.vector,
      metadata = excluded.metadata,
      dimensions = excluded.dimensions,
      updated_at = datetime('now')
  `);

  const results = [];
  const insertMany = db.transaction((items) => {
    for (const item of items) {
      if (!item.id || !Array.isArray(item.vector)) {
        results.push({ id: item.id, error: 'Missing id or vector' });
        continue;
      }
      upsertStmt.run(
        namespace, item.id,
        JSON.stringify(item.vector),
        JSON.stringify(item.metadata || {}),
        item.vector.length
      );
      results.push({ id: item.id, stored: true });
    }
  });

  insertMany(vectors);

  // Update stats
  db.prepare(`
    INSERT INTO vector_stats (namespace, total_vectors, last_activity)
    VALUES (?, 0, datetime('now'))
    ON CONFLICT(namespace) DO UPDATE SET
      total_vectors = (SELECT COUNT(*) FROM vectors WHERE namespace = ?),
      last_activity = datetime('now')
  `).run(namespace, namespace);

  return { namespace, processed: vectors.length, results };
}

// ============ QUERY (SIMILARITY SEARCH) ============

export function queryVectors(namespace, queryVector, topK = 5, filter = null) {
  if (!Array.isArray(queryVector) || queryVector.length === 0) {
    return { error: 'Query vector must be a non-empty array' };
  }

  const dimensions = queryVector.length;

  // Get all vectors in namespace with matching dimensions
  let rows;
  if (filter) {
    // Filter by metadata using JSON extract
    rows = db.prepare(
      'SELECT id, vector, metadata FROM vectors WHERE namespace = ? AND dimensions = ?'
    ).all(namespace, dimensions);
    // Apply metadata filter in JS (SQLite JSON support varies)
    rows = rows.filter(row => {
      const meta = JSON.parse(row.metadata);
      return Object.entries(filter).every(([k, v]) => meta[k] === v);
    });
  } else {
    rows = db.prepare(
      'SELECT id, vector, metadata FROM vectors WHERE namespace = ? AND dimensions = ?'
    ).all(namespace, dimensions);
  }

  // Calculate similarity for each
  const scored = rows.map(row => {
    const vec = JSON.parse(row.vector);
    const score = cosineSimilarity(queryVector, vec);
    return {
      id: row.id,
      score: Math.round(score * 10000) / 10000,
      metadata: JSON.parse(row.metadata),
    };
  });

  // Sort by score descending, take top K
  scored.sort((a, b) => b.score - a.score);
  const results = scored.slice(0, topK);

  // Update query count
  db.prepare(`
    UPDATE vector_stats SET total_queries = total_queries + 1, last_activity = datetime('now')
    WHERE namespace = ?
  `).run(namespace);

  return {
    namespace,
    query_dimensions: dimensions,
    total_searched: rows.length,
    results,
  };
}

// ============ GET VECTOR ============

export function getVector(namespace, id) {
  const row = db.prepare('SELECT * FROM vectors WHERE namespace = ? AND id = ?').get(namespace, id);
  if (!row) return null;
  return {
    ...row,
    vector: JSON.parse(row.vector),
    metadata: JSON.parse(row.metadata),
  };
}

// ============ DELETE ============

export function deleteVector(namespace, id) {
  const result = db.prepare('DELETE FROM vectors WHERE namespace = ? AND id = ?').run(namespace, id);
  return { deleted: result.changes > 0 };
}

export function deleteNamespace(namespace) {
  const result = db.prepare('DELETE FROM vectors WHERE namespace = ?').run(namespace);
  db.prepare('DELETE FROM vector_stats WHERE namespace = ?').run(namespace);
  return { deleted: result.changes };
}

// ============ LIST ============

export function listVectors(namespace, limit = 100, offset = 0) {
  const rows = db.prepare(
    'SELECT id, dimensions, metadata, updated_at FROM vectors WHERE namespace = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?'
  ).all(namespace, limit, offset);

  const parsed = rows.map(r => ({ ...r, metadata: JSON.parse(r.metadata) }));
  const count = db.prepare('SELECT COUNT(*) as total FROM vectors WHERE namespace = ?').get(namespace);
  return { vectors: parsed, total: count.total, limit, offset };
}

// ============ STATS ============

export function getVectorStats(namespace) {
  const stats = db.prepare('SELECT * FROM vector_stats WHERE namespace = ?').get(namespace);
  return {
    namespace,
    total_vectors: stats?.total_vectors || 0,
    total_queries: stats?.total_queries || 0,
    last_activity: stats?.last_activity || null,
  };
}

export function getGlobalVectorStats() {
  const totals = db.prepare('SELECT COUNT(*) as vectors, COUNT(DISTINCT namespace) as namespaces FROM vectors').get();
  const queries = db.prepare('SELECT SUM(total_queries) as total FROM vector_stats').get();
  return {
    total_vectors: totals?.vectors || 0,
    total_namespaces: totals?.namespaces || 0,
    total_queries: queries?.total || 0,
  };
}
