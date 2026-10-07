import type { CatalogEntry } from '../spec/engine-catalog.js';
import type { WorkspaceSpec } from '../spec/workspace-spec.js';
import { isPlaceLabel, type ClassifiedColumn } from '../profiler/roles.js';

export type ShapeSpecResult =
  | { ok: true; spec: WorkspaceSpec }
  | { ok: false; code: 'missing_binds'; reason: string };

/** Bind catalog data roles to columns. One field fills one role. */
export function shapeSpec(
  base: WorkspaceSpec,
  entry: CatalogEntry | undefined,
  fields: readonly string[] | undefined,
  classified?: readonly ClassifiedColumn[],
): ShapeSpecResult {
  const spec: WorkspaceSpec = { ...base };

  const roles = entry?.dataRoles ?? [];
  const requiredRoles = roles.filter((role) => role.required && role.id !== 'fields');
  const optionalRoles = roles.filter((role) => !role.required && role.id !== 'fields');
  const needsFieldsRole = roles.some((role) => role.required && role.id === 'fields');
  const namesResult = normalizeFieldNames(fields, requiredRoles.map((role) => role.id));
  if (!namesResult.ok) {
    return fail(
      'Catalog field names must be a list of non-empty strings on the server context, not row objects.',
    );
  }
  const names = namesResult.names;

  if (requiredRoles.length > 0 && !classified?.length && names.length < requiredRoles.length) {
    return fail(
      'Catalog required data roles need column names; pass fields on the server context, not in tool arguments.',
    );
  }

  const binds: { role: string; field: string }[] = [];
  const usedFields = new Set<string>();
  for (let index = 0; index < requiredRoles.length; index += 1) {
    const role = requiredRoles[index]!;
    const field = classified?.length
      ? fieldForRole(role.id, classified, usedFields)
      : unusedName(names, index, usedFields);
    if (!field) {
      return fail(
        `No unused column matches catalog role "${role.id}". A field cannot fill two roles.`,
      );
    }
    binds.push({ role: role.id, field });
    usedFields.add(field);
  }

  if (classified?.length) {
    const usedRoles = new Set(binds.map((item) => item.role));
    for (const role of optionalRoles) {
      if (usedRoles.has(role.id)) continue;
      const field = fieldForRole(role.id, classified, usedFields);
      if (!field || usedFields.has(field)) continue;
      binds.push({ role: role.id, field });
      usedFields.add(field);
    }
  }

  if (binds.length > 0) spec.binds = binds;
  if (entry?.accessibility?.nameFrom) {
    spec.label = labelFromBinds(binds) ?? entry.id;
  }

  if (needsFieldsRole || binds.length > 0) {
    const labels = classified?.length
      ? classified.map((column) => column.column.name)
      : names.length > 0
        ? names
        : ['Field'];
    spec.fields = labels.map((name) => ({ name, label: name }));
  }

  return { ok: true, spec };
}

/** Catalog dataRole id → profiler column roles. First unused match wins. */
const ROLE_COLUMN: Record<string, readonly ClassifiedColumn['role'][]> = {
  category: ['category'],
  series: ['category'],
  group: ['category'],
  groupBy: ['category'],
  /** Ordered axis first, then a category, for line and area. */
  x: ['temporal', 'category'],
  /** Category first, then time, for pie, lollipop, and the other discrete marks. */
  label: ['category', 'temporal'],
  y: ['metric'],
  /** Two numeric axes. Each bind takes the next unused metric. */
  mx: ['metric'],
  my: ['metric'],
  source: ['link', 'category'],
  target: ['link', 'category'],
  metric: ['metric'],
  distribution: ['metric'],
  geo: ['geo'],
  proposal: ['entity', 'claim'],
  claim: ['claim'],
  entity: ['entity'],
  nodes: ['node', 'link'],
  links: ['link'],
  events: ['event'],
  sources: ['sources'],
  rows: ['category', 'metric', 'entity', 'geo'],
};

function labelFromBinds(binds: readonly { role: string; field: string }[]): string | undefined {
  const field = (role: string) => binds.find((item) => item.role === role)?.field;
  const metric = field('metric') ?? field('y') ?? field('distribution');
  const category = field('category') ?? field('label') ?? field('x') ?? field('geo');
  const nodes = field('nodes');
  const links = field('links');
  if (metric && nodes && links && metric !== nodes && metric !== links) {
    return `${metric} from ${nodes} to ${links}`;
  }
  if (metric && category && metric !== category) return `${metric} by ${category}`;
  if (metric) return metric;
  return undefined;
}

function fieldForRole(
  roleId: string,
  classified: readonly ClassifiedColumn[],
  used: ReadonlySet<string>,
): string | undefined {
  const wanted = ROLE_COLUMN[roleId] ?? [roleId as ClassifiedColumn['role']];
  for (const role of wanted) {
    const hit = classified.find(
      (entry) => entry.role === role && !used.has(entry.column.name),
    );
    if (hit) return hit.column.name;
  }
  if (!CATEGORY_ROLES.has(roleId)) return undefined;
  if (classified.some((entry) => entry.role === 'category')) return undefined;
  const place = classified.find(
    (entry) => isPlaceLabel(entry) && !used.has(entry.column.name),
  );
  return place?.column.name;
}

/** Roles a discrete group fills. A place name fills them only when no category column exists. */
const CATEGORY_ROLES = new Set(['category', 'label', 'x', 'series', 'group', 'groupBy']);

function unusedName(
  names: readonly string[],
  index: number,
  used: ReadonlySet<string>,
): string | undefined {
  const preferred = names[index];
  if (preferred && !used.has(preferred)) return preferred;
  return names.find((name) => !used.has(name));
}

function normalizeFieldNames(
  fields: readonly unknown[] | undefined,
  fallback: string[],
): { ok: true; names: string[] } | { ok: false } {
  if (fields === undefined) return { ok: true, names: fallback };
  if (!Array.isArray(fields)) return { ok: false };
  const names: string[] = [];
  for (const item of fields) {
    if (typeof item !== 'string') return { ok: false };
    const name = item.trim();
    if (!name) return { ok: false };
    names.push(name);
  }
  return { ok: true, names };
}

function fail(reason: string): ShapeSpecResult {
  return { ok: false, code: 'missing_binds', reason };
}
