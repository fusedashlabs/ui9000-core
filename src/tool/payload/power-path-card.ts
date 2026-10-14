/**
 * Power path object for `<ui9000-power-path-card>`.
 *
 * One card is one equipment group: a title, an asset badge, the health score,
 * an active fault, and one row per monitored metric. The score is read from the
 * table, never computed. Points draw the compact line only when the table has them.
 * The fault is sent only when a cell names one. A status is sent only when the
 * row has a status, a level, or a threshold.
 */

const HEALTH = /health|condition/i;
const LABEL_KEYS = /^(key|name|label|metric|parameter)$/i;
const VALUE_KEYS = /^(value|reading)$/i;
const UNIT_KEYS = /^(unit|measure_unit|uom)$/i;
const STATUS_KEYS = /^status$/i;
const LEVEL_KEYS = /^level$/i;
const ROLE_KEYS = /^role$/i;
const WARNING_KEYS = /^warning$/i;
const CRITICAL_KEYS = /^critical$/i;
const DIRECTION_KEYS = /^direction$/i;
const POINTS_KEYS = /^(points|trend|history|sparkline)$/i;
const TITLE_KEYS = /^(title|power_?path|path|group|sector)$/i;
const BADGE_KEYS = /^(badge|asset|asset_?id|equipment|device)$/i;
const FAULT_KEYS = /^(fault|alert|alarm)$/i;
const FAULT_LEVEL_KEYS = /^(fault_?level|alert_?level|alarm_?level)$/i;
const NO_FAULT = /^(none|no|false|ok|n\/a|na|-|0)$/i;

type Thresholds = { warning?: number; critical?: number; direction?: 'above' | 'below' };

type PathRow = {
  key: string;
  label: string;
  value: number | string;
  unit: string;
  role?: string;
  status?: string;
  level?: string;
  thresholds?: Thresholds;
  points?: number[];
};

type PowerPath = {
  title?: string;
  badge?: string;
  fault?: { active: true; message: string; level?: string };
  health?: PathRow;
  metrics: PathRow[];
};

export function powerPathCardPayload(
  _fields: Record<string, string>,
  rows: Record<string, unknown>[],
): unknown | null {
  const path = readPath(rows);
  if (!path || (!path.health && path.metrics.length === 0)) return null;

  const out: Record<string, unknown> = {
    chartType: 'powerPathCard',
    name: path.title || 'Power Path',
  };
  if (path.badge) out.badge = path.badge;
  if (path.health) out.health = healthObject(path.health);
  if (path.fault) out.fault = path.fault;
  out.data = path.metrics.map(metricObject);
  return out;
}

/**
 * True when the card should replace a KPI: one equipment group, an existing
 * health score, and other metrics that each carry a status. A row marked
 * `role: gauge` asks for the dial, so the card steps aside.
 */
export function powerPathFits(payload: unknown): boolean {
  if (!Array.isArray(payload)) return false;
  const path = readPath(payload.filter(isRecord));
  if (!path?.health || path.health.role === 'gauge' || path.metrics.length === 0) return false;
  return path.metrics.every(hasStatus);
}

function readPath(rows: Record<string, unknown>[]): PowerPath | null {
  if (rows.length === 0) return null;
  const title = single(rows, TITLE_KEYS);
  const badge = single(rows, BADGE_KEYS);
  if (title === null || badge === null) return null;
  const items = isLongForm(rows) ? longItems(rows) : wideItems(rows[0]!);
  const healthIndex = findHealth(items);
  const health = healthIndex >= 0 ? items[healthIndex] : undefined;
  return {
    ...(title ? { title } : {}),
    ...(badge ? { badge } : {}),
    ...readFault(rows),
    ...(health ? { health } : {}),
    metrics: items.filter((_, index) => index !== healthIndex),
  };
}

/**
 * The one text value of a column across all rows. Undefined when the column is
 * absent or blank. Null when rows disagree, so the table holds several groups.
 */
function single(rows: Record<string, unknown>[], pattern: RegExp): string | undefined | null {
  const key = Object.keys(rows[0] ?? {}).find((name) => pattern.test(name));
  if (!key) return undefined;
  const values = new Set(rows.map((row) => text(row[key])).filter((value): value is string => !!value));
  if (values.size > 1) return null;
  return values.values().next().value;
}

function isLongForm(rows: Record<string, unknown>[]): boolean {
  const keys = Object.keys(rows[0] ?? {});
  return keys.some((key) => LABEL_KEYS.test(key)) && keys.some((key) => VALUE_KEYS.test(key));
}

