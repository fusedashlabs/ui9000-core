/**
 * Graph family. The main drawing is the network graph.
 *
 * Call the goals perimeter only when the rows are many agents (or resources)
 * around shared goals, each with a health state. Call goals and insights only
 * when the rows are claims filed under a few goals, each with its age. Call
 * the bipartite graph only when the rows are goals against the resource
 * groups they draw on, with the calls on every link and no hold traced to its
 * cause. Call the goals dependency graph only when a hold is traced, or
 * agents are held without a full calls ribbon. A free-form node–link list
 * stays the network graph.
 */

import { bipartiteGraphFits } from './bipartite-graph.js';
import { goalsDependencyGraphFits } from './goals-dependency-graph.js';
import { goalsInsightsFits } from './goals-insights.js';
import { goalsPerimeterFits } from './goals-perimeter.js';

export const GRAPH_CHARTS = [
  'network-graph',
  'goals-perimeter',
  'goals-insights',
  'bipartite-graph',
  'goals-dependency-graph',
] as const;

export type GraphChart = (typeof GRAPH_CHARTS)[number];

export function isGraphChart(id: string): id is GraphChart {
  return (GRAPH_CHARTS as readonly string[]).includes(id);
}

/**
 * Which graph drawing the rows support. `drawable` drops a chart the host
 * catalog cannot draw. The network graph is the main drawing and always
 * stays. Bipartite is checked before dependency so call traffic with
 * untraced holds stays bipartite.
 */
export function graphChart(
  payload: unknown,
  drawable: (id: GraphChart) => boolean = () => true,
): GraphChart {
  if (drawable('goals-perimeter') && goalsPerimeterFits(payload)) return 'goals-perimeter';
  if (drawable('goals-insights') && goalsInsightsFits(payload)) return 'goals-insights';
  if (drawable('bipartite-graph') && bipartiteGraphFits(payload)) return 'bipartite-graph';
  if (drawable('goals-dependency-graph') && goalsDependencyGraphFits(payload)) return 'goals-dependency-graph';
  return 'network-graph';
}
