/**
 * Graph family. The main drawing is the network graph.
 *
 * Call the goals perimeter only when the rows are many agents (or resources)
 * around shared goals, each with a health state. Call the goals dependency
 * graph only when the rows are a few goals against the resource groups they
 * draw on, and something holds their agents there. A free-form node–link
 * list has no goal or state and stays the network graph.
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
