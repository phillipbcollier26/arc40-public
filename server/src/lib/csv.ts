/**
 * CSV reader for bank files. Bank files are UNTRUSTED input, so this is a
 * small hand-written parser with hard limits instead of anything clever.
 * Handles quotes ("a, b"), escaped quotes (""), CRLF/LF, a UTF-8 BOM, and
 * blank lines. Never evaluates anything in the file.
 */

export const CSV_LIMITS = {
  maxBytes: 10 * 1024 * 1024, // 10 MB is years of history for a personal account
  maxRows: 50_000,
  maxColumns: 60,
  maxCellLength: 2_000,
};

export class CsvError extends Error {}

export function parseCsv(text: string): string[][] {
  if (typeof text !== 'string') throw new CsvError('The file could not be read as text.');
  if (Buffer.byteLength(text, 'utf8') > CSV_LIMITS.maxBytes) {
    throw new CsvError('That file is larger than 10 MB. Download a shorter date range and try again.');
  }
  if (text.includes('\u0000')) throw new CsvError('That does not look like a CSV text file.');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;

  const pushCell = () => {
    if (cell.length > CSV_LIMITS.maxCellLength) {
      throw new CsvError(`Row ${rows.length + 1} has a value that is too long.`);
    }
    row.push(cell);
    cell = '';
    if (row.length > CSV_LIMITS.maxColumns) throw new CsvError(`Row ${rows.length + 1} has too many columns.`);
  };
  const pushRow = () => {
    pushCell();
    rows.push(row);
    row = [];
    if (rows.length > CSV_LIMITS.maxRows) {
      throw new CsvError(`That file has more than ${CSV_LIMITS.maxRows.toLocaleString()} rows. Split it into smaller date ranges.`);
    }
  };

  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell.trim() === '') {
      cell = '';
      inQuotes = true;
    } else if (ch === ',') {
      pushCell();
    } else if (ch === '\n' || ch === '\r') {
      pushRow();
      if (ch === '\r' && text[i + 1] === '\n') i++;
    } else {
      cell += ch;
    }
    i++;
  }
  if (inQuotes) throw new CsvError('The file ends in the middle of a quoted value. It may be cut off.');
  if (cell !== '' || row.length > 0) pushRow();

  return rows;
}

export const isBlankRow = (r: readonly string[]) => r.every((c) => c.trim() === '');
