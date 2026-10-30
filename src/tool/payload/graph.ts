/**
 * Graph family. The main drawing is the network graph.
 *
 * Call the goals perimeter only when the rows are many agents (or resources)
 * around shared goals, each with a health state. A free-form node–link list
 * has no goal or state and stays the network graph.
 */

import { goalsPerimeterFits } from './goals-perimeter.js';

export const GRAPH_CHARTS = ['network-graph', 'goals-perimeter'] as const;

export type GraphChart = (typeof GRAPH_CHARTS)[number];

export function isGraphChart(id: string): id is GraphChart {
  return (GRAPH_CHARTS as readonly string[]).includes(id);
}

/**
 * Which graph drawing the rows support. `drawable` drops a chart the host
 * catalog cannot draw. The network graph is the main drawing and always
 * stays, so a perimeter that does not fit falls back to it.
 */
export function graphChart(
  payload: unknown,
  drawable: (id: GraphChart) => boolean = () => true,
): GraphChart {
  if (drawable('goals-perimeter') && goalsPerimeterFits(payload)) return 'goals-perimeter';
  return 'network-graph';
}
