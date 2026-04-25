/**
 * Export converters — produce real file bytes for the Audit & Compliance
 * surface. Five formats supported:
 *   - JSON (built-in)
 *   - CSV  (built-in string ops, RFC 4180-ish quoting)
 *   - XLSX (sheetjs / xlsx)
 *   - PDF  (pdfkit, server-side, no Chromium)
 *   - DOCX (docx package, pure JS)
 *
 * Each exporter takes a typed input + returns:
 *   { bytes: Uint8Array, mimeType: string, fileName: string, sizeBytes: number }
 *
 * Exporters NEVER throw on "no data" — they produce a valid empty file
 * (e.g. CSV with header only, PDF with "No records" body) so the UI
 * gets a download instead of a 500. Throws are reserved for genuinely
 * impossible inputs (binary in a text field).
 *
 * Converter failures are caught at the route layer and the artifact row
 * is created with status='FAILED' + error message — never a fake-success.
 */

import { Buffer } from 'node:buffer';
import * as XLSX from 'xlsx';

export type ExportFormat = 'json' | 'csv' | 'xlsx' | 'pdf' | 'docx';

export interface ExportResult {
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
}

export interface ExportOptions {
  /** UI-friendly file stem; the format-appropriate extension is appended. */
  baseName: string;
  /** Optional document title shown at the top of PDFs / DOCX. */
  title?: string;
}

const MIME: Record<ExportFormat, string> = {
  json: 'application/json',
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const EXT: Record<ExportFormat, string> = {
  json: 'json',
  csv: 'csv',
  xlsx: 'xlsx',
  pdf: 'pdf',
  docx: 'docx',
};

function buildFileName(opts: ExportOptions, format: ExportFormat): string {
  const safe = opts.baseName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  return `${safe}.${EXT[format]}`;
}

// ───────────────────────── JSON ─────────────────────────────────────────

export function exportJson(data: unknown, opts: ExportOptions): ExportResult {
  const text = JSON.stringify(data, null, 2);
  const bytes = Buffer.from(text, 'utf8');
  return {
    bytes,
    mimeType: MIME.json,
    fileName: buildFileName(opts, 'json'),
    sizeBytes: bytes.byteLength,
  };
}

// ───────────────────────── CSV ──────────────────────────────────────────

/** Quote a single CSV field per RFC 4180 — wrap in "" if it contains , " \n. */
function csvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'string' ? value : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Tabular export. `rows` is an array of row objects; column order is
 * derived from `columns` if supplied, else from the first row's keys.
 * Empty rows produce a CSV with the header line only.
 */
export function exportCsv(
  rows: ReadonlyArray<Record<string, unknown>>,
  opts: ExportOptions & { columns?: ReadonlyArray<string> },
): ExportResult {
  const columns = opts.columns ?? (rows[0] ? Object.keys(rows[0]) : []);
  const header = columns.map(csvField).join(',');
  const body = rows.map((r) => columns.map((c) => csvField(r[c])).join(',')).join('\n');
  const text = body.length > 0 ? `${header}\n${body}\n` : `${header}\n`;
  const bytes = Buffer.from(text, 'utf8');
  return {
    bytes,
    mimeType: MIME.csv,
    fileName: buildFileName(opts, 'csv'),
    sizeBytes: bytes.byteLength,
  };
}

// ───────────────────────── XLSX ─────────────────────────────────────────

/**
 * Single-sheet XLSX from row-of-objects. Column order is `opts.columns`
 * if supplied, else the first row's keys. Empty rows produce a sheet
 * with the header row only.
 */
export function exportXlsx(
  rows: ReadonlyArray<Record<string, unknown>>,
  opts: ExportOptions & { columns?: ReadonlyArray<string>; sheetName?: string },
): ExportResult {
  const sheetName = opts.sheetName ?? 'Sheet1';
  const columns = opts.columns ?? (rows[0] ? Object.keys(rows[0]) : []);
  const aoa: unknown[][] = [columns.slice()];
  for (const r of rows) aoa.push(columns.map((c) => r[c] ?? ''));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const bytes: Buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return {
    bytes: new Uint8Array(bytes),
    mimeType: MIME.xlsx,
    fileName: buildFileName(opts, 'xlsx'),
    sizeBytes: bytes.byteLength,
  };
}

// ───────────────────────── PDF ──────────────────────────────────────────

/**
 * Plain-prose PDF. Uses pdfkit. Caller supplies the title + body sections.
 * Each section becomes a `Heading + paragraphs` block. Supports basic
 * markdown-ish bullets ("- item") rendered as bullet points.
 *
 * Lazily imports pdfkit so the cost (~2MB) only loads when an export
 * actually runs. PDFKit is CommonJS — using require via createRequire.
 */
export async function exportPdf(
  doc: { title: string; sections: ReadonlyArray<{ heading?: string; body: string }> },
  opts: ExportOptions,
): Promise<ExportResult> {
  // Lazy load via createRequire to avoid ESM/CJS interop issues.
  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  type PDFDoc = {
    on: (event: string, cb: (chunk: Buffer | undefined) => void) => void;
    fontSize: (size: number) => PDFDoc;
    text: (text: string, opts?: Record<string, unknown>) => PDFDoc;
    moveDown: (lines?: number) => PDFDoc;
    end: () => PDFDoc;
  };
  const PDFDocument = req('pdfkit') as new (opts?: { margin?: number; bufferPages?: boolean }) => PDFDoc;

  const pdf = new PDFDocument({ margin: 50 });
  const chunks: Buffer[] = [];
  pdf.on('data', (chunk) => { if (chunk) chunks.push(chunk); });
  const done = new Promise<void>((resolve, reject) => {
    pdf.on('end', () => resolve());
    pdf.on('error', (e: unknown) => reject(e instanceof Error ? e : new Error(String(e))));
  });

  pdf.fontSize(20).text(doc.title, { align: 'center' });
  pdf.moveDown(1);

  for (const sec of doc.sections) {
    if (sec.heading) {
      pdf.fontSize(14).text(sec.heading);
      pdf.moveDown(0.5);
    }
    pdf.fontSize(11);
    // Render bullets as bullets, everything else as wrapped paragraphs.
    const lines = sec.body.split(/\r?\n/);
    for (const ln of lines) {
      const bullet = /^\s*[-*]\s+(.*)$/.exec(ln);
      if (bullet) {
        pdf.text(`• ${bullet[1]}`, { indent: 16 });
      } else if (ln.trim().length === 0) {
        pdf.moveDown(0.5);
      } else {
        pdf.text(ln);
      }
    }
    pdf.moveDown(1);
  }

  pdf.end();
  await done;
  const bytes = Buffer.concat(chunks);
  return {
    bytes: new Uint8Array(bytes),
    mimeType: MIME.pdf,
    fileName: buildFileName(opts, 'pdf'),
    sizeBytes: bytes.byteLength,
  };
}

// ───────────────────────── DOCX ─────────────────────────────────────────

/**
 * Plain-prose DOCX. Uses the `docx` package. Mirrors the PDF structure:
 * title at top, then heading + body sections.
 */
export async function exportDocx(
  doc: { title: string; sections: ReadonlyArray<{ heading?: string; body: string }> },
  opts: ExportOptions,
): Promise<ExportResult> {
  const { Document, Packer, Paragraph, HeadingLevel, TextRun } = await import('docx');

  const children: import('docx').Paragraph[] = [];
  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: doc.title, bold: true })],
    }),
  );
  for (const sec of doc.sections) {
    if (sec.heading) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, text: sec.heading }));
    }
    for (const ln of sec.body.split(/\r?\n/)) {
      const bullet = /^\s*[-*]\s+(.*)$/.exec(ln);
      if (bullet) {
        children.push(new Paragraph({ text: bullet[1], bullet: { level: 0 } }));
      } else if (ln.trim().length === 0) {
        children.push(new Paragraph({}));
      } else {
        children.push(new Paragraph({ text: ln }));
      }
    }
  }

  const document = new Document({ sections: [{ properties: {}, children }] });
  const buffer = await Packer.toBuffer(document);
  return {
    bytes: new Uint8Array(buffer),
    mimeType: MIME.docx,
    fileName: buildFileName(opts, 'docx'),
    sizeBytes: buffer.byteLength,
  };
}

