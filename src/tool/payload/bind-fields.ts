import type { SpecBindItem, WorkspaceSpec } from '../../spec/workspace-spec.js';

export function bindFieldMap(
  binds: WorkspaceSpec['binds'],
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!binds) return out;
  if (Array.isArray(binds)) {
    for (const item of binds as SpecBindItem[]) {
      if (item?.role && item.field) out[item.role] = item.field;
    }
    return out;
  }
  for (const [role, value] of Object.entries(binds)) {
    const field = typeof value === 'string' ? value : value?.field;
    if (role && field) out[role] = field;
  }
  return out;
}
