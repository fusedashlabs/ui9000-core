/**
 * Fill mcp_ui_tool / mcp_ui_chart_id from the known-response fixture and
 * rewrite tests/parity/parity-table.csv (+ .md).
 *
 * Reads fixtures/mcp-ui-responses.json only. Does not call mcp-ui: a live
 * sign would mint a new data-link UUID on every run and the table would
 * never be committable. Re-run this script after editing the fixture.
 *
 * Usage (from packages/core): yarn tsx tests/parity/fill-mcp-ui.ts
 */

import { writeParityTable } from './harness.js';

const { rows } = writeParityTable();
const byIntent = rows.reduce<Record<string, number>>((acc, row) => {
  const intent = /intent=(\w+)/.exec(row.notes)?.[1] ?? 'unknown';
  acc[intent] = (acc[intent] ?? 0) + 1;
  return acc;
}, {});

process.stdout.write(
  `wrote ${rows.length} parity rows (${Object.entries(byIntent)
    .map(([intent, count]) => `${intent}×${count}`)
    .join(', ')})\n`,
);