function longItems(rows: Record<string, unknown>[]): PathRow[] {
  const sample = rows[0] ?? {};
  const labelKey = Object.keys(sample).find((key) => LABEL_KEYS.test(key));
  const valueKey = Object.keys(sample).find((key) => VALUE_KEYS.test(key));
  if (!labelKey || !valueKey) return [];
  const items: PathRow[] = [];
  for (const row of rows) {
    const label = String(row[labelKey] ?? '').trim();
    const value = num(row[valueKey]) ?? text(row[valueKey]);
    if (!label || value === undefined) continue;
    const thresholds = readThresholds(row);
    const points = readPoints(cell(row, POINTS_KEYS));
    const status = text(cell(row, STATUS_KEYS));
    const level = text(cell(row, LEVEL_KEYS));
    const role = text(cell(row, ROLE_KEYS))?.toLowerCase();
    items.push({
      key: slug(label),
      label,
      value,
      unit: String(cell(row, UNIT_KEYS) ?? '').trim(),
      ...(role ? { role } : {}),
      ...(status ? { status } : {}),
      ...(level ? { level } : {}),
      ...(thresholds ? { thresholds } : {}),
      ...(points.length > 0 ? { points } : {}),
    });
  }
  return items;
}

/** One row of numeric columns. Text columns are the title, badge, or fault, not metrics. */
function wideItems(sample: Record<string, unknown>): PathRow[] {
  const items: PathRow[] = [];
  for (const key of Object.keys(sample)) {
    if ([TITLE_KEYS, BADGE_KEYS, FAULT_KEYS, FAULT_LEVEL_KEYS].some((pattern) => pattern.test(key))) continue;
    const value = num(sample[key]);
    if (value === undefined) continue;
    items.push({ key: slug(key), label: labelFromKey(key), value, unit: '' });
  }
  return items;
}

/** An explicit health, score, or gauge role first, then a health or condition name. */
function findHealth(items: PathRow[]): number {
  const explicit = items.findIndex(
    (item) => item.role === 'health' || item.role === 'score' || item.role === 'gauge',
  );
  if (explicit >= 0) return typeof items[explicit]!.value === 'number' ? explicit : -1;
  return items.findIndex(
    (item) => typeof item.value === 'number' && (HEALTH.test(item.label) || HEALTH.test(item.key)),
  );
}

/** Fault text from any row. Blank or "none" is no fault. Distinct faults join in one banner. */
function readFault(rows: Record<string, unknown>[]): Pick<PowerPath, 'fault'> {
  const messages: string[] = [];
  let level: string | undefined;
  for (const row of rows) {
    const message = text(cell(row, FAULT_KEYS));
    if (!message || NO_FAULT.test(message) || messages.includes(message)) continue;
    messages.push(message);
    level ??= text(cell(row, FAULT_LEVEL_KEYS));
  }
  if (messages.length === 0) return {};
  return { fault: { active: true, message: messages.join(' · '), ...(level ? { level } : {}) } };
}

function readThresholds(row: Record<string, unknown>): Thresholds | undefined {
  const warning = num(cell(row, WARNING_KEYS));
  const critical = num(cell(row, CRITICAL_KEYS));
  if (warning === undefined && critical === undefined) return undefined;
  const direction = text(cell(row, DIRECTION_KEYS))?.toLowerCase();
  return {
    ...(warning !== undefined ? { warning } : {}),
    ...(critical !== undefined ? { critical } : {}),
    ...(direction === 'above' || direction === 'below' ? { direction } : {}),
  };
}

/** An array of numbers, or one cell of numbers split on spaces, commas, semicolons, or bars. */
function readPoints(value: unknown): number[] {
  const parts = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\s,;|]+/)
      : [];
  return parts.map(num).filter((point): point is number => point !== undefined);
}

function hasStatus(item: PathRow): boolean {
  return !!item.status || !!item.level || !!item.thresholds;
}

function healthObject(item: PathRow): Record<string, unknown> {
  return {
    label: item.label,
    value: item.value,
    ...(item.unit ? { unit: item.unit } : {}),
    ...(item.status ? { status: item.status } : {}),
    ...(item.level ? { level: item.level } : {}),
    ...(item.points ? { points: item.points } : {}),
  };
}

function metricObject(item: PathRow): Record<string, unknown> {
  return {
    key: item.key,
    label: item.label,
    value: item.value,
    ...(item.unit ? { unit: item.unit } : {}),
    ...(item.status ? { status: item.status } : {}),
    ...(item.level ? { level: item.level } : {}),
    ...(item.thresholds ? { thresholds: item.thresholds } : {}),
  };
}

function cell(row: Record<string, unknown>, pattern: RegExp): unknown {
  const key = Object.keys(row).find((name) => pattern.test(name));
  return key ? row[key] : undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const trimmed = String(value).trim();
  return trimmed || undefined;
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function slug(value: string): string {
  if (/^[A-Za-z][A-Za-z0-9]*$/.test(value)) {
    return value.charAt(0).toLowerCase() + value.slice(1);
  }
  const cleaned = value.replace(/[^a-zA-Z0-9]+/g, ' ').trim();
  if (!cleaned) return 'metric';
  const parts = cleaned.split(/\s+/);
  return parts
    .map((part, index) =>
      index === 0 ? part.toLowerCase() : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(),
    )
    .join('');
}

function labelFromKey(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}
