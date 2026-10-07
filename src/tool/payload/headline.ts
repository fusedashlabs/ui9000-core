/**
 * Headline family. The main drawing is the KPI card.
 *
 * Call the dial only when a health score already sits beside other measures.
 * Call the loss indicator only when one metric already has a minimum, a
 * maximum, and operating thresholds. Call the component asset card only when
 * one row names an asset by its id and holds one metric. A plain number, or
 * several metrics, stays the KPI card.
 */

import { componentAssetFits } from './component-asset-card.js';
import { lossIndicatorFits } from './loss-indicator.js';
import { statusGaugeFits } from './status-gauge-widget.js';

export const HEADLINE_CHARTS = [
  'kpi-widget',
  'status-gauge-widget',
  'loss-indicator',
  'component-asset-card',
] as const;

export type HeadlineChart = (typeof HEADLINE_CHARTS)[number];

export function isHeadlineChart(id: string): id is HeadlineChart {
  return (HEADLINE_CHARTS as readonly string[]).includes(id);
}

/**
 * Which headline drawing the rows support. Gauge is checked before the loss
 * scale, and the scale before the asset card, which needs no minimum or maximum.
 */
export function headlineChart(payload: unknown): HeadlineChart {
  if (statusGaugeFits(payload)) return 'status-gauge-widget';
  if (lossIndicatorFits(payload)) return 'loss-indicator';
  if (componentAssetFits(payload)) return 'component-asset-card';
  return 'kpi-widget';
}
