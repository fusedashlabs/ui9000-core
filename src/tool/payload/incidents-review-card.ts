/**
 * Incidents review object for `<ui9000-incidents-review-card>`.
 *
 * One card is aggregated incident counts by state for one scope: a title, an
 * optional filter, the counts, an optional total, and whether the lifecycle
 * track is shown. The counts are headlines. Nothing is summed, and the total
 * is sent only when the table has one. A column must name incidents, so a
 * plain set of headline numbers stays a KPI.
 *
 * Two shapes are read: one row per state (`state,incidents`, with an optional
 * `Total` row), or one row with a column per state (`active_incidents,
 * in_progress_incidents,total_incidents`).
 */

const INCIDENT = /incident/i;
const TITLE_KEYS = /^title$/i;
/** A lifecycle: these states are stages, so the track is drawn. */
const LIFECYCLE_KEYS = /^(incident_?)?(state|status|stage|lifecycle_?stage)$/i;
/** Categories, not stages: the numbers stay, the track does not. */
const CATEGORY_KEYS = /^(incident_?)?(severity|category|priority|type)$/i;
const COUNT_KEYS = /^(incidents?|incident_?count|count|value|n)$/i;
const TONE_KEYS = /^(tone|colou?r)$/i;
const TRACK_KEYS = /^(track|lifecycle|has_?lifecycle)$/i;
const RADIUS_KEYS = /^(radius|distance|within)(_?(km|m|mi))?$/i;
const SCOPE_KEYS = /^(filter|scope|site|region|network|area|zone|operational_?unit|period|time_?range|window)$/i;
const TOTAL_WORDS = /^(total|all|all_?incidents|overall)$/i;

/** More states than this is a comparison, not a summary card. */
const MAX_STATES = 6;

type Count = { label: string; value: number; tone?: string };
type Filter = { label: string; kind?: string };
type Incidents = {
  title?: string;
  filter?: Filter;
  counts: Count[];
  total?: number;
  track: boolean;
};

export function incidentsReviewCardPayload(
  _fields: Record<string, string>,
  rows: Record<string, unknown>[],
): unknown | null {
  const incidents = readIncidents(rows);
  if (!incidents) return null;

  const out: Record<string, unknown> = { chartType: 'incidentsReviewCard' };
  out.title = incidents.title ?? 'Incidents review';
  if (incidents.filter) out.filter = incidents.filter;
  out.counts = incidents.counts;
  if (incidents.total !== undefined) out.total = incidents.total;
  out.track = incidents.track;
  return out;
}

/**
 * True when the card should replace a KPI: aggregated incident counts by
 * state for one scope, at least two numbers in all.
 */
export function incidentsReviewFits(payload: unknown): boolean {
  if (!Array.isArray(payload)) return false;
  return readIncidents(payload.filter(isRecord)) !== null;
}

function readIncidents(rows: Record<string, unknown>[]): Incidents | null {
  if (rows.length === 0) return null;
  if (!Object.keys(rows[0]!).some((key) => INCIDENT.test(key))) return null;
  const incidents = keyOf(rows[0]!, LIFECYCLE_KEYS) || keyOf(rows[0]!, CATEGORY_KEYS)
    ? readLong(rows)
    : rows.length === 1
      ? readWide(rows[0]!)
      : null;
  if (!incidents || incidents.counts.length === 0 || incidents.counts.length > MAX_STATES) return null;
  if (incidents.counts.length + (incidents.total === undefined ? 0 : 1) < 2) return null;
  return incidents;
}

/** One row per state. The scope must be the same on every row. */
function readLong(rows: Record<string, unknown>[]): Incidents | null {
  const first = rows[0]!;
  const lifecycleKey = keyOf(first, LIFECYCLE_KEYS);
  const stateKey = lifecycleKey ?? keyOf(first, CATEGORY_KEYS)!;
  const countKey = keyOf(first, COUNT_KEYS) ?? onlyNumericKey(rows, stateKey);
  if (!countKey) return null;
  const toneKey = keyOf(first, TONE_KEYS);

  const counts: Count[] = [];
  const seen = new Set<string>();
  let total: number | undefined;
  for (const row of rows) {
    const label = text(row[stateKey]);
    const value = num(row[countKey]);
    if (!label || value === undefined) return null;
    if (TOTAL_WORDS.test(label.replace(/\s+/g, '_'))) {
      if (total !== undefined) return null;
      total = value;
      continue;
    }
    // A repeated state means another dimension (per region, per day): not one card.
    if (seen.has(label.toLowerCase())) return null;
    seen.add(label.toLowerCase());
    const tone = toneKey ? text(row[toneKey])?.toLowerCase() : undefined;
    counts.push({ label, value, ...(tone ? { tone } : {}) });
  }

  const filter = readFilter(rows);
  if (filter === null) return null;
  const title = sameText(rows, TITLE_KEYS);
  return {
    ...(title ? { title } : {}),
    ...(filter ? { filter } : {}),
    counts,
    ...(total !== undefined ? { total } : {}),
    track: readTrack(first) ?? (!!lifecycleKey && counts.length >= 2),
  };
}

