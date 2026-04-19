/** Escape a field for RFC 4180-style CSV (comma-separated). */
export function csvEscape(value: string): string {
  const s = value ?? '';
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Build one CSV row from string cells. */
export function csvRow(cells: string[]): string {
  return cells.map(csvEscape).join(',');
}

/**
 * Minimal CSV parser: supports quoted fields with doubled quotes.
 * Returns rows as string[][]; empty lines are skipped.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const len = text.length;

  const pushField = () => {
    row.push(field);
    field = '';
  };

  const pushRow = () => {
    if (row.length > 1 || (row.length === 1 && row[0] !== '')) {
      rows.push(row);
    }
    row = [];
  };

  for (let i = 0; i < len; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      pushField();
    } else if (c === '\r') {
      if (text[i + 1] === '\n') i++;
      pushField();
      pushRow();
    } else if (c === '\n') {
      pushField();
      pushRow();
    } else {
      field += c;
    }
  }
  pushField();
  if (row.some((cell) => cell.length > 0)) {
    rows.push(row);
  }
  return rows;
}

/** Normalize header: lowercase, trim, replace spaces with underscore. */
export function normalizeCsvHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, '_');
}
