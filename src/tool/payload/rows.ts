export function asRowObjects(payload: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(payload) || payload.length === 0) return null;
  const rows: Record<string, unknown>[] = [];
  for (const item of payload) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    rows.push(item as Record<string, unknown>);
  }
  return rows;
}

export function aggregatePoints(
  rows: Record<string, unknown>[],
  labelField: string | undefined,
  metricField: string | undefined,
  relabel: (label: string) => string = (label) => label,
): Array<{ label: string; value: number }> | null {
  if (!labelField || !metricField) return null;
  if (!(labelField in rows[0]!) || !(metricField in rows[0]!)) return null;
  const sums = new Map<string, number>();
  for (const row of rows) {
    const label = relabel(String(row[labelField] ?? '').trim());
    const value = Number(row[metricField]);
    if (!label || !Number.isFinite(value)) continue;
    sums.set(label, (sums.get(label) ?? 0) + value);
  }
  if (sums.size === 0) return null;
  return [...sums.entries()].map(([label, value]) => ({ label, value }));
}

export function numericColumn(
  rows: Record<string, unknown>[],
  field: string | undefined,
): number[] | null {
  if (!field || !(field in rows[0]!)) return null;
  const values: number[] = [];
  for (const row of rows) {
    const n = Number(row[field]);
    if (!Number.isFinite(n)) continue;
    values.push(n);
  }
  return values.length > 0 ? values : null;
}
