/**
 * Column-oriented view of one dataset — the profiler's only input.
 *
 * A Table is the parsed shape of a CSV: header names plus raw cell text in row
 * order. The profiler never sees typed rows, so a fixture CSV and a live
 * dataset go through exactly the same classification.
 */

export type TableColumn = {
  /** Header text, as written. Matching is done on a normalized copy. */
  name: string;
  /** Raw cell text, one entry per row, in row order. */
  values: readonly string[];
};

export type Table = {
  columns: readonly TableColumn[];
};

/** Rows in the table — the longest column wins if a CSV row was short. */
export function tableRowCount(table: Table): number {
  let rows = 0;
  for (const column of table.columns) {
    if (column.values.length > rows) rows = column.values.length;
  }
  return rows;
}

/** Header text reduced to letters and digits: `Created At` and `created_at` match. */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Minimal RFC 4180 reader: quoted fields, `""` escapes, CR/LF or LF, blank
 * lines skipped. Enough for fixtures; the profiler owns no other parsing.
 */
export function parseCsvTable(text: string): Table {
  const rows = parseRows(text);
  const header = rows.shift();
  if (!header) return { columns: [] };

  const columns = header.map((name) => ({ name: name.trim(), values: [] as string[] }));
  for (const row of rows) {
    for (const [index, column] of columns.entries()) {
      column.values.push(row[index] ?? '');
    }
  }
  return { columns };
}

function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }
    if (char === '"') {
      quoted = true;
      i += 1;
      continue;
    }
    if (char === ',') {
      endField();
      i += 1;
      continue;
    }
    if (char === '\r') {
      i += 1;
      continue;
    }
    if (char === '\n') {
      endRow();
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }
  if (field !== '' || row.length > 0) endRow();

  return rows;
}
