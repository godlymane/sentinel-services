/**
 * PDF Generator Service
 * Agents pay to generate PDFs from markdown, HTML, or structured data.
 * Uses PDFKit (zero external dependencies).
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const PDFDocument = require('pdfkit');

let generationCount = 0;

// POST /pdf/generate
export async function generatePDF(options) {
  const { content, format = 'text', title, metadata = {} } = options;

  if (!content) return { error: 'Missing "content" field' };

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        info: {
          Title: title || 'Generated Document',
          Author: 'Sentinel Agent Services',
          Creator: 'sentinel-pdf-api',
          ...metadata,
        },
      });

      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => {
        const buffer = Buffer.concat(chunks);
        generationCount++;
        resolve({
          success: true,
          pdf: buffer,
          size_bytes: buffer.length,
          pages: doc.bufferedPageRange().count || 1,
        });
      });
      doc.on('error', err => reject(err));

      if (format === 'structured') {
        renderStructured(doc, content);
      } else if (format === 'invoice') {
        renderInvoice(doc, content);
      } else if (format === 'report') {
        renderReport(doc, content);
      } else {
        renderText(doc, content, title);
      }

      doc.end();
    } catch (err) {
      resolve({ error: `PDF generation failed: ${err.message}`, success: false });
    }
  });
}

function renderText(doc, content, title) {
  if (title) {
    doc.fontSize(24).font('Helvetica-Bold').text(title, { align: 'center' });
    doc.moveDown(1);
  }

  // Simple markdown-ish rendering
  const lines = content.split('\n');
  for (const line of lines) {
    if (line.startsWith('# ')) {
      doc.moveDown(0.5);
      doc.fontSize(20).font('Helvetica-Bold').text(line.slice(2));
      doc.moveDown(0.3);
    } else if (line.startsWith('## ')) {
      doc.moveDown(0.5);
      doc.fontSize(16).font('Helvetica-Bold').text(line.slice(3));
      doc.moveDown(0.3);
    } else if (line.startsWith('### ')) {
      doc.moveDown(0.3);
      doc.fontSize(14).font('Helvetica-Bold').text(line.slice(4));
      doc.moveDown(0.2);
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      doc.fontSize(11).font('Helvetica').text(`  \u2022 ${line.slice(2)}`, { indent: 20 });
    } else if (line.startsWith('---')) {
      doc.moveDown(0.3);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#cccccc');
      doc.moveDown(0.3);
    } else if (line.trim() === '') {
      doc.moveDown(0.5);
    } else {
      doc.fontSize(11).font('Helvetica').text(line);
    }
  }
}

function renderStructured(doc, data) {
  // Render structured data (JSON) as formatted sections
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { renderText(doc, data); return; }
  }

  if (data.title) {
    doc.fontSize(24).font('Helvetica-Bold').text(data.title, { align: 'center' });
    doc.moveDown(1);
  }

  if (data.sections) {
    for (const section of data.sections) {
      doc.fontSize(16).font('Helvetica-Bold').text(section.heading || '');
      doc.moveDown(0.3);
      doc.fontSize(11).font('Helvetica').text(section.body || '');
      doc.moveDown(1);
    }
  }

  // Render tables if present
  if (data.table) {
    renderTable(doc, data.table);
  }
}

function renderTable(doc, table) {
  const { headers, rows } = table;
  if (!headers || !rows) return;

  const colWidth = (495) / headers.length;
  const startX = 50;
  let y = doc.y + 10;

  // Headers
  doc.font('Helvetica-Bold').fontSize(10);
  headers.forEach((h, i) => {
    doc.text(h, startX + i * colWidth, y, { width: colWidth - 5, align: 'left' });
  });
  y += 20;
  doc.moveTo(startX, y).lineTo(startX + 495, y).stroke('#333');
  y += 5;

  // Rows
  doc.font('Helvetica').fontSize(10);
  for (const row of rows) {
    const values = Array.isArray(row) ? row : Object.values(row);
    values.forEach((val, i) => {
      doc.text(String(val || ''), startX + i * colWidth, y, { width: colWidth - 5, align: 'left' });
    });
    y += 18;
    if (y > 750) { doc.addPage(); y = 50; }
  }
}

function renderInvoice(doc, data) {
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { renderText(doc, data); return; }
  }

  // Header
  doc.fontSize(28).font('Helvetica-Bold').text('INVOICE', { align: 'right' });
  doc.moveDown(0.5);
  doc.fontSize(10).font('Helvetica')
    .text(`Invoice #: ${data.number || 'N/A'}`, { align: 'right' })
    .text(`Date: ${data.date || new Date().toISOString().split('T')[0]}`, { align: 'right' });
  doc.moveDown(1);

  // From / To
  if (data.from) {
    doc.font('Helvetica-Bold').text('From:');
    doc.font('Helvetica').text(data.from);
    doc.moveDown(0.5);
  }
  if (data.to) {
    doc.font('Helvetica-Bold').text('To:');
    doc.font('Helvetica').text(data.to);
    doc.moveDown(1);
  }

  // Line items
  if (data.items) {
    renderTable(doc, {
      headers: ['Description', 'Qty', 'Price', 'Total'],
      rows: data.items.map(item => [
        item.description,
        item.quantity || 1,
        `$${(item.price || 0).toFixed(2)}`,
        `$${((item.quantity || 1) * (item.price || 0)).toFixed(2)}`,
      ]),
    });
  }

  // Total
  if (data.total !== undefined) {
    doc.moveDown(1);
    doc.fontSize(14).font('Helvetica-Bold').text(`Total: $${data.total.toFixed(2)}`, { align: 'right' });
  }
}

function renderReport(doc, data) {
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { renderText(doc, data); return; }
  }

  // Title page
  doc.moveDown(8);
  doc.fontSize(32).font('Helvetica-Bold').text(data.title || 'Report', { align: 'center' });
  if (data.subtitle) {
    doc.moveDown(0.5);
    doc.fontSize(16).font('Helvetica').text(data.subtitle, { align: 'center' });
  }
  doc.moveDown(1);
  doc.fontSize(12).text(`Generated: ${new Date().toISOString().split('T')[0]}`, { align: 'center' });

  // Content pages
  if (data.sections) {
    for (const section of data.sections) {
      doc.addPage();
      doc.fontSize(20).font('Helvetica-Bold').text(section.heading || '');
      doc.moveDown(0.5);
      doc.fontSize(11).font('Helvetica').text(section.body || '');
      if (section.table) {
        doc.moveDown(0.5);
        renderTable(doc, section.table);
      }
    }
  }
}

export function getPDFStats() {
  return { total_generated: generationCount };
}
