/**
 * Goal burst object for `<ui9000-goal-burst>` (FUS-4235).
 *
 * One goal drawn as its traffic: its agents as a cloud, and its calls thrown
 * as spikes into a sector per resource group, each as long as the call took
 * to be answered. It takes the asset health overview's payload (one goal's
 * agents, and per category its health, problems, held agents, calls and
 * traffic), plus per group its kind, answer times (p50 / p95), bytes a minute
 * and the goals it is shared with, and the fleet's resource group total.
 *
 * The reading is how long the goal's calls take, so every group needs its
 * calls and at least one its answer times. Without answer times the same
 * rows stay the asset health overview, which does not draw them.
 */

import { readOverview, type Overview } from './asset-health-overview.js';

const KIND_KEYS = /^(kind|resource_?kind|group_?kind)$/i;
const P50_KEYS = /^(p50|latency_?p50|p50_?latency|median_?latency)(_?(ms|s))?$/i;
const P95_KEYS = /^(p95|latency_?p95|p95_?latency)(_?(ms|s))?$/i;
const BYTES_KEYS = /^(bytes|bpm|bytes_?per_?minute)$/i;
const SHARED_KEYS = /^(shared_?with|shared_?goals)$/i;
const GROUP_TOTAL_KEYS = /^(resource_?group_?total|resource_?groups_?total|total_?resource_?groups)$/i;

type Latency = { p50?: number | string; p95?: number | string };

type BurstFields = {
  kind?: string;
  latency?: Latency;
  bytes?: number;
  sharedWith?: number;
};

type Burst = Overview<BurstFields> & { resourceGroupTotal?: number };

export function goalBurstPayload(
  _fields: Record<string, string>,
  rows: Record<string, unknown>[],
): unknown | null {
  const burst = readBurst(rows);
  if (!burst) return null;
  return {
    chartType: 'goalBurst',
    ...(burst.name ? { name: burst.name } : {}),
    goal: burst.agents,
    categories: burst.categories,
    ...(burst.resourceGroupTotal !== undefined ? { resourceGroupTotal: burst.resourceGroupTotal } : {}),
  };
}

/**
 * True when the burst should replace the asset health overview: one goal's
 * agents and its resource groups, every group with its calls and at least
 * one with its answer times.
 */
export function goalBurstFits(payload: unknown): boolean {
  if (isRecord(payload)) return readBurst([payload]) !== null;
  if (!Array.isArray(payload)) return false;
  return readBurst(payload.filter(isRecord)) !== null;
}

function readBurst(rows: Record<string, unknown>[]): Burst | null {
  const overview = readOverview(rows, readBurstFields);
  if (!overview) return null;
  if (!overview.categories.every((category) => category.calls !== undefined)) return null;
  if (!overview.categories.some((category) => category.latency)) return null;
  const resourceGroupTotal = readGroupTotal(rows);
  return { ...overview, ...(resourceGroupTotal !== undefined ? { resourceGroupTotal } : {}) };
}

/** What the burst reads of a group besides the overview's category, kept only where sent. */
function readBurstFields(source: Record<string, unknown>): BurstFields {
  const kind = text(cell(source, KIND_KEYS)) ?? text(source.type);
  const latency = readLatency(source);
  const bytes = num(cell(source, BYTES_KEYS));
  const sharedWith = num(cell(source, SHARED_KEYS));
  return {
    ...(kind ? { kind: kind.toLowerCase() } : {}),
    ...(latency ? { latency } : {}),
    ...(bytes !== undefined ? { bytes } : {}),
    ...(sharedWith !== undefined ? { sharedWith } : {}),
  };
}

/**
 * Answer times as sent: a `latency` object, or p50 / p95 columns. Seconds
 * unless the column or the value names its unit (`p95_ms`, `"240ms"`).
 */
function readLatency(source: Record<string, unknown>): Latency | undefined {
  if (isRecord(source.latency)) {
    const p50 = time(source.latency.p50);
    const p95 = time(source.latency.p95);
    return p50 !== undefined || p95 !== undefined
      ? { ...(p50 !== undefined ? { p50 } : {}), ...(p95 !== undefined ? { p95 } : {}) }
      : undefined;
  }
  const p50 = timeColumn(source, P50_KEYS);
  const p95 = timeColumn(source, P95_KEYS);
  if (p50 === undefined && p95 === undefined) return undefined;
  return { ...(p50 !== undefined ? { p50 } : {}), ...(p95 !== undefined ? { p95 } : {}) };
}

function timeColumn(source: Record<string, unknown>, pattern: RegExp): number | string | undefined {
  const key = Object.keys(source).find((name) => pattern.test(name));
  if (!key) return undefined;
  const value = time(source[key]);
  if (typeof value !== 'number') return value;
  return /_?ms$/i.test(key) ? `${value}ms` : value;
}

/** Seconds, or a time with its unit ("240ms", "0.7s", "3m"), as the widget reads it. */
function time(value: unknown): number | string | undefined {
  const n = num(value);
  if (n !== undefined) return n;
  const raw = text(value);
  return raw && /^\d+(\.\d+)?\s*(ms|s|m)$/i.test(raw) ? raw.replace(/\s+/g, '') : undefined;
}

/** The fleet's resource group total: on the overview object, or the same on every row. */
function readGroupTotal(rows: Record<string, unknown>[]): number | undefined {
  if (rows.length === 1 && isRecord(rows[0]) && rows[0].resourceGroupTotal !== undefined) {
    return num(rows[0].resourceGroupTotal);
  }
  const key = rows[0] ? Object.keys(rows[0]).find((name) => GROUP_TOTAL_KEYS.test(name)) : undefined;
  if (!key) return undefined;
  const first = num(rows[0]![key]);
  return first !== undefined && rows.every((row) => num(row[key]) === first) ? first : undefined;
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