/** One row, a column per state. Every number must be an incident count or the radius. */
function readWide(row: Record<string, unknown>): Incidents | null {
  const counts: Count[] = [];
  let total: number | undefined;
  for (const key of Object.keys(row)) {
    const value = num(row[key]);
    if (value === undefined || RADIUS_KEYS.test(key) || TRACK_KEYS.test(key)) continue;
    if (!INCIDENT.test(key)) return null;
    const label = stateFromKey(key);
    if (!label || TOTAL_WORDS.test(label.replace(/\s+/g, '_'))) {
      if (total !== undefined) return null;
      total = value;
    } else {
      counts.push({ label, value });
    }
  }
  const filter = readFilter([row]);
  const title = text(cell(row, TITLE_KEYS));
  return {
    ...(title ? { title } : {}),
    ...(filter ? { filter } : {}),
    counts,
    ...(total !== undefined ? { total } : {}),
    track: readTrack(row) ?? counts.length >= 2,
  };
}

/**
 * A radius (`radius_km` 5 → `5 km`) or a named scope (site, region, network,
 * area, period). Undefined when there is none; null when rows disagree.
 */
function readFilter(rows: Record<string, unknown>[]): Filter | undefined | null {
  const first = rows[0]!;
  const radiusKey = keyOf(first, RADIUS_KEYS);
  if (radiusKey) {
    const raw = sameText(rows, RADIUS_KEYS);
    if (raw === null) return null;
    if (raw) {
      const unit = radiusKey.match(/_?(km|mi|m)$/i)?.[1]?.toLowerCase();
      const label = unit && num(raw) !== undefined ? `${raw} ${unit}` : raw;
      return { label, kind: 'radius' };
    }
  }
  const scopeKey = keyOf(first, SCOPE_KEYS);
  if (!scopeKey) return undefined;
  const label = sameText(rows, SCOPE_KEYS);
  if (label === null) return null;
  if (!label) return undefined;
  const kind = scopeKey.toLowerCase().replace(/_/g, '');
  return kind === 'filter' || kind === 'scope' ? { label } : { label, kind };
}

function readTrack(row: Record<string, unknown>): boolean | undefined {
  const value = text(cell(row, TRACK_KEYS))?.toLowerCase();
  if (value === 'true' || value === 'yes' || value === '1') return true;
  if (value === 'false' || value === 'no' || value === '0') return false;
  return undefined;
}

/** `in_progress_incidents` → `In progress`; `total_incidents` and `incidents` → empty or `total`. */
function stateFromKey(key: string): string {
  const words = key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter((word) => word && !/^(incidents?|count|num|number|of)$/i.test(word))
    .join(' ')
    .toLowerCase();
  return words ? words[0]!.toUpperCase() + words.slice(1) : '';
}

/** The one numeric column besides the state, or undefined. */
function onlyNumericKey(rows: Record<string, unknown>[], stateKey: string): string | undefined {
  const numeric = Object.keys(rows[0]!).filter(
    (key) =>
      key !== stateKey &&
      !RADIUS_KEYS.test(key) &&
      !TRACK_KEYS.test(key) &&
      rows.every((row) => num(row[key]) !== undefined),
  );
  return numeric.length === 1 ? numeric[0] : undefined;
}

/** The value every row shares; undefined when absent, null when rows differ. */
function sameText(rows: Record<string, unknown>[], pattern: RegExp): string | undefined | null {
  const values = new Set(rows.map((row) => text(cell(row, pattern))).filter(Boolean));
  if (values.size > 1) return null;
  return values.values().next().value;
}

function keyOf(row: Record<string, unknown>, pattern: RegExp): string | undefined {
  return Object.keys(row).find((name) => pattern.test(name));
}

function cell(row: Record<string, unknown>, pattern: RegExp): unknown {
  const key = keyOf(row, pattern);
  return key ? row[key] : undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return undefined;
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
