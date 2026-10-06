/**
 * Headline family. The main drawing is the KPI card.
 *
 * Call the incidents review card when the numbers are incident counts by
 * state for one scope. Call the dial only when a health score already sits
 * beside other measures.
 * Call the loss indicator only when one metric already has a minimum, a
 * maximum, and operating thresholds. A plain number, or several metrics,
 * stays the KPI card.
 */

import { incidentsReviewFits } from './incidents-review-card.js';
import { lossIndicatorFits } from './loss-indicator.js';
import { statusGaugeFits } from './status-gauge-widget.js';

export const HEADLINE_CHARTS = [
  'kpi-widget',
  'status-gauge-widget',
  'loss-indicator',
  'incidents-review-card',
] as const;

export type HeadlineChart = (typeof HEADLINE_CHARTS)[number];

export function isHeadlineChart(id: string): id is HeadlineChart {
  return (HEADLINE_CHARTS as readonly string[]).includes(id);
}

/** Which headline drawing the rows support. Incidents come first, then the gauge, then the loss scale. */
export function headlineChart(payload: unknown): HeadlineChart {
  if (incidentsReviewFits(payload)) return 'incidents-review-card';
  if (statusGaugeFits(payload)) return 'status-gauge-widget';
  if (lossIndicatorFits(payload)) return 'loss-indicator';
  return 'kpi-widget';
}
