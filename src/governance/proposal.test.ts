import { describe, expect, it } from 'vitest';

import { recordVerdict, createAuditLog, type AuditRecord } from './audit.js';
import { holdAction, openProposalSession } from './proposal.js';
import { classifyActions } from './risk.js';

const AT = '2026-09-24T17:00:00.000Z';

describe('proposal', () => {
  it('holds a high-risk action as a preview and leaves hover alone', () => {
    const session = openProposalSession();
    const [hover, approve] = classifyActions(['hover', 'approve']);

    expect(holdAction(session, hover!)).toBeNull();
    const proposal = holdAction(session, approve!);

    expect(proposal).toMatchObject({
      action: 'approve',
      preview: 'Preview approve. This is not an execution.',
    });
    expect(proposal?.id).toBe('proposal:approve');
    expect(session.proposals).toEqual([proposal]);
  });
});

describe('audit', () => {
  it('records reject with the same fields as approve, and keeps rows out', () => {
    const session = openProposalSession();
    const [approve] = classifyActions(['approve']);
    const proposal = holdAction(session, approve!);
    expect(proposal).not.toBeNull();

    const log = createAuditLog();
    const executed = recordVerdict(log, proposal!, 'approve', AT);
    const rejected = recordVerdict(log, proposal!, 'reject', AT);

    expect(keys(rejected)).toEqual(keys(executed));
    expect(rejected).toEqual({
      proposalId: proposal!.id,
      action: 'approve',
      verdict: 'reject',
      preview: proposal!.preview,
      recordedAt: AT,
    });
    expect(log.entries()).toEqual([executed, rejected]);
    expect(JSON.stringify(log.entries())).not.toMatch(/"(rows|data)"\s*:\s*\[/);
  });

  it('refuses an audit record that smuggles rows and does not append it', () => {
    const log = createAuditLog();
    const dirty = {
      proposalId: 'p1',
      action: 'approve',
      verdict: 'reject',
      preview: 'Preview approve. This is not an execution.',
      recordedAt: AT,
      rows: [{ secret: 1 }],
    } as AuditRecord;

    expect(() => log.append(dirty)).toThrow('audit must not contain rows');
    expect(log.entries()).toEqual([]);
  });
});

function keys(record: AuditRecord): string[] {
  return Object.keys(record).sort();
}
