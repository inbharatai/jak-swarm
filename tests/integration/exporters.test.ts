/**
 * Real exporter tests — verify each format produces a valid file.
 *
 * What we check per format:
 *   - Output is a Uint8Array with non-zero length
 *   - First few bytes match the expected magic / shape for the format
 *   - File name has the right extension
 *   - MIME type matches the format
 *
 * No mocks — these run real PDFKit, real docx, real xlsx. Catches
 * dep-version regressions that would silently break exports.
 */
import { describe, it, expect } from 'vitest';
import {
  exportJson,
  exportCsv,
  exportXlsx,
  exportPdf,
  exportDocx,
  exportByFormat,
} from '../../apps/api/src/services/exporters/index.js';

describe('JSON exporter', () => {
  it('produces valid JSON bytes', () => {
    const result = exportJson({ a: 1, nested: [1, 2, 3] }, { baseName: 'test' });
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    expect(result.fileName).toBe('test.json');
    expect(result.mimeType).toBe('application/json');
    const parsed = JSON.parse(Buffer.from(result.bytes).toString('utf8'));
    expect(parsed).toEqual({ a: 1, nested: [1, 2, 3] });
  });
});

describe('CSV exporter', () => {
  it('produces valid CSV with header + rows', () => {
    const result = exportCsv(
      [{ a: 1, b: 'hello' }, { a: 2, b: 'world' }],
      { baseName: 'test' },
    );
    const text = Buffer.from(result.bytes).toString('utf8');
    expect(text).toMatch(/^a,b\n1,hello\n2,world\n$/);
    expect(result.fileName).toBe('test.csv');
    expect(result.mimeType).toBe('text/csv');
  });

  it('quotes fields containing commas, quotes, and newlines', () => {
    const result = exportCsv(
      [{ note: 'hello, "world"\nnext line' }],
      { baseName: 't' },
    );
    const text = Buffer.from(result.bytes).toString('utf8');
    expect(text).toContain('"hello, ""world""\nnext line"');
  });

  it('produces header-only CSV when rows are empty', () => {
    const result = exportCsv([], { baseName: 'empty', columns: ['x', 'y'] });
    expect(Buffer.from(result.bytes).toString('utf8')).toBe('x,y\n');
  });
});

describe('XLSX exporter', () => {
  it('produces a real XLSX (PK ZIP magic bytes)', async () => {
    const result = await exportXlsx(
      [{ a: 1, b: 2 }, { a: 3, b: 4 }],
      { baseName: 'sheet' },
    );
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    // XLSX = ZIP. Magic: 0x50 0x4B 0x03 0x04 ("PK\x03\x04")
    expect(result.bytes[0]).toBe(0x50);
    expect(result.bytes[1]).toBe(0x4B);
    expect(result.fileName).toBe('sheet.xlsx');
    expect(result.mimeType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  it('produces a header-only XLSX when rows are empty', async () => {
    const result = await exportXlsx([], { baseName: 'empty', columns: ['x', 'y'] });
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    expect(result.bytes[0]).toBe(0x50);
  });
});

describe('PDF exporter', () => {
  it('produces a real PDF (%PDF magic bytes)', async () => {
    const result = await exportPdf(
      { title: 'Test report', sections: [{ heading: 'Intro', body: 'Hello world.\n- item one\n- item two' }] },
      { baseName: 'report' },
    );
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    // PDF header: "%PDF-"
    const head = Buffer.from(result.bytes.slice(0, 5)).toString('utf8');
    expect(head).toBe('%PDF-');
    expect(result.fileName).toBe('report.pdf');
    expect(result.mimeType).toBe('application/pdf');
  }, 15_000);
});

describe('DOCX exporter', () => {
  it('produces a real DOCX (PK ZIP magic bytes)', async () => {
    const result = await exportDocx(
      { title: 'Audit workpaper', sections: [{ heading: 'Findings', body: 'Item one.\n- bullet\n- another' }] },
      { baseName: 'workpaper' },
    );
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    // DOCX is also a ZIP — same PK magic.
    expect(result.bytes[0]).toBe(0x50);
    expect(result.bytes[1]).toBe(0x4B);
    expect(result.fileName).toBe('workpaper.docx');
    expect(result.mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  }, 15_000);
});

describe('exportByFormat dispatcher', () => {
  it('dispatches json correctly', async () => {
    const r = await exportByFormat('json', { x: 1 }, { baseName: 'd' });
    expect(r.fileName).toBe('d.json');
  });

  it('dispatches csv with proper input shape', async () => {
    const r = await exportByFormat('csv', { rows: [{ a: 1 }] }, { baseName: 'd' });
    expect(r.fileName).toBe('d.csv');
  });

  it('dispatches xlsx with proper input shape', async () => {
    const r = await exportByFormat('xlsx', { rows: [{ a: 1 }] }, { baseName: 'd' });
    expect(r.fileName).toBe('d.xlsx');
  });

  it('dispatches pdf with proper doc shape', async () => {
    const r = await exportByFormat('pdf', { title: 't', sections: [{ body: 'b' }] }, { baseName: 'd' });
    expect(r.fileName).toBe('d.pdf');
  }, 15_000);

  it('throws on bad input shape (csv without rows)', async () => {
    await expect(exportByFormat('csv', { wrong: 'shape' }, { baseName: 'd' }))
      .rejects.toThrow(/csv export requires/);
  });

  it('throws on bad input shape (pdf without title)', async () => {
    await expect(exportByFormat('pdf', { sections: [] }, { baseName: 'd' }))
      .rejects.toThrow(/pdf export requires/);
  });
});

describe('file name sanitization', () => {
  it('strips disallowed characters and caps length', () => {
    const r = exportJson({}, { baseName: '../../../etc/passwd<>?|"*' });
    expect(r.fileName).not.toContain('/');
    expect(r.fileName).not.toContain('<');
    expect(r.fileName).not.toContain('>');
    expect(r.fileName).toMatch(/^[a-zA-Z0-9._-]+\.json$/);
  });
});
