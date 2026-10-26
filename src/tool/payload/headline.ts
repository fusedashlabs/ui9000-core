/**
 * Headline family. The main drawing is the KPI card.
 *
 * Call the incidents review card when the numbers are incident counts by
 * state for one scope. Call the asset health overview when the environment
 * already has an agent population plus asset categories with health. Call the
 * power path card only when one equipment group already has a health score and
 * every other metric carries a status, a level, or a threshold. Call the dial
 * only when a health score already sits beside other measures.
 * Call the loss indicator only when one metric already has a minimum, a
 * maximum, and operating thresholds. Call the component asset card only when
 * one row names an asset by its id and holds one metric. A plain number, or
 * several metrics, stays the KPI card.
 */

import { assetHealthFits } from './asset-health-overview.js';
import { incidentsReviewFits } from './incidents-review-card.js';
import { componentAssetFits } from './component-asset-card.js';
import { lossIndicatorFits } from './loss-indicator.js';
import { powerPathFits } from './power-path-card.js';
import { statusGaugeFits } from './status-gauge-widget.js';

export const HEADLINE_CHARTS = [
  'kpi-widget',
  'status-gauge-widget',
  'loss-indicator',
  'power-path-card',
  'component-asset-card',
  'incidents-review-card',
  'asset-health-overview',
] as const;

export type HeadlineChart = (typeof HEADLINE_CHARTS)[number];

export function isHeadlineChart(id: string): id is HeadlineChart {
  return (HEADLINE_CHARTS as readonly string[]).includes(id);
}

/**
 * Which headline drawing the rows support. The incidents review card is
 * checked first, because only it needs a column that names incidents. The
 * asset health overview is next: agents plus category health. The power path
 * card follows, because the dial also fits a health score whose metrics carry
 * a status. Gauge is checked before the loss scale, and the scale before the
 * asset card, which needs no minimum or maximum. `drawable` drops a chart the
 * host catalog cannot draw. The KPI card is the main drawing and always stays.
 */
export function headlineChart(
  payload: unknown,
  drawable: (id: HeadlineChart) => boolean = () => true,
): HeadlineChart {
  if (drawable('incidents-review-card') && incidentsReviewFits(payload)) return 'incidents-review-card';
  if (drawable('asset-health-overview') && assetHealthFits(payload)) return 'asset-health-overview';
  if (drawable('power-path-card') && powerPathFits(payload)) return 'power-path-card';
  if (drawable('status-gauge-widget') && statusGaugeFits(payload)) return 'status-gauge-widget';
  if (drawable('loss-indicator') && lossIndicatorFits(payload)) return 'loss-indicator';
  if (drawable('component-asset-card') && componentAssetFits(payload)) return 'component-asset-card';
  return 'kpi-widget';
}
