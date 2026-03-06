/**
 * MoltsPay skill wrappers for Sentinel Agent Services
 * These functions proxy to the live Sentinel API on Render.
 * MoltsPay handles x402 payment, then calls these functions.
 */

const BASE = process.env.SENTINEL_URL || 'https://sentinel-services.onrender.com';

async function httpCall(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text, status: res.status }; }
}

export async function kvWrite({ key, value }) {
  return httpCall('PUT', `/kv/${key}`, { value });
}

export async function kvRead({ key }) {
  return httpCall('GET', `/kv/${key}`);
}

export async function emailSend({ to, subject, body, html }) {
  return httpCall('POST', '/email/send', { to, subject, body, html });
}

export async function pdfGenerate({ title, content, filename }) {
  return httpCall('POST', '/pdf/generate/json', { title, content, filename });
}

export async function vectorUpsert({ namespace, id, vector, metadata }) {
  return httpCall('POST', `/vectors/${namespace}/upsert`, { id, vector, metadata });
}

export async function vectorQuery({ namespace, vector, topK }) {
  return httpCall('POST', `/vectors/${namespace}/query`, { vector, topK });
}

export async function vectorBatch({ namespace, vectors }) {
  return httpCall('POST', `/vectors/${namespace}/batch`, { vectors });
}
