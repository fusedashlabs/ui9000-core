/**
 * Headline family. The main drawing is the KPI card.
 *
 * Call the power path card only when one equipment group already has a health
 * score and every other metric carries a status. Call the dial only when a
 * health score already sits beside other measures.
 * Call the loss indicator only when one metric already has a minimum, a
 * maximum, and operating thresholds. A plain number, or several metrics,
 * stays the KPI card.
 */

import { lossIndicatorFits } from './loss-indicator.js';
import { powerPathFits } from './power-path-card.js';
import { statusGaugeFits } from './status-gauge-widget.js';

export const HEADLINE_CHARTS = [
  'kpi-widget',
  'status-gauge-widget',
  'loss-indicator',
  'power-path-card',
] as const;

export type HeadlineChart = (typeof HEADLINE_CHARTS)[number];

export function isHeadlineChart(id: string): id is HeadlineChart {
  return (HEADLINE_CHARTS as readonly string[]).includes(id);
}

/**
 * Which headline drawing the rows support. The power path card is checked
 * first, because the dial also fits a health score whose metrics carry a status.
 * Gauge is checked before the loss scale. `drawable` drops a chart the host
 * catalog cannot draw.
 */
export function headlineChart(
  payload: unknown,
  drawable: (id: HeadlineChart) => boolean = () => true,
): HeadlineChart {
  if (drawable('power-path-card') && powerPathFits(payload)) return 'power-path-card';
  if (statusGaugeFits(payload)) return 'status-gauge-widget';
  if (lossIndicatorFits(payload)) return 'loss-indicator';
  return 'kpi-widget';
}
