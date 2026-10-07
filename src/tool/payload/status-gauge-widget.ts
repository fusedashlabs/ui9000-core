/**
 * Status gauge object for `<ui9000-status-gauge-widget>`.
 *
 * The dial is used only when the table already contains a health or condition
 * score and at least one other measure. The score is not computed here.
 * Without that score, an explicit request still draws the measures as cards.
 */

const HEALTH = /health|condition/i;
const LABEL_KEYS = /^(key|name|label|metric)$/i;
const VALUE_KEYS = /^(value|reading)$/i;
const UNIT_KEYS = /^(unit|measure_unit|uom)$/i;
const STATUS_KEYS = /^status$/i;
const LEVEL_KEYS = /^level$/i;
const MIN_KEYS = /^min$/i;
const MAX_KEYS = /^max$/i;
const ROLE_KEYS = /^role$/i;

type GaugeRow = {
  key: string;
  role: 'gauge' | 'metric';
  value: number;
  status?: string;
  level?: string;
  min?: number;
  max?: number;
  label: string;
  unit: string;
};

export function statusGaugeWidgetPayload(
  _fields: Record<string, string>,
  rows: Record<string, unknown>[],
): unknown | null {
  const items = readItems(rows);
  if (!items || items.length === 0) return null;
  const shaped = assignRoles(items);
  if (shaped.length === 0) return null;

  const axisDetails: Record<string, { label: string; measure_unit: string }> = {};
  const data = shaped.map((item) => {
    axisDetails[item.key] = { label: item.label, measure_unit: item.unit };
    const row: Record<string, unknown> = {
      key: item.key,
      role: item.role,
      value: item.value,
    };
    if (item.status) row.status = item.status;
    if (item.level) row.level = item.level;
    if (item.min !== undefined) row.min = item.min;
    if (item.max !== undefined) row.max = item.max;
    return row;
  });

  const gauge = shaped.find((item) => item.role === 'gauge');
  return {
    chartType: 'statusGaugeWidget',
    name: gauge?.label || 'Status',
    xAxe: ['key'],
    yAxe: ['value'],
    data,
    axisDetails,
  };
}

/** True when the dial should replace a KPI card: a health score plus other measures. */
export function statusGaugeFits(payload: unknown): boolean {
  if (!Array.isArray(payload)) return false;
  const rows = payload.filter(isRecord);
  const items = readItems(rows);
  if (!items) return false;
  return assignRoles(items).some((item) => item.role === 'gauge');
}

function readItems(rows: Record<string, unknown>[]): GaugeRow[] | null {
  if (rows.length === 0) return null;
  return isLongForm(rows) ? longItems(rows) : wideItems(rows);
}

function isLongForm(rows: Record<string, unknown>[]): boolean {
  const keys = Object.keys(rows[0] ?? {});
  return keys.some((key) => LABEL_KEYS.test(key)) && keys.some((key) => VALUE_KEYS.test(key));
}

function longItems(rows: Record<string, unknown>[]): GaugeRow[] {
  const sample = rows[0] ?? {};
  const labelKey = Object.keys(sample).find((key) => LABEL_KEYS.test(key));
  const valueKey = Object.keys(sample).find((key) => VALUE_KEYS.test(key));
  if (!labelKey || !valueKey) return [];
  const items: GaugeRow[] = [];
  for (const row of rows) {
    const value = num(row[valueKey]);
    const label = String(row[labelKey] ?? '').trim();
    if (value === undefined || !label) continue;
    const roleText = String(cell(row, ROLE_KEYS) ?? '').trim().toLowerCase();
    items.push({
      key: slug(label),
      role: roleText === 'gauge' ? 'gauge' : 'metric',
      value,
      label,
      unit: String(cell(row, UNIT_KEYS) ?? '').trim(),
      status: text(cell(row, STATUS_KEYS)),
      level: text(cell(row, LEVEL_KEYS)),
      min: num(cell(row, MIN_KEYS)),
      max: num(cell(row, MAX_KEYS)),
    });
  }
  return items;
}

/** Scale and threshold columns describe a measure. They are not measures themselves. */
const SCALE_KEYS =
  /^(min|max|ticks|bands|thresholds|trend|decimals|ok_?to|warning_?to|severe_?to|critical_?to)$/i;

function wideItems(rows: Record<string, unknown>[]): GaugeRow[] {
  const sample = rows[0];
  if (!sample) return [];
  const items: GaugeRow[] = [];
  for (const key of Object.keys(sample)) {
    if (SCALE_KEYS.test(key)) continue;
    const value = num(sample[key]);
    if (value === undefined) continue;
    items.push({
      key: slug(key),
      role: 'metric',
      value,
      label: labelFromKey(key),
      unit: '',
    });
  }
  return items;
}

/**
 * The dial is the one health or condition row, and only when other measures
 * sit beside it. An explicit `role: "gauge"` counts as that score.
 */
function assignRoles(items: GaugeRow[]): GaugeRow[] {
  const explicit = items.filter((item) => item.role === 'gauge');
  const named = items.filter(
    (item) => item.role !== 'gauge' && (HEALTH.test(item.label) || HEALTH.test(item.key)),
  );
  const gauge = explicit[0] ?? named[0];
  const others = items.filter((item) => item !== gauge);
  if (!gauge || others.length === 0) {
    return items.map((item) => ({ ...item, role: 'metric' }));
  }
  return items.map((item) => ({
    ...item,
    role: item === gauge ? 'gauge' : 'metric',
  }));
}

function cell(row: Record<string, unknown>, pattern: RegExp): unknown {
  const key = Object.keys(row).find((name) => pattern.test(name));
  return key ? row[key] : undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
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
