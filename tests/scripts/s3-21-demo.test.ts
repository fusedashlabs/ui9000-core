import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  OBJECTIVES,
  demoDir,
  runS321Demo,
  winnersPath,
  writeS321Demo,
} from '../../scripts/s3-21-demo.js';
import { assertTraceHasNoRows } from '../../src/trace/trace.js';

describe('S3-21 cutover demo', () => {
  it('same dataset, four intents, four workspaces, no generate_*', async () => {
    const report = await runS321Demo();
    writeS321Demo(report);

    const recorded = JSON.parse(readFileSync(winnersPath(), 'utf8')) as Record<
      (typeof OBJECTIVES)[number],
      string
    >;

    expect(report.tools_list).toEqual(['show_workspace']);
    expect(report.generate_star_in_tools_list).toBe(false);
    expect(report.workspaces).toHaveLength(4);

    const winners = report.workspaces.map((row) => row.winner);
    expect(winners).toEqual(OBJECTIVES.map((intent) => recorded[intent]));
    expect(new Set(winners).size).toBe(4);

    for (const row of report.workspaces) {
      expect(row.specComponent).toBe(row.winner);
      assertTraceHasNoRows(report.traces[row.intent]);
      const committed = JSON.parse(
        readFileSync(`${demoDir()}/${row.traceFile}`, 'utf8'),
      );
      expect(committed).toEqual(report.traces[row.intent]);
    }
  });
});
