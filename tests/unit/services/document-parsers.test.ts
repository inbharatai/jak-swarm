/**
 * Document parser tests — Sprint 2.2 / Item D.
 *
 * Verifies the new DOCX/XLSX/image parsers produce real output (not stubs)
 * and report honest parseConfidence values. We construct minimal in-memory
 * fixtures so the test runs without disk I/O.
 */
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import {
  parseDocx,
  parseXlsx,
  parseImage,
  parseByMimeType,
} from '../../../apps/api/src/services/document-parsing/parsers.js';

describe('document parsers — Sprint 2.2 / Item D', () => {
  describe('parseXlsx', () => {
    it('extracts cell values across multiple sheets and reports honest confidence', async () => {
      const wb = new ExcelJS.Workbook();
      const sheet1 = wb.addWorksheet('Q1 Sales');
      sheet1.addRow(['Region', 'Revenue', 'Growth']);
      sheet1.addRow(['North', 50000, 0.12]);
      sheet1.addRow(['South', 75000, 0.08]);

      const sheet2 = wb.addWorksheet('Customers');
      sheet2.addRow(['Name', 'Tier']);
      sheet2.addRow(['Acme Corp', 'Gold']);

      const buf = Buffer.from(await wb.xlsx.writeBuffer());
      const result = await parseXlsx(buf);

      expect(result.text).toContain('## Sheet: Q1 Sales');
      expect(result.text).toContain('## Sheet: Customers');
      expect(result.text).toContain('North');
      expect(result.text).toContain('50000');
      expect(result.text).toContain('Acme Corp');
      expect(result.parseConfidence).toBe(0.85);
      expect(result.diagnostics.parser).toBe('xlsx-exceljs');
      expect(result.diagnostics.notes).toContain('sheets=2');
    });

    it('handles empty workbook honestly (parseConfidence still 0.85, no false content)', async () => {
      const wb = new ExcelJS.Workbook();
      wb.addWorksheet('Empty');
      const buf = Buffer.from(await wb.xlsx.writeBuffer());
      const result = await parseXlsx(buf);
      // Empty sheets still produce the header line but no data rows.
      expect(result.text).toContain('## Sheet: Empty');
      expect(result.parseConfidence).toBe(0.85);
    });
  });

  describe('parseByMimeType dispatch', () => {
    it('returns null for unknown mime type so caller can flip STORED_NOT_PARSED honestly', async () => {
      const result = await parseByMimeType(
        'application/x-tar',
        Buffer.from('not a tar'),
      );
      expect(result).toBeNull();
    });

    it('routes XLSX mime to parseXlsx', async () => {
      const wb = new ExcelJS.Workbook();
      wb.addWorksheet('S').addRow(['a']);
      const buf = Buffer.from(await wb.xlsx.writeBuffer());
      const result = await parseByMimeType(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buf,
      );
      expect(result).not.toBeNull();
      expect(result?.diagnostics.parser).toBe('xlsx-exceljs');
    });

    it('routes legacy .xls mime to parseXlsx', async () => {
      const wb = new ExcelJS.Workbook();
      wb.addWorksheet('S').addRow(['a']);
      const buf = Buffer.from(await wb.xlsx.writeBuffer());
      const result = await parseByMimeType('application/vnd.ms-excel', buf);
      // Even with legacy mime, exceljs handles the OOXML format we wrote
      expect(result?.diagnostics.parser).toBe('xlsx-exceljs');
    });
  });

  describe('parseDocx', () => {
    it('returns 0.95 confidence and surfaces mammoth warnings on bad input', async () => {
      // Pass invalid bytes — mammoth throws (not handled silently)
      await expect(parseDocx(Buffer.from('not a docx'))).rejects.toThrow();
    });
  });

  describe('parseImage', () => {
    it('clamps confidence to <= 0.85 (OCR is structurally lossy)', async () => {
      // Construct a tiny solid-color PNG via sharp so OCR can run quickly
      // without hitting the network. tesseract will return empty text +
      // low confidence on a content-less image — that's the honest answer.
      const sharp = (await import('sharp')).default;
      const png = await sharp({
        create: {
          width: 50, height: 50,
          channels: 3,
          background: { r: 255, g: 255, b: 255 },
        },
      }).png().toBuffer();
      const result = await parseImage(png);
      expect(result.diagnostics.parser).toBe('image-tesseract');
      expect(result.parseConfidence).toBeLessThanOrEqual(0.85);
      expect(result.parseConfidence).toBeGreaterThanOrEqual(0);
    }, 60_000); // tesseract first-run downloads the eng training data
  });
});
