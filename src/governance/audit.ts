export const AUDIT_VERDICTS = ['approve', 'reject'] as const;

export type AuditVerdict = (typeof AUDIT_VERDICTS)[number];

/** Same shape for approve and reject. Never carries dataset rows. */
export type AuditRecord = {
  proposalId: string;
  action: string;
  verdict: AuditVerdict;
  preview: string;
  recordedAt: string;
};

export type AuditLog = {
  append(record: AuditRecord): AuditRecord;
  entries(): readonly AuditRecord[];
};

const ROW_KEYS = new Set(['rows', 'data']);

export function assertAuditHasNoRows(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertAuditHasNoRows(item);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (ROW_KEYS.has(key) && Array.isArray(child)) {
      throw new Error('audit must not contain rows');
    }
    assertAuditHasNoRows(child);
  }
}

export function createAuditLog(): AuditLog {
  const records: AuditRecord[] = [];
  return {
    append(record) {
      assertAuditHasNoRows(record);
      const frozen = Object.freeze({ ...record });
      records.push(frozen);
      return frozen;
    },
    entries() {
      return records.map((record) => Object.freeze({ ...record }));
    },
  };
}

export function recordVerdict(
  log: AuditLog,
  proposal: { id: string; action: string; preview: string },
  verdict: AuditVerdict,
  recordedAt: string,
): AuditRecord {
  return log.append({
    proposalId: proposal.id,
    action: proposal.action,
    verdict,
    preview: proposal.preview,
    recordedAt,
  });
}
