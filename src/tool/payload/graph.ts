/**
 * Graph family. The main drawing is the network graph.
 *
 * Call the reasoning orchestration graph only when the rows are reasoning
 * steps with a stage or a depth and an active path to highlight. A free-form
 * node–link list has neither and stays the network graph.
 */

import { reasoningOrchestrationFits } from './reasoning-orchestration-graph.js';

export const GRAPH_CHARTS = ['network-graph', 'reasoning-orchestration-graph'] as const;

export type GraphChart = (typeof GRAPH_CHARTS)[number];

export function isGraphChart(id: string): id is GraphChart {
  return (GRAPH_CHARTS as readonly string[]).includes(id);
}

/**
 * Which graph drawing the rows support. `drawable` drops a chart the host
 * catalog cannot draw. The network graph is the main drawing and always
 * stays, so an orchestration that does not fit falls back to it.
 */
export function graphChart(
  payload: unknown,
  drawable: (id: GraphChart) => boolean = () => true,
): GraphChart {
  if (drawable('reasoning-orchestration-graph') && reasoningOrchestrationFits(payload)) {
    return 'reasoning-orchestration-graph';
  }
  return 'network-graph';
}
