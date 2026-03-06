/**
 * Email/Notification Relay Service
 * Agents pay to send emails and webhook notifications.
 * Uses SMTP (configurable) with rate limiting.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const nodemailer = require('nodemailer');

let transporter = null;
let emailLog = [];
const rateLimits = new Map(); // per-sender rate limiting
const RATE_LIMIT_PER_HOUR = 50;

export function initEmailService(config = {}) {
  // Default to Resend SMTP (free tier: 100 emails/day)
  // Can also use Mailgun, SendGrid, or any SMTP
  const smtpConfig = {
    host: config.smtpHost || process.env.SMTP_HOST || 'smtp.resend.com',
    port: config.smtpPort || parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: config.smtpUser || process.env.SMTP_USER || 'resend',
      pass: config.smtpPass || process.env.SMTP_PASS || process.env.RESEND_API_KEY || '',
    },
  };

  transporter = nodemailer.createTransport(smtpConfig);
  return transporter;
}

function checkRateLimit(senderWallet) {
  const now = Date.now();
  const hourAgo = now - 3600000;
  const key = senderWallet || 'anonymous';

  if (!rateLimits.has(key)) {
    rateLimits.set(key, []);
  }

  const timestamps = rateLimits.get(key).filter(t => t > hourAgo);
  rateLimits.set(key, timestamps);

  if (timestamps.length >= RATE_LIMIT_PER_HOUR) {
    return { allowed: false, remaining: 0, resetIn: Math.ceil((timestamps[0] + 3600000 - now) / 1000) };
  }

  timestamps.push(now);
  return { allowed: true, remaining: RATE_LIMIT_PER_HOUR - timestamps.length };
}

// POST /email/send
export async function sendEmail(options, senderWallet) {
  const { to, subject, body, html, from, replyTo } = options;

  // Validate
  if (!to) return { error: 'Missing "to" field' };
  if (!subject && !body) return { error: 'Missing "subject" or "body"' };

  // Rate limit
  const rateCheck = checkRateLimit(senderWallet);
  if (!rateCheck.allowed) {
    return {
      error: `Rate limited. ${rateCheck.remaining} emails remaining. Reset in ${rateCheck.resetIn}s`,
      status: 429,
    };
  }

  // Anti-spam: basic validation
  if (typeof to === 'string' && to.split(',').length > 5) {
    return { error: 'Maximum 5 recipients per request' };
  }

  const fromAddress = from || `sentinel@${process.env.EMAIL_DOMAIN || 'sentinel-agent.x402.dev'}`;

  try {
    const info = await transporter.sendMail({
      from: fromAddress,
      to,
      subject: subject || '(no subject)',
      text: body || '',
      html: html || undefined,
      replyTo: replyTo || undefined,
      headers: {
        'X-Sent-By': 'Sentinel Agent Services',
        'X-Sender-Wallet': senderWallet || 'anonymous',
      },
    });

    const logEntry = {
      messageId: info.messageId,
      to,
      subject,
      senderWallet,
      timestamp: new Date().toISOString(),
      accepted: info.accepted,
      rejected: info.rejected,
    };
    emailLog.push(logEntry);

    // Keep log bounded
    if (emailLog.length > 1000) emailLog = emailLog.slice(-500);

    return {
      success: true,
      messageId: info.messageId,
      accepted: info.accepted,
      remaining: rateCheck.remaining,
    };
  } catch (err) {
    return { error: `Failed to send: ${err.message}`, success: false };
  }
}

// POST /email/webhook
export async function sendWebhook(options, senderWallet) {
  const { url, payload, method = 'POST', headers = {} } = options;

  if (!url) return { error: 'Missing "url" field' };

  // Rate limit (shared with email)
  const rateCheck = checkRateLimit(senderWallet);
  if (!rateCheck.allowed) {
    return { error: 'Rate limited', status: 429 };
  }

  try {
    const resp = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(10000),
    });

    return {
      success: resp.ok,
      status: resp.status,
      statusText: resp.statusText,
      remaining: rateCheck.remaining,
    };
  } catch (err) {
    return { error: `Webhook failed: ${err.message}`, success: false };
  }
}

// GET /email/stats
export function getEmailStats() {
  return {
    total_sent: emailLog.length,
    last_sent: emailLog.length > 0 ? emailLog[emailLog.length - 1].timestamp : null,
    smtp_configured: transporter !== null,
  };
}
