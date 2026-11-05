/**
 * Graph family. The main drawing is the network graph.
 *
 * Call the goals perimeter only when the rows are many agents (or resources)
 * around shared goals, each with a health state. Call the goals dependency
 * graph only when a hold is traced, or agents are held without a full calls
 * ribbon (call traffic with holds but no traced cause is the bipartite
 * graph — check bipartite before this chart when both are in GRAPH_CHARTS).
 * A free-form node–link list has no goal or state and stays the network graph.
 */

import { goalsDependencyGraphFits } from './goals-dependency-graph.js';
import { goalsPerimeterFits } from './goals-perimeter.js';

export const GRAPH_CHARTS = ['network-graph', 'goals-perimeter', 'goals-dependency-graph'] as const;

export type GraphChart = (typeof GRAPH_CHARTS)[number];

export function isGraphChart(id: string): id is GraphChart {
  return (GRAPH_CHARTS as readonly string[]).includes(id);
}

/**
 * Which graph drawing the rows support. `drawable` drops a chart the host
 * catalog cannot draw. The network graph is the main drawing and always
 * stays, so a perimeter or a dependency graph that does not fit falls back
 * to it.
 */
export function graphChart(
  payload: unknown,
  drawable: (id: GraphChart) => boolean = () => true,
): GraphChart {
  if (drawable('goals-perimeter') && goalsPerimeterFits(payload)) return 'goals-perimeter';
  if (drawable('goals-dependency-graph') && goalsDependencyGraphFits(payload)) return 'goals-dependency-graph';
  return 'network-graph';
}
