#!/usr/bin/env node
/**
 * Sentinel Agent Services — MCP Server v4
 *
 * Exposes KV, Email, PDF, and Vector tools via Model Context Protocol
 * so Claude and other MCP-compatible LLMs can discover and use them.
 *
 * Payment: x402 protocol (Coinbase). The HTTP server handles 402 responses
 * automatically via x402-express middleware. Agents pay USDC on Base.
 *
 * Configure in claude_desktop_config.json:
 * {
 *   "mcpServers": {
 *     "sentinel": {
 *       "command": "node",
 *       "args": ["path/to/sentinel-services/mcp/server.js"],
 *       "env": {
 *         "SENTINEL_URL": "https://your-sentinel.conway.tech",
 *         "SENTINEL_WALLET": "0xYourAgentWallet"
 *       }
 *     }
 *   }
 * }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const SENTINEL_URL = process.env.SENTINEL_URL || 'http://localhost:4021';
const WALLET = process.env.SENTINEL_WALLET || '';

// ============ HTTP CLIENT ============

async function sentinel(method, path, body = null) {
  const headers = {
    'Content-Type': 'application/json',
    ...(WALLET ? { 'X-Wallet': WALLET } : {}),
  };

  const opts = { method, headers, signal: AbortSignal.timeout(30000) };
  if (body && method !== 'GET') {
    opts.body = JSON.stringify(body);
  }

  const resp = await fetch(`${SENTINEL_URL}${path}`, opts);
  const contentType = resp.headers.get('content-type') || '';

  if (contentType.includes('application/pdf')) {
    const buf = await resp.arrayBuffer();
    return {
      _isPdf: true,
      base64: Buffer.from(buf).toString('base64'),
      size: buf.byteLength,
      pages: resp.headers.get('x-pages'),
    };
  }

  // x402 payment required — agent needs to handle 402 with x402 client SDK
  if (resp.status === 402) {
    const data = await resp.json().catch(() => ({}));
    return {
      _needs_payment: true,
      status: 402,
      ...data,
      hint: 'This operation requires x402 payment. The agent must use an x402-compatible HTTP client to handle 402 responses automatically.',
    };
  }

  return await resp.json();
}

// ============ MCP SERVER ============

const server = new Server(
  { name: 'sentinel-agent-services', version: '4.0.0' },
  { capabilities: { tools: {}, resources: {} } }
);

// ============ TOOLS ============

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    // --- KV Store ---
    {
      name: 'sentinel_kv_write',
      description: 'Store a key-value pair in persistent storage. First 100 writes FREE per wallet, then $0.01/write via x402 (USDC on Base). Supports TTL (auto-expire).',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Key name' },
          value: { type: 'string', description: 'Value to store (string or JSON)' },
          ttl_seconds: { type: 'number', description: 'Optional: auto-delete after N seconds' },
        },
        required: ['key', 'value'],
      },
    },
    {
      name: 'sentinel_kv_read',
      description: 'Read a value from persistent storage. Free.',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Key name' },
        },
        required: ['key'],
      },
    },
    {
      name: 'sentinel_kv_delete',
      description: 'Delete a key from storage. Free.',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Key name' },
        },
        required: ['key'],
      },
    },
    {
      name: 'sentinel_kv_list',
      description: 'List all keys. Free.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max keys to return (default 100)' },
        },
      },
    },
    {
      name: 'sentinel_kv_search',
      description: 'Search keys and values by text query. Free.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (matches key names and values)' },
        },
        required: ['query'],
      },
    },

    // --- Email ---
    {
      name: 'sentinel_send_email',
      description: 'Send an email. $0.005/email via x402. Supports HTML, reply-to, up to 5 recipients.',
      inputSchema: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient email(s), comma-separated (max 5)' },
          subject: { type: 'string', description: 'Email subject' },
          body: { type: 'string', description: 'Plain text body' },
          html: { type: 'string', description: 'Optional HTML body' },
          reply_to: { type: 'string', description: 'Optional reply-to address' },
        },
        required: ['to', 'subject', 'body'],
      },
    },
    {
      name: 'sentinel_send_webhook',
      description: 'Send a webhook notification to any URL. $0.005 via x402. 10s timeout.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Webhook URL' },
          payload: { type: 'object', description: 'JSON payload to send' },
          method: { type: 'string', enum: ['POST', 'PUT', 'PATCH'], description: 'HTTP method (default POST)' },
        },
        required: ['url'],
      },
    },

    // --- PDF ---
    {
      name: 'sentinel_generate_pdf',
      description: 'Generate a PDF document. $0.02/PDF via x402. Formats: "text" (markdown-like), "structured" (JSON sections), "invoice", "report".',
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Content for the PDF' },
          format: { type: 'string', enum: ['text', 'structured', 'invoice', 'report'], description: 'PDF format (default: text)' },
          title: { type: 'string', description: 'Document title' },
        },
        required: ['content'],
      },
    },

    // --- Vectors ---
    {
      name: 'sentinel_vector_upsert',
      description: 'Store a vector embedding. $0.01 via x402. For semantic memory, RAG, similarity search. Any dimension supported.',
      inputSchema: {
        type: 'object',
        properties: {
          namespace: { type: 'string', description: 'Namespace to group vectors' },
          id: { type: 'string', description: 'Unique vector ID' },
          vector: { type: 'array', items: { type: 'number' }, description: 'Embedding vector (array of floats)' },
          metadata: { type: 'object', description: 'Optional metadata' },
        },
        required: ['namespace', 'id', 'vector'],
      },
    },
    {
      name: 'sentinel_vector_batch',
      description: 'Batch upsert up to 100 vectors. $0.01 via x402.',
      inputSchema: {
        type: 'object',
        properties: {
          namespace: { type: 'string', description: 'Namespace' },
          vectors: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, vector: { type: 'array', items: { type: 'number' } }, metadata: { type: 'object' } }, required: ['id', 'vector'] }, description: 'Array of vectors (max 100)' },
        },
        required: ['namespace', 'vectors'],
      },
    },
    {
      name: 'sentinel_vector_query',
      description: 'Search for similar vectors by cosine similarity. $0.005 via x402. Supports metadata filtering.',
      inputSchema: {
        type: 'object',
        properties: {
          namespace: { type: 'string', description: 'Namespace to search' },
          vector: { type: 'array', items: { type: 'number' }, description: 'Query vector' },
          topK: { type: 'number', description: 'Number of results (default 5)' },
          filter: { type: 'object', description: 'Optional metadata filter' },
        },
        required: ['namespace', 'vector'],
      },
    },
    {
      name: 'sentinel_vector_get',
      description: 'Get a specific vector by ID. Free.',
      inputSchema: {
        type: 'object',
        properties: {
          namespace: { type: 'string', description: 'Namespace' },
          id: { type: 'string', description: 'Vector ID' },
        },
        required: ['namespace', 'id'],
      },
    },
    {
      name: 'sentinel_vector_delete',
      description: 'Delete a vector by ID. Free.',
      inputSchema: {
        type: 'object',
        properties: {
          namespace: { type: 'string', description: 'Namespace' },
          id: { type: 'string', description: 'Vector ID' },
        },
        required: ['namespace', 'id'],
      },
    },
    {
      name: 'sentinel_vector_list',
      description: 'List vectors in a namespace (IDs and metadata only). Free.',
      inputSchema: {
        type: 'object',
        properties: {
          namespace: { type: 'string', description: 'Namespace to list' },
          limit: { type: 'number', description: 'Max results (default 100)' },
        },
        required: ['namespace'],
      },
    },
  ],
}));

// ============ TOOL EXECUTION ============

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // KV Store
      case 'sentinel_kv_write': {
        const body = { value: args.value };
        if (args.ttl_seconds) body.ttl = args.ttl_seconds;
        const result = await sentinel('PUT', `/kv/${encodeURIComponent(args.key)}`, body);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'sentinel_kv_read': {
        const result = await sentinel('GET', `/kv/${encodeURIComponent(args.key)}`);
        if (result?.error) return { content: [{ type: 'text', text: 'Key not found' }] };
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'sentinel_kv_delete': {
        const result = await sentinel('DELETE', `/kv/${encodeURIComponent(args.key)}`);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'sentinel_kv_list': {
        const limit = args.limit || 100;
        const result = await sentinel('GET', `/kv?limit=${limit}`);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'sentinel_kv_search': {
        const result = await sentinel('GET', `/kv/search?q=${encodeURIComponent(args.query)}`);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      // Email
      case 'sentinel_send_email': {
        const result = await sentinel('POST', '/email/send', {
          to: args.to, subject: args.subject, body: args.body,
          html: args.html, replyTo: args.reply_to,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'sentinel_send_webhook': {
        const result = await sentinel('POST', '/email/webhook', {
          url: args.url, payload: args.payload, method: args.method || 'POST',
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      // PDF
      case 'sentinel_generate_pdf': {
        const result = await sentinel('POST', '/pdf/generate/json', {
          content: args.content, format: args.format || 'text', title: args.title,
        });
        if (result.pdf_base64) {
          return {
            content: [
              { type: 'text', text: `PDF generated: ${result.size_bytes} bytes, ${result.pages} page(s)` },
              { type: 'resource', resource: { uri: `data:application/pdf;base64,${result.pdf_base64}`, mimeType: 'application/pdf', text: result.pdf_base64 } },
            ],
          };
        }
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      // Vectors
      case 'sentinel_vector_upsert': {
        const result = await sentinel('POST', `/vectors/${encodeURIComponent(args.namespace)}/upsert`, {
          id: args.id, vector: args.vector, metadata: args.metadata || {},
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'sentinel_vector_batch': {
        const result = await sentinel('POST', `/vectors/${encodeURIComponent(args.namespace)}/batch`, {
          vectors: args.vectors,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'sentinel_vector_query': {
        const result = await sentinel('POST', `/vectors/${encodeURIComponent(args.namespace)}/query`, {
          vector: args.vector, topK: args.topK || 5, filter: args.filter || null,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'sentinel_vector_get': {
        const result = await sentinel('GET', `/vectors/${encodeURIComponent(args.namespace)}/${encodeURIComponent(args.id)}`);
        if (!result || result.error) return { content: [{ type: 'text', text: 'Vector not found' }] };
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'sentinel_vector_delete': {
        const result = await sentinel('DELETE', `/vectors/${encodeURIComponent(args.namespace)}/${encodeURIComponent(args.id)}`);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'sentinel_vector_list': {
        const limit = args.limit || 100;
        const result = await sentinel('GET', `/vectors/${encodeURIComponent(args.namespace)}?limit=${limit}`);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
  }
});

// ============ RESOURCES ============

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: 'sentinel://pricing',
      name: 'Sentinel Pricing',
      description: 'API pricing (x402 USDC on Base)',
      mimeType: 'application/json',
    },
    {
      uri: 'sentinel://stats',
      name: 'Sentinel Stats',
      description: 'Service statistics',
      mimeType: 'application/json',
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  if (uri === 'sentinel://pricing') {
    const data = await sentinel('GET', '/');
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data?.pricing || data, null, 2) }] };
  }
  if (uri === 'sentinel://stats') {
    const data = await sentinel('GET', '/stats');
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] };
  }
  return { contents: [{ uri, mimeType: 'text/plain', text: 'Unknown resource' }] };
});

// ============ START ============

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[Sentinel MCP] Connected to', SENTINEL_URL);
  if (WALLET) console.error('[Sentinel MCP] Wallet:', WALLET);
}

main().catch((err) => {
  console.error('[Sentinel MCP] Fatal:', err);
  process.exit(1);
});