// ───────────────────────── Dispatcher ───────────────────────────────────

/**
 * Single dispatch helper. Picks the right exporter by format.
 *
 * Tabular formats (csv / xlsx) require `data` shaped as `{ rows, columns? }`.
 * Document formats (pdf / docx) require `data` shaped as `{ title, sections }`.
 * JSON accepts any value.
 *
 * Throws on a shape mismatch — the caller (export route) catches and
 * marks the artifact row FAILED with a clear error message.
 */
export async function exportByFormat(
  format: ExportFormat,
  data: unknown,
  opts: ExportOptions,
): Promise<ExportResult> {
  switch (format) {
    case 'json': return exportJson(data, opts);
    case 'csv': {
      const d = data as { rows?: unknown; columns?: ReadonlyArray<string> };
      if (!d || !Array.isArray(d.rows)) throw new Error('csv export requires { rows: Array<object> }');
      return exportCsv(
        d.rows as ReadonlyArray<Record<string, unknown>>,
        d.columns ? { ...opts, columns: d.columns } : opts,
      );
    }
    case 'xlsx': {
      const d = data as { rows?: unknown; columns?: ReadonlyArray<string>; sheetName?: string };
      if (!d || !Array.isArray(d.rows)) throw new Error('xlsx export requires { rows: Array<object> }');
      return exportXlsx(
        d.rows as ReadonlyArray<Record<string, unknown>>,
        {
          ...opts,
          ...(d.columns ? { columns: d.columns } : {}),
          ...(d.sheetName ? { sheetName: d.sheetName } : {}),
        },
      );
    }
    case 'pdf': {
      const d = data as { title?: unknown; sections?: unknown };
      if (!d || typeof d.title !== 'string' || !Array.isArray(d.sections)) {
        throw new Error('pdf export requires { title: string, sections: Array<{heading?, body}> }');
      }
      return exportPdf(d as { title: string; sections: ReadonlyArray<{ heading?: string; body: string }> }, opts);
    }
    case 'docx': {
      const d = data as { title?: unknown; sections?: unknown };
      if (!d || typeof d.title !== 'string' || !Array.isArray(d.sections)) {
        throw new Error('docx export requires { title: string, sections: Array<{heading?, body}> }');
      }
      return exportDocx(d as { title: string; sections: ReadonlyArray<{ heading?: string; body: string }> }, opts);
    }
  }
}
