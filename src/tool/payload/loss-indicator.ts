/**
 * Loss indicator object for `<ui9000-loss-indicator>`.
 *
 * One metric that already has a minimum, a maximum, and operating thresholds.
 * The reading is its position on that scale. A health score beside other
 * measures stays a dial. Several metrics stay a KPI card.
 */

const LABEL_KEYS = /^(key|name|label|metric)$/i;
const VALUE_KEYS = /^(value|reading)$/i;
const UNIT_KEYS = /^(unit|measure_unit|uom)$/i;
const MIN_KEYS = /^min$/i;
const MAX_KEYS = /^max$/i;
const TICK_KEYS = /^ticks$/i;
const DECIMALS_KEYS = /^decimals$/i;
const BAND_KEYS = /^(bands|thresholds)$/i;
const TREND_KEYS = /^trend$/i;
const RESERVED =
  /^(key|name|label|metric|value|reading|unit|measure_unit|uom|min|max|ticks|bands|thresholds|trend|decimals|okto|warningto|severeto|criticalto|ok_to|warning_to|severe_to|critical_to)$/i;

type Level = 'ok' | 'warning' | 'severe' | 'critical';

type Band = { from: number; to: number; level: Level; color?: string };

const LEVELS = new Set<Level>(['ok', 'warning', 'severe', 'critical']);

const LEVEL_COLOR: Record<Level, string> = {
  ok: '#3ad07c',
  warning: '#f5c451',
  severe: '#ff9a3c',
  critical: '#ef3b4a',
};

export function lossIndicatorFits(payload: unknown): boolean {
  return readLoss(payload) !== null;
}

export function lossIndicatorPayload(
  _fields: Record<string, string>,
  rows: Record<string, unknown>[],
): unknown | null {
  return readLoss(rows);
}

function readLoss(payload: unknown): Record<string, unknown> | null {
  if (!Array.isArray(payload) || payload.length !== 1) return null;
  const row = payload[0];
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const record = row as Record<string, unknown>;

  const min = num(cell(record, MIN_KEYS));
  const max = num(cell(record, MAX_KEYS));
  if (min === undefined || max === undefined || !(max > min)) return null;

  const metrics = metricKeys(record);
  const explicit = num(cell(record, VALUE_KEYS));
  if (explicit !== undefined && metrics.length > 0) return null;
  if (explicit === undefined && metrics.length !== 1) return null;
  const value = explicit ?? num(record[metrics[0]!]);
  if (value === undefined) return null;

  const bands = bandsOf(record, min, max);
  if (!bands || bands.length === 0) return null;

  const label =
    text(cell(record, LABEL_KEYS)) ||
    (metrics[0] ? labelFromKey(metrics[0]) : '');
  const unit = text(cell(record, UNIT_KEYS)) ?? '';
  const ticks = ticksOf(cell(record, TICK_KEYS), min, max);
  const trend = trendOf(cell(record, TREND_KEYS));
  const decimals = decimalsOf(cell(record, DECIMALS_KEYS));

  const field = explicit !== undefined ? 'value' : metrics[0]!;
  const reading = decimals !== undefined ? value.toFixed(decimals) : value;

  return {
    chartType: 'lossIndicator',
    name: label,
    yAxe: [field],
    data: [
      {
        [field]: reading,
        ...(ticks ? { ticks } : {}),
        ...(trend && trend !== 'flat' ? { trend } : {}),
      },
    ],
    axisDetails: {
      [field]: {
        label: label || field,
        type: 'number',
        subtype: unit === '%' ? 'percent' : 'float',
        ...(unit ? { measure_unit: unit } : {}),
      },
    },
    limitsDomains: [[min, max]],
    domainsLimits: bands.map((band) => ({
      values: [band.from, band.to],
      color: band.color ?? LEVEL_COLOR[band.level],
      level: band.level,
      orientation: 'horizontal' as const,
    })),
  };
}

function bandsOf(row: Record<string, unknown>, min: number, max: number): Band[] | null {
  const explicit = parseBands(cell(row, BAND_KEYS));
  if (explicit.length > 0) return explicit.filter((band) => band.to > band.from);
  return bandsFromThresholds(row, min, max);
}

function parseBands(value: unknown): Band[] {
  let raw: unknown = value;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const bands: Band[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const from = num(record.from);
    const to = num(record.to);
    const level = String(record.level ?? '').trim().toLowerCase();
    if (from === undefined || to === undefined || !LEVELS.has(level as Level)) continue;
    const color = hex(record.color);
    bands.push(color ? { from, to, level: level as Level, color } : { from, to, level: level as Level });
  }
  return bands.sort((a, b) => a.from - b.from);
}

function bandsFromThresholds(
  row: Record<string, unknown>,
  min: number,
  max: number,
): Band[] | null {
  const stops: Array<{ to: number; level: Level }> = [];
  const okTo = num(named(row, /^ok_?to$/i));
  const warningTo = num(named(row, /^warning_?to$/i));
  const severeTo = num(named(row, /^severe_?to$/i));
  if (okTo !== undefined) stops.push({ to: okTo, level: 'ok' });
  if (warningTo !== undefined) stops.push({ to: warningTo, level: 'warning' });
  if (severeTo !== undefined) stops.push({ to: severeTo, level: 'severe' });
  const inside = stops
    .filter((stop) => stop.to > min && stop.to < max)
    .sort((a, b) => a.to - b.to);
  if (inside.length === 0) return null;
  const bands: Band[] = [];
  let from = min;
  for (const stop of inside) {
    if (stop.to <= from) continue;
    bands.push({ from, to: stop.to, level: stop.level });
    from = stop.to;
  }
  if (from < max) bands.push({ from, to: max, level: 'critical' });
  return bands.length > 0 ? bands : null;
}

function ticksOf(value: unknown, min: number, max: number): number[] | undefined {
  let raw: unknown = value;
  if (typeof raw === 'string' && raw.trim()) raw = raw.split(/[, ]+/).filter(Boolean);
  const ticks = Array.isArray(raw)
    ? raw.map((item) => num(item)).filter((item): item is number => item !== undefined)
    : [];
  const usable = [...new Set(ticks.filter((tick) => tick >= min && tick <= max))].sort(
    (a, b) => a - b,
  );
  return usable.length >= 2 ? usable : undefined;
}

function decimalsOf(value: unknown): number | undefined {
  const parsed = num(value);
  if (parsed === undefined || !Number.isInteger(parsed) || parsed < 0 || parsed > 8) return undefined;
  return parsed;
}

function hex(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(text)
    ? text
    : undefined;
}

function metricKeys(row: Record<string, unknown>): string[] {
  return Object.keys(row).filter((key) => !RESERVED.test(key) && num(row[key]) !== undefined);
}

function trendOf(value: unknown): 'up' | 'down' | 'flat' | undefined {
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'up' || text === 'down' || text === 'flat') return text;
  return undefined;
}

function named(row: Record<string, unknown>, pattern: RegExp): unknown {
  const key = Object.keys(row).find((name) => pattern.test(name));
  return key ? row[key] : undefined;
}

function cell(row: Record<string, unknown>, pattern: RegExp): unknown {
  return named(row, pattern);
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

function labelFromKey(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}
