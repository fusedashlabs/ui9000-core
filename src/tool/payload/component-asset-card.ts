/**
 * Component asset object for `<ui9000-component-asset-card>`.
 *
 * One card is one asset and one primary metric, read from one row: the asset
 * name, its id, an optional image, the metric value, an optional delta against
 * a reference point, and optional recent points. Nothing is computed. The delta
 * is sent only when a cell holds one. Points draw the trend only when the table
 * has them. A level is sent only when the row has a status, a level, or a threshold.
 */

const NAME_KEYS = /^(name|title|asset_?name|component|component_?name|equipment_?name|device_?name)$/i;
/** No bare `id`: a row id beside one number is still a plain KPI. */
const ID_KEYS = /^(asset|asset_?id|badge|device|device_?id|equipment|equipment_?id|component_?id|serial)$/i;
const IMAGE_KEYS = /^(image|image_?url|img|picture|photo|illustration)$/i;
const LABEL_KEYS = /^(metric|parameter|label)$/i;
const VALUE_KEYS = /^(value|reading)$/i;
const UNIT_KEYS = /^(unit|measure_unit|uom)$/i;
const LEVEL_KEYS = /^(level|status)$/i;
const WARNING_KEYS = /^warning$/i;
const CRITICAL_KEYS = /^critical$/i;
const DIRECTION_KEYS = /^direction$/i;
const DELTA_KEYS = /^(delta|change)$/i;
const DELTA_UNIT_KEYS = /^(delta|change)_?unit$/i;
const DELTA_LABEL_KEYS = /^((delta|change)_?label|reference|vs|compared_?to)$/i;
const BETTER_KEYS = /^better$/i;
const POINTS_KEYS = /^(points|trend|history|sparkline)$/i;

const NOT_METRIC = [
  NAME_KEYS,
  ID_KEYS,
  IMAGE_KEYS,
  LABEL_KEYS,
  UNIT_KEYS,
  LEVEL_KEYS,
  WARNING_KEYS,
  CRITICAL_KEYS,
  DIRECTION_KEYS,
  DELTA_KEYS,
  DELTA_UNIT_KEYS,
  DELTA_LABEL_KEYS,
  BETTER_KEYS,
  POINTS_KEYS,
];

/** Status words a table may use, read as the card's levels. */
const LEVEL_WORDS: Record<string, 'ok' | 'warning' | 'critical' | 'neutral'> = {
  ok: 'ok',
  normal: 'ok',
  stable: 'ok',
  good: 'ok',
  healthy: 'ok',
  warning: 'warning',
  warn: 'warning',
  high: 'warning',
  degraded: 'warning',
  critical: 'critical',
  alarm: 'critical',
  down: 'critical',
  fault: 'critical',
  neutral: 'neutral',
};

type Thresholds = { warning?: number; critical?: number; direction?: 'above' | 'below' };

type Asset = {
  name?: string;
  assetId?: string;
  image?: string;
  metric?: {
    label?: string;
    value: number | string;
    unit?: string;
    level?: string;
    thresholds?: Thresholds;
  };
  delta?: { value: number; unit?: string; label?: string; better?: 'up' | 'down' };
  points?: number[];
};

export function componentAssetCardPayload(
  _fields: Record<string, string>,
  rows: Record<string, unknown>[],
): unknown | null {
  const asset = readAsset(rows);
  if (!asset?.metric) return null;

  const out: Record<string, unknown> = { chartType: 'componentAssetCard' };
  if (asset.name) out.name = asset.name;
  if (asset.assetId) out.assetId = asset.assetId;
  if (asset.image) out.image = { src: asset.image, alt: asset.name ?? asset.assetId ?? '' };
  out.metric = asset.metric;
  if (asset.delta) out.delta = asset.delta;
  if (asset.points) out.trend = asset.points;
  return out;
}

/**
 * True when the card should replace a KPI: one row naming one asset by its id,
 * with one metric value. A plain number has no asset, so it stays a KPI.
 */
export function componentAssetFits(payload: unknown): boolean {
  if (!Array.isArray(payload)) return false;
  const asset = readAsset(payload.filter(isRecord));
  return !!asset?.assetId && !!asset.metric;
}

/** The one row of the card. Several rows are several assets or several metrics. */
function readAsset(rows: Record<string, unknown>[]): Asset | null {
  if (rows.length !== 1) return null;
  const row = rows[0]!;
  const name = text(cell(row, NAME_KEYS));
  const assetId = text(cell(row, ID_KEYS));
  const image = text(cell(row, IMAGE_KEYS));
  const metric = readMetric(row);
  const delta = readDelta(row);
  const points = readPoints(cell(row, POINTS_KEYS));
  return {
    ...(name ? { name } : {}),
    ...(assetId ? { assetId } : {}),
    ...(image ? { image } : {}),
    ...(metric ? { metric } : {}),
    ...(metric && delta ? { delta } : {}),
    ...(metric && points.length >= 2 ? { points } : {}),
  };
}

/**
 * A `value` column with an optional `metric` label, or else the one numeric
 * column that is not the id, the delta, a threshold, or the points.
 */
function readMetric(row: Record<string, unknown>): Asset['metric'] | undefined {
  const valueKey = keyOf(row, VALUE_KEYS);
  let label: string | undefined;
  let value: number | string | undefined;
  if (valueKey) {
    label = text(cell(row, LABEL_KEYS));
    value = num(row[valueKey]) ?? text(row[valueKey]);
  } else {
    const numeric = Object.keys(row).filter(
      (key) => !NOT_METRIC.some((pattern) => pattern.test(key)) && num(row[key]) !== undefined,
    );
    if (numeric.length !== 1) return undefined;
    label = labelFromKey(numeric[0]!);
    value = num(row[numeric[0]!]);
  }
  if (value === undefined) return undefined;
  const unit = text(cell(row, UNIT_KEYS));
  const level = LEVEL_WORDS[text(cell(row, LEVEL_KEYS))?.toLowerCase() ?? ''];
  const thresholds = readThresholds(row);
  return {
    ...(label ? { label } : {}),
    value,
    ...(unit ? { unit } : {}),
    ...(level ? { level } : {}),
    ...(thresholds ? { thresholds } : {}),
  };
}

function readDelta(row: Record<string, unknown>): Asset['delta'] | undefined {
  const value = num(cell(row, DELTA_KEYS));
  if (value === undefined) return undefined;
  const unit = text(cell(row, DELTA_UNIT_KEYS));
  const label = text(cell(row, DELTA_LABEL_KEYS));
  const better = text(cell(row, BETTER_KEYS))?.toLowerCase();
  return {
    value,
    ...(unit ? { unit } : {}),
    ...(label ? { label } : {}),
    ...(better === 'up' || better === 'down' ? { better } : {}),
  };
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

function keyOf(row: Record<string, unknown>, pattern: RegExp): string | undefined {
  return Object.keys(row).find((name) => pattern.test(name));
}

function cell(row: Record<string, unknown>, pattern: RegExp): unknown {
  const key = keyOf(row, pattern);
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

function labelFromKey(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}
