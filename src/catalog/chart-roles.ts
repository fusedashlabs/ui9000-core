/**
 * Visual families for the widgets charts.
 *
 * `show_workspace` asks Jev for a class, then a drawing inside that class.
 * A named chart in that class is drawn. A named chart in another class waits
 * for the user. When Jev does not answer, `decide()` still picks the chart.
 * Many widgets draw the same columns with a different mark. This file records
 * that: bar is the comparison main, and the same category + metric can also
 * be a lollipop, a line, or an area when the `when` holds.
 *
 * It does not add charts to the frozen 20-id engine catalog.
 */

export type ChartRole = {
  /** widgets component id (`metadata.json` `id`). */
  id: string;
  /** FuseDash `chartType` keys this component already renders. */
  chartTypeKeys: readonly string[];
  /** What this drawing is for. */
  role: string;
  /** Columns or payload this drawing needs. */
  data: string;
  /**
   * A CSV, header first, that draws this chart when it is named. Sent to the
   * calling model when its table did not fit, so it can rewrite the table.
   */
  columns: string;
  /** What the mark encodes. */
  visual: string;
};

export type ChartAlternative = {
  id: string;
  /** When this drawing is a faithful reading of the family's data. */
  when: string;
};

export type ChartFamily = {
  id: string;
  /** The question the family answers. */
  question: string;
  /** Shared data shape. */
  data: string;
  /** The chart the engine should select for this question. */
  main: string;
  /** Other drawings of the same data. Closest substitutes first. */
  alternatives: readonly ChartAlternative[];
};

export const CHART_ROLES = {
  'bar-chart': {
    id: 'bar-chart',
    chartTypeKeys: [
      'barChart',
      'barGrouped',
      'barStacked',
      'cumulativeBar',
      'barHorizontal',
      'barHorizontalGrouped',
      'barHorizontalStacked',
    ],
    role: 'Compare discrete groups on one metric.',
    data: 'Category, one number, optional second category as a series.',
    columns: 'team,incidents\nNorth,42\nSouth,31\nEast,18',
    visual: 'Bar length. Vertical or horizontal; plain, grouped, stacked, or with a cumulative line.',
  },
  lollipop: {
    id: 'lollipop',
    chartTypeKeys: ['lollipopChart', 'lollipopGroupedChart', 'lollipopStackedChart'],
    role: 'Same comparison as a bar, drawn as a stem and a dot.',
    data: 'Category, one number, optional series.',
    columns: 'team,incidents\nNorth,42\nSouth,31\nEast,18',
    visual: 'Stem length plus a head. Vertical or horizontal; plain, grouped, or stacked.',
  },
  'line-chart': {
    id: 'line-chart',
    chartTypeKeys: ['lineChart', 'lineGroupedChart'],
    role: 'Show how a metric moves along an ordered axis.',
    data: 'Ordered x (time or sequence) and a number, optional series.',
    columns: 'month,revenue\n2026-01,120\n2026-02,135\n2026-03,128\n2026-04,150',
    visual: 'Connected points. One line, or one line per series.',
  },
  'area-chart': {
    id: 'area-chart',
    chartTypeKeys: ['areaChart', 'areaStackedChart'],
    role: 'Same ordered series as a line, with the region under the line filled.',
    data: 'Ordered x and a number, optional series.',
    columns: 'month,revenue\n2026-01,120\n2026-02,135\n2026-03,128\n2026-04,150',
    visual: 'Filled area. Grouped or stacked.',
  },
  'area-grouped-bar-chart': {
    id: 'area-grouped-bar-chart',
    chartTypeKeys: ['areaGroupedBarChart'],
    role: 'Compare groups with bars and overlay an area or line on the same categories.',
    data: 'Category, a bar metric, and a second series for the overlay.',
    columns: 'month,orders,returns\nJan,120,12\nFeb,135,15\nMar,128,9',
    visual: 'Grouped bars plus an area or line. Vertical only.',
  },
  'radial-bar-chart': {
    id: 'radial-bar-chart',
    chartTypeKeys: ['radialBarChart'],
    role: 'Compare a few categories by ring length instead of a bar.',
    data: 'Category and one number. Few categories.',
    columns: 'team,incidents\nNorth,42\nSouth,31\nEast,18',
    visual: 'One ring per category over a 270° sweep.',
  },
  'polar-area-chart': {
    id: 'polar-area-chart',
    chartTypeKeys: ['polarAreaChart'],
    role: 'Compare a few categories by wedge radius.',
    data: 'Category and one number, optional group.',
    columns: 'team,incidents\nNorth,42\nSouth,31\nEast,18',
    visual: 'Coxcomb slices. Radius is the metric, not the share of a whole.',
  },
  'pie-chart': {
    id: 'pie-chart',
    chartTypeKeys: ['pieChart'],
    role: 'Show each category as a share of a total.',
    data: 'Categories whose metric sums to a whole. Low cardinality.',
    columns: 'channel,share\nWeb,55\nStore,30\nPhone,15',
    visual: 'Full disc. Angle is the share.',
  },
  'donut-chart': {
    id: 'donut-chart',
    chartTypeKeys: ['donutChart'],
    role: 'Same shares as a pie, with a hole in the middle.',
    data: 'Same as pie: categories that sum to a whole.',
    columns: 'channel,share\nWeb,55\nStore,30\nPhone,15',
    visual: 'Ring. Angle is the share.',
  },
  'treemap-chart': {
    id: 'treemap-chart',
    chartTypeKeys: ['treemapChart'],
    role: 'Show magnitude, or a share of a total, as tile area. A second category nests tiles.',
    data: 'Category and a number. Optional subgroup for one card per group.',
    columns: 'product,group,sales\nLaptops,Hardware,420\nPhones,Hardware,380\nSupport,Services,150',
    visual: 'Area-proportional tiles. Color follows magnitude.',
  },
  'band-utilization-chart': {
    id: 'band-utilization-chart',
    chartTypeKeys: ['bandUtilizationChart'],
    role: 'Show the same share breakdown once per entity.',
    data: 'One category for the entity, one category for the segment, and the segment share of the row. Each row sums to its own whole.',
    columns: 'site,band,share\nTower A,LTE,0.6\nTower A,5G,0.4\nTower B,LTE,0.3\nTower B,5G,0.7',
    visual: 'One horizontal band per entity. Segment width is the share. The percent is written inside the segment.',
  },
  'histogram-chart': {
    id: 'histogram-chart',
    chartTypeKeys: ['histogramChart'],
    role: 'Show the shape of one numeric variable.',
    data: 'Numeric samples, binned. Optional series stacks the bins.',
    columns: 'latency_ms\n120\n135\n128\n150\n170\n95\n110\n142',
    visual: 'Adjacent bars along a linear x-axis.',
  },
  'box-plot-chart': {
    id: 'box-plot-chart',
    chartTypeKeys: ['boxplotChart'],
    role: 'Summarize a numeric sample per category: median, quartiles, outliers.',
    data: 'Numeric samples, split by a category.',
    columns: 'region,latency_ms\nNorth,120\nNorth,135\nNorth,128\nSouth,150\nSouth,170\nSouth,95',
    visual: 'Box, whiskers, and outlier points. Vertical or horizontal.',
  },
  'violin-chart': {
    id: 'violin-chart',
    chartTypeKeys: ['violinChart'],
    role: 'Show the density of a numeric sample per category, with a box inside.',
    data: 'Numeric samples, split by a category.',
    columns: 'region,latency_ms\nNorth,120\nNorth,135\nNorth,128\nSouth,150\nSouth,170\nSouth,95',
    visual: 'Kernel density plus a box overlay.',
  },
  'scatter-plot-chart': {
    id: 'scatter-plot-chart',
    chartTypeKeys: ['scatterplotChart', 'qqPlot'],
    role: 'Show the relationship between two numbers. Also a QQ plot of quantiles.',
    data: 'Numeric x, numeric y, optional group.',
    columns: 'height_cm,weight_kg\n160,55\n172,70\n181,82\n168,64',
    visual: 'One point per row. Color marks the group.',
  },
  'bubble-chart': {
    id: 'bubble-chart',
    chartTypeKeys: ['bubbleChart'],
    role: 'Same two-number relationship as a scatter, with a third number as size.',
    data: 'Numeric x, numeric y, a size number, optional group.',
    columns: 'height_cm,weight_kg,age\n160,55,23\n172,70,35\n181,82,41\n168,64,29',
    visual: 'Point radius from the absolute size. Color marks the group.',
  },
  'matrix-chart': {
    id: 'matrix-chart',
    chartTypeKeys: ['matrixChart'],
    role: 'Show the metric at each pair of categories.',
    data: 'Row category, column category, one number.',
    columns: 'team,severity,tickets\nPlatform,High,42\nPlatform,Low,18\nMobile,High,39\nMobile,Low,21',
    visual: 'Cell color on a sequential palette.',
  },
  'punchcard-chart': {
    id: 'punchcard-chart',
    chartTypeKeys: ['punchcardChart'],
    role: 'Same two-category grid as a matrix, drawn as dots.',
    data: 'Row category, column category, one number.',
    columns: 'weekday,hour,calls\nMon,9am,42\nMon,2pm,18\nTue,9am,39\nTue,2pm,21',
    visual: 'Dot size (and position) encodes the metric.',
  },
  'radar-chart': {
    id: 'radar-chart',
    chartTypeKeys: ['radarChart', 'radarGroupedChart'],
    role: 'Compare one or a few entities across several metrics on a shared scale.',
    data: 'Few entities, several numeric axes.',
    columns: 'player,speed,strength,agility\nAna,8,6,9\nBen,6,9,5',
    visual: 'Polygon on a polar grid. One shape, or one per series.',
  },
  'parallel-coordinates-chart': {
    id: 'parallel-coordinates-chart',
    chartTypeKeys: ['parallelCoordinatesChart'],
    role: 'Compare many records across several numeric dimensions.',
    data: 'Many rows. Every numeric column is an axis.',
    columns: 'car,mpg,horsepower,weight\nA,30,110,2400\nB,22,180,3200\nC,18,250,3900\nD,35,90,2100',
    visual: 'One polyline per record. Color follows the active axis.',
  },
  'sankey-chart': {
    id: 'sankey-chart',
    chartTypeKeys: ['sankeyChart'],
    role: 'Show how much moves from a source category to a target category.',
    data: 'Source, target, and a value.',
    columns: 'source,target,value\nWeb,Signup,500\nSignup,Paid,120\nWeb,Bounce,300',
    visual: 'Nodes and value-coloured ribbons.',
  },
  'flow-sankey-chart': {
    id: 'flow-sankey-chart',
    chartTypeKeys: ['flowSankeyChart', 'multiStageSankeyChart'],
    role: 'Trace how much flows through three or more stages, such as cause to impact.',
    data: 'Links between stages, or one category column per stage, a value, and an optional severity.',
    columns: 'channel,step,outcome,users\nWeb,Signup,Paid,120\nWeb,Signup,Churned,80\nStore,Signup,Paid,60',
    visual: 'Stage columns joined by severity-coloured ribbons. Each node shows its count and share.',
  },
  'waterfall-chart': {
    id: 'waterfall-chart',
    chartTypeKeys: ['waterfallChart'],
    role: 'Show how signed steps add up to a total.',
    data: 'Ordered categories and a signed delta, or a running level.',
    columns: 'step,delta\nStart,100\nSales,40\nRefunds,-15\nCosts,-30',
    visual: 'Floating bars. Vertical or horizontal.',
  },
  'map-chart': {
    id: 'map-chart',
    chartTypeKeys: ['mapChart', 'UniversalMap'],
    role: 'Place a metric on geography.',
    data: 'Region id or lat/lng, optional magnitude.',
    columns: 'country,visitors\nFrance,120\nGermany,95\nSpain,60',
    visual: 'Choropleth fill, bubbles, or spikes on a map.',
  },
  'network-graph': {
    id: 'network-graph',
    chartTypeKeys: ['networkGraphChart'],
    role: 'Show what is connected to what.',
    data: 'Nodes and links.',
    columns: 'source,target\nA,B\nB,C\nC,A',
    visual: 'Force layout. Node size from a value, color from a category.',
  },
  'goals-perimeter': {
    id: 'goals-perimeter',
    chartTypeKeys: ['goalsPerimeter'],
    role: 'Monitor many agents around a shared goal: their health states, their links, and how many need attention.',
    data: 'Agents with an id, a health state, and the goal they work toward. Optional links to agents, resources, or external dependencies, and an exception count. Or one row per goal and resource group: the goal\'s agents by state, healthy ones included, with optional code, status, progress and burn, and the group\'s kind, state, calls, held agents and detail.',
    columns: 'agent_id,goal,state,reason\nagent-01,Incident Response,healthy,\nagent-02,Incident Response,healthy,\nagent-03,Incident Response,failed,Pager integration returns 503\nagent-04,Incident Response,blocked,Escalation needs on-call sign-off\nagent-05,Incident Response,degraded,Slow ticket enrichment\nagent-06,Incident Response,healthy,',
    visual: 'A cloud of agents per goal inside a ring that fills with progress. Working and idle agents are dots; awaiting, blocked, failed, and degraded (slowed or over budget) agents each wear their own mark. Resource groups sit on the goal\'s orbit as diamonds with the agents held there. Lines join goals that draw on the same group, red where one is down. The header counts goals, agents, and held agents, and hovering a goal, group, or line shows its tooltip.',
  },
  'goals-insights': {
    id: 'goals-insights',
    chartTypeKeys: ['goalsInsights', 'goalInsights', 'insights', 'evidenceColumn'],
    role: 'Show the evidence behind one goal: the claims its agents filed, how each reads against the goal, and the goals it shares evidence with.',
    data: 'One row per claim, with its text, the goal it was filed under, and its age in hours. Optional stance, state, type, subject, sources, records, weight, agent, asset kind and other goals it bears on; optional goal name, status, confidence, priority and agents.',
    columns: 'claim_id,goal,goal_name,claim,polarity,age\nINS-1,G-014,Perimeter Watch,Firmware 4.2 cameras recover within 90 seconds,confirming,60.5\nINS-2,G-014,Perimeter Watch,Gate 3 tailgating alerts down 40%,confirming,52.3\nINS-3,G-014,Perimeter Watch,Badge event overlaps a camera outage,contradicting,9.1\nINS-4,G-022,Asset Visibility,Decommissioned servers still listed as live,contradicting,57.9\nINS-5,G-014,Perimeter Watch,Hall C aisle 07 has no motion coverage,contradicting,6.4',
    visual: 'A column under the goal, a ring every two hours with now at the top. Each claim is a diamond on the ring of its hour: ink when it supports the goal, grey on one source, yellow when disputed, orange when it argues against; larger with more records, nearer the axis the more it moves the goal. Up to two connected goals stand beside it.',
  },
  'bipartite-graph': {
    id: 'bipartite-graph',
    chartTypeKeys: ['bipartiteGraph', 'bipartite'],
    role: 'Show how much each goal draws on each resource group: the calls between them, and where agents are held.',
    data: 'One row per goal and resource group, with the goal\'s agent total and the calls a minute it makes there. Optional goal code, agents by state, progress, burn and status; optional group kind, state, held agents and detail.',
    columns: 'goal,goal_code,agents,blocked,progress,resource_group,kind,state,calls,held\nPerimeter Watch,G-014,1108,0,0.88,Camera,camera,degraded,14200,0\nPerimeter Watch,G-014,1108,0,0.88,Model,model,healthy,8800,0\nOnboarding Velocity,G-007,842,94,41%,System,system,blocked,5400,94\nOnboarding Velocity,G-007,842,94,41%,Camera,camera,healthy,2100,0',
    visual: 'Goals as agent clouds in a column, resource groups as diamonds against them, and a ribbon for each pair: the wider, the more calls; in the held agents\' colour, yellow where traffic is only slowed.',
  },
  'goals-dependency-graph': {
    id: 'goals-dependency-graph',
    chartTypeKeys: ['goalsDependencyGraph'],
    role: 'Trace what holds each goal\'s agents: the resource groups the goals draw on, and the cause, rule and owner of each hold.',
    data: 'One row per goal and resource group, with the goal\'s agent total and the agents held there or the calls a minute. Optional goal code, agents by state, progress, burn and status; optional group kind, state, detail, cause, rule, owner and since. Up to eight goals.',
    columns: 'goal,goal_code,agents,blocked,awaiting,resource_group,kind,state,held,calls,cause,rule,owner,since\nPerimeter Watch,G-014,1108,0,19,Camera,camera,healthy,0,14200,,,,\nPerimeter Watch,G-014,1108,0,19,Model,model,awaiting,19,8800,gateway p95 over threshold,,ML platform,14m\nOnboarding Velocity,G-007,842,94,0,System,system,blocked,94,5400,writes need a credential grant,R-047,Identity team,2h\nOnboarding Velocity,G-007,842,94,0,Camera,camera,healthy,0,2100,,,,',
    visual: 'Each goal a tree of its agents on a baseline, in their states\' marks, with the resource groups in a row over the trees and a line from each goal to every group it draws on, in the colour of the agents held there. The goal at the centre grows its full tree, with its progress ring and its worst line traced in a callout.',
  },
  'reasoning-orchestration-graph': {
    id: 'reasoning-orchestration-graph',
    chartTypeKeys: ['reasoningOrchestrationGraph'],
    role: 'Inspect a reasoning or inference process: its stages, candidate paths, models, and refinement steps, with the active path highlighted.',
    data: 'Reasoning steps linked to the step they came from, each with a stage or a depth, and an active path to highlight. Optional model, state, score, candidate paths, and supporting metrics.',
    columns: 'step_id,parent_id,stage,model,status,score,active\nq,,Prompt,,verified,1,yes\ns1,q,Sample,Astra,candidate,0.4,no\ns2,q,Sample,Astra,candidate,0.7,yes\nv1,s2,Verify,Opus,verified,0.8,yes\nr1,v1,Repair,Opus,refined,0.9,yes',
    visual: 'A fan from the root outward by depth, stage by stage. Hairlines in each model’s colour, candidate paths subordinate, the active path bright. Stage metrics on top; step entropy, pipeline status, and compute scaling in panels underneath.',
  },
  'kpi-widget': {
    id: 'kpi-widget',
    chartTypeKeys: ['KPI', 'KPIs'],
    role: 'State a headline card: one number, its change, current versus previous, or the high and low of a category.',
    data: 'One metric. A change, a previous period, or a category for high and low, when that reading was asked.',
    columns: 'revenue,previous\n1250,1100',
    visual: 'Cards, not a plot.',
  },
  'status-gauge-widget': {
    id: 'status-gauge-widget',
    chartTypeKeys: ['statusGaugeWidget'],
    role: 'State one health score as a dial, plus the measures behind it.',
    data: 'A health or condition score that already exists, plus at least one other measure. Optional unit, status, min, and max.',
    columns: 'unit_health,tx_power,min,max\n72.8,28,0,100',
    visual: 'Semicircular health gauge and KPI cards with ticked range bars.',
  },
  'loss-indicator': {
    id: 'loss-indicator',
    chartTypeKeys: ['lossIndicator'],
    role: 'Read one metric as its position on a threshold scale.',
    data: 'Exactly one metric that already has a minimum, a maximum, and operating thresholds. Optional unit and trend. Not a health score beside other measures, and not several metrics.',
    columns: 'label,value,unit,min,max,ok_to,warning_to\nElectrical Loss,24.3,%,0,30,10,20',
    visual: 'Coloured ticks, a marker on the current value, and an optional trend arrow. Ticks past the marker stay grey.',
  },
  'power-path-card': {
    id: 'power-path-card',
    chartTypeKeys: ['powerPathCard'],
    role: 'Monitor one equipment group: its health score, any active fault, and each metric with its status.',
    data: 'A health score that already exists, plus metric rows each with a value and a status or threshold. Optional asset badge, recent points, and an active fault.',
    columns: 'asset,metric,value,unit,status\n5G-TX-303,Electricity Health,69.9,%,Critical\n5G-TX-303,Input Voltage,48.1,V,Stable\n5G-TX-303,Output Voltage,36.4,V,Critical',
    visual: 'Card with an asset badge, the score beside a compact line, a fault banner only while a fault is active, and a metric list with status dots.',
  },
  'component-asset-card': {
    id: 'component-asset-card',
    chartTypeKeys: ['componentAssetCard'],
    role: 'Give a quick status of one asset: its name, its id, and one primary metric.',
    data: 'One asset with a name and an id, plus one metric value. Optional image, unit, delta against a reference point, recent points, and a status or threshold.',
    columns: 'name,asset_id,metric,value,unit\nSector A1 Antenna,RTX-3090,Packet loss,1.02,%',
    visual: 'Card with the asset image, the name beside an id badge, the metric value with a delta arrow, and a compact trend of points coloured by level.',
  },
  'incidents-review-card': {
    id: 'incidents-review-card',
    chartTypeKeys: ['incidentsReviewCard'],
    role: 'Summarise incidents for one scope: aggregated counts by state and a total.',
    data: 'Incident counts by state for a network, region, site, or area. Optional total, filter, and lifecycle.',
    columns: 'status,incidents\nActive,89\nIn progress,46\nTotal,102',
    visual: 'Card with a title, a filter, the counts as headline numbers, and one lifecycle track under them.',
  },
  'asset-health-overview': {
    id: 'asset-health-overview',
    chartTypeKeys: ['assetHealthOverview'],
    role: 'Show environment health at a glance: agent population plus asset categories with health.',
    data: 'One goal\'s agent counts (total, held by state; optional working, idle, over budget, progress, status), plus asset categories each with healthy / degraded / failing counts or problems. Optional per category: held agents, calls, traffic and a 24-hour day. Do not invent category totals or the day.',
    columns: 'resource_group,agents,blocked,healthy,degraded,failing\nApplications,1204,84,12,0,0\nDatabases,,,8,0,1\nNetwork,,,20,2,0',
    visual: 'Goal rings arena: the goal\'s agents as dots in a section per asset category, the held ones against its gate; a cell per asset with problems lit as beams; the category\'s last 24 hours as a wall when sent; progress as a ring in the middle.',
  },
  'goal-burst': {
    id: 'goal-burst',
    chartTypeKeys: ['goalBurst', 'burst'],
    role: 'Show one goal\'s traffic: how long its calls to each resource group take to be answered, and where they are held up.',
    data: 'The asset health overview\'s payload (one goal\'s agent counts, and per resource group its health, calls and held agents), with the calls on every group and answer times (p50 / p95) on at least one. Optional kind, traffic mix, problems, bytes a minute, shared goals and the fleet\'s resource group total. Do not invent answer times.',
    columns: 'resource_group,kind,agents,blocked,healthy,held,calls,p50_ms,p95_ms\nSYSTEM,system,842,94,1246,94,5400,240,700\nAPP,app,,,8931,0,3300,,\nMODEL,model,,,40,0,900,900,2100',
    visual: 'The goal\'s agents as a cloud with its progress ring; its calls as spikes into one sector per resource group, as wide as the group\'s share of the calls, each spike as long as its answer time on a 0.1s to 2s scale, white through, amber throttled, and in the hold\'s colour where held up; the group\'s assets in trouble on the outer band.',
  },
  'step-line-chart': {
    id: 'step-line-chart',
    chartTypeKeys: ['stepLineChart', 'ksPlotChart', 'rocCurveChart'],
    role: 'Show a metric that holds until the next x. Also KS and ROC reference overlays.',
    data: 'Ordered x and a number, optional series. KS/ROC add a reference curve.',
    columns: 'date,price\n2026-11-01,10\n2026-11-02,10\n2026-11-03,14\n2026-11-04,12',
    visual: 'Step line. `ksPlotChart` draws the ideal curve; `rocCurveChart` draws the diagonal.',
  },
  'spark-line-chart': {
    id: 'spark-line-chart',
    chartTypeKeys: ['sparkLineChart'],
    role: 'Compact reading of a datetime series.',
    data: 'Datetime x and a number, optional series.',
    columns: 'time,requests\n2026-11-01T00:00,120\n2026-11-01T01:00,135\n2026-11-01T02:00,128\n2026-11-01T03:00,150',
    visual: 'Line with axes and a crosshair.',
  },
  'spark-area-chart': {
    id: 'spark-area-chart',
    chartTypeKeys: ['sparkAreaChart'],
    role: 'Compact datetime series with the region under the line filled.',
    data: 'Datetime x and a number, optional series.',
    columns: 'time,requests\n2026-11-01T00:00,120\n2026-11-01T01:00,135\n2026-11-01T02:00,128\n2026-11-01T03:00,150',
    visual: 'Line filled to y = 0.',
  },
  'scatter-sparkline-chart': {
    id: 'scatter-sparkline-chart',
    chartTypeKeys: ['scatterSparklineChart'],
    role: 'Datetime series as a line, with the underlying points still visible.',
    data: 'Datetime x, a number, and the raw points.',
    columns: 'time,requests\n2026-11-01T00:00,120\n2026-11-01T01:00,135\n2026-11-01T02:00,128\n2026-11-01T03:00,150',
    visual: 'Aggregated line with gradient fill plus jittered markers.',
  },
  'partial-dependence-chart': {
    id: 'partial-dependence-chart',
    chartTypeKeys: ['partialDependenceChart'],
    role: 'Show how a model prediction moves as one feature changes.',
    data: 'Feature values, ICE curves, and their average.',
    columns: 'feature_value,ice_1,ice_2,average\n0,0.1,0.2,0.15\n1,0.3,0.4,0.35\n2,0.5,0.4,0.45',
    visual: 'Faint ICE lines under a dashed average.',
  },
  'bias-variance-tradeoff-chart': {
    id: 'bias-variance-tradeoff-chart',
    chartTypeKeys: ['biasVarianceTradeoffChart'],
    role: 'Show bias, variance, and total error against model complexity.',
    data: 'Complexity on x and the three error curves.',
    columns: 'complexity,bias,variance,total_error\n1,0.9,0.1,1.0\n2,0.5,0.2,0.7\n3,0.2,0.5,0.7',
    visual: 'Fixed diagnostic lines, not a general series.',
  },
  'gini-impurity-entropy-chart': {
    id: 'gini-impurity-entropy-chart',
    chartTypeKeys: ['giniImpurityEntropyChart'],
    role: 'Show impurity of a binary split across the class probability.',
    data: 'Probability p, and the entropy / Gini / misclassification curves.',
    columns: 'p,entropy,gini,misclassification\n0.1,0.47,0.18,0.1\n0.5,1,0.5,0.5\n0.9,0.47,0.18,0.1',
    visual: 'Fixed diagnostic curves, optional split annotations.',
  },
} as const satisfies Record<string, ChartRole>;

export type ChartId = keyof typeof CHART_ROLES;

export const CHART_FAMILIES = [
  {
    id: 'category-magnitude',
    question: 'How do discrete groups compare on one metric?',
    data: 'One category, one number, optional second category as a series.',
    main: 'bar-chart',
    alternatives: [
      { id: 'lollipop', when: 'Same axes. Prefer it when a stem and a dot stay readable.' },
      { id: 'line-chart', when: 'The category has an order (time or sequence), so the slope means something.' },
      { id: 'area-chart', when: 'The category is ordered and the fill should show volume, not only the slope.' },
      {
        id: 'area-grouped-bar-chart',
        when: 'The same categories need bars and an area or line overlay together.',
      },
      { id: 'radial-bar-chart', when: 'Few categories, and ring length is the comparison.' },
      { id: 'polar-area-chart', when: 'Few categories, and wedge radius is the comparison. Not a share of a whole.' },
    ],
  },
  {
    id: 'part-to-whole',
    question: 'What share of a total does each category take?',
    data: 'Categories whose metric sums to a whole. Low cardinality.',
    main: 'pie-chart',
    alternatives: [
      { id: 'donut-chart', when: 'Same slices. The hole is only a drawing change.' },
      {
        id: 'treemap-chart',
        when: 'Area should carry the share, or a second category nests tiles inside each group.',
      },
      {
        id: 'band-utilization-chart',
        when: 'The same share breakdown is repeated once per entity, and each row sums to a whole.',
      },
    ],
  },
  {
    id: 'ordered-series',
    question: 'How does a metric move along an ordered axis?',
    data: 'Ordered x (time or sequence) and a number, optional series.',
    main: 'line-chart',
    alternatives: [
      { id: 'area-chart', when: 'Same line. The fill shows volume under it.' },
      { id: 'step-line-chart', when: 'The value holds until the next x, or the chart is a KS / ROC overlay.' },
      { id: 'spark-line-chart', when: 'The x is datetime and the reading should stay compact.' },
      { id: 'spark-area-chart', when: 'Compact datetime series with a fill to zero.' },
      { id: 'scatter-sparkline-chart', when: 'The datetime line should keep the raw points visible.' },
      {
        id: 'bar-chart',
        when: 'The ordered x is a short list of categories and the reading is a comparison, not a slope.',
      },
    ],
  },
  {
    id: 'distribution',
    question: 'What shape does a numeric variable take?',
    data: 'Numeric samples. Optional category that splits the sample.',
    main: 'histogram-chart',
    alternatives: [
      { id: 'box-plot-chart', when: 'The sample is split by category and the reading is quartiles and outliers.' },
      { id: 'violin-chart', when: 'The sample is split by category and the reading is the density, not only the bins.' },
    ],
  },
  {
    id: 'two-measures',
    question: 'How do two numeric measures relate?',
    data: 'Numeric x, numeric y, optional group.',
    main: 'scatter-plot-chart',
    alternatives: [
      { id: 'bubble-chart', when: 'A third number should set the point size.' },
    ],
  },
  {
    id: 'two-way-magnitude',
    question: 'What is the metric at each pair of categories?',
    data: 'Row category, column category, one number.',
    main: 'matrix-chart',
    alternatives: [
      { id: 'punchcard-chart', when: 'The same grid should be dots sized by the metric, not colored cells.' },
    ],
  },
  {
    id: 'many-metrics',
    question: 'How does an entity compare across several metrics?',
    data: 'Several numeric measures. One profile, or many records.',
    main: 'radar-chart',
    alternatives: [
      {
        id: 'parallel-coordinates-chart',
        when: 'There are many records, not one or a few profiles.',
      },
    ],
  },
  {
    id: 'flow',
    question: 'How much moves from a source category to a target category?',
    data: 'Source, target, and a value.',
    main: 'sankey-chart',
    alternatives: [
      {
        id: 'flow-sankey-chart',
        when: 'The flow passes through three or more stages, such as cause to impact.',
      },
    ],
  },
  {
    id: 'contribution',
    question: 'How do signed steps add up to a total?',
    data: 'Ordered categories and a signed delta, or a running level.',
    main: 'waterfall-chart',
    alternatives: [],
  },
  {
    id: 'spatial',
    question: 'Where is the metric?',
    data: 'Region id or lat/lng, optional magnitude.',
    main: 'map-chart',
    alternatives: [],
  },
  {
    id: 'graph',
    question: 'What is connected to what?',
    data: 'Nodes and links.',
    main: 'network-graph',
    alternatives: [
      {
        id: 'goals-perimeter',
        when: 'Many agents (or resources) are arranged around one shared goal, with health states and an optional exception count, or goals carry their agents by state against the resource groups they draw on. The reading is perimeter and population health, not a free-form adjacency list. A general node–link exploration stays the network graph.',
      },
      {
        id: 'goals-insights',
        when: 'The rows are claims that agents filed under a few goals, each with its text, its goal and its age in hours, and optionally its stance and sources. The reading is the evidence behind the goal with the most claims, and the goals it shares evidence with. Agents and their health states stay the goals perimeter, and a general node–link exploration stays the network graph.',
      },
      {
        id: 'bipartite-graph',
        when: 'Goals stand against the resource groups they draw on, one row per goal and group with the goal\'s agents and the calls a minute between them. The reading is how much each goal draws on each group and where its agents are held. Agents one by one stay the goals perimeter, and a general node–link exploration stays the network graph.',
      },
      {
        id: 'goals-dependency-graph',
        when: 'Up to eight goals stand against the resource groups they draw on, one row per goal and group with the goal\'s agents and the agents held there, or the cause, rule, owner or since of a hold. The reading is what holds each goal\'s agents and where. Agents one by one stay the goals perimeter, and a general node–link exploration stays the network graph.',
      },
      {
        id: 'reasoning-orchestration-graph',
        when: 'Reasoning stages, candidate paths, models, or refinement steps form an inspectable orchestration graph, with an active path to highlight. The reading is reasoning or inference structure, not a free-form adjacency list. A general node–link exploration stays the network graph.',
      },
    ],
  },
  {
    id: 'headline',
    question:
      'What headline card fits: one number, its change, current versus previous, or the high and low category?',
    data: 'One metric. Optional change, previous period, or a category that splits high and low.',
    main: 'kpi-widget',
    alternatives: [
      { id: 'status-gauge-widget', when: 'At least two measures, and one of them is already a health or condition score. The dial is that score. Do not invent it.' },
      {
        id: 'loss-indicator',
        when: 'Exactly one metric already has a minimum, a maximum, and operating thresholds. Draw that reading on the scale. A health score beside other measures stays the dial. A plain number, or several metrics, stays the KPI card.',
      },
      {
        id: 'power-path-card',
        when: 'One equipment group already has a health score, plus the metrics behind it, each with a status, a level, or a threshold. The compact line and the fault are optional. Do not invent the score.',
      },
      {
        id: 'component-asset-card',
        when: 'One asset, named by its id, with one primary metric, read as a quick status. The image, the delta, and the trend are optional. A health score with the metrics behind it stays the power path card, and a metric on a scale with a minimum and a maximum stays the loss indicator. A plain number, or several metrics, stays the KPI card.',
      },
      {
        id: 'incidents-review-card',
        when: 'The numbers are aggregated incident counts by state, for a network, region, site, or area. The filter and the lifecycle track are optional. The counts are headlines and need not sum to the total. A plain set of headline numbers stays a KPI.',
      },
      {
        id: 'asset-health-overview',
        when: 'The operational environment already has an agent population plus asset categories with health counts (and optional problems, traffic and a 24-hour day per category); the reading is environment health at a glance. A single health dial stays the status gauge. A plain number stays the KPI. Free-form node–link exploration stays the network graph.',
      },
      {
        id: 'goal-burst',
        when: 'One goal\'s agents and the resource groups it calls, every group with its calls a minute and at least one with how long its calls take to be answered (p50 / p95). The reading is the goal\'s traffic: how long its calls take and where they are held up. Without answer times the same rows stay the asset health overview. A plain number stays the KPI.',
      },
    ],
  },
  {
    id: 'model-dependence',
    question: 'How does a model prediction move as one feature changes?',
    data: 'Feature values and ICE curves.',
    main: 'partial-dependence-chart',
    alternatives: [],
  },
  {
    id: 'model-error',
    question: 'How do bias and variance trade off against complexity?',
    data: 'Complexity and the bias, variance, and total-error curves.',
    main: 'bias-variance-tradeoff-chart',
    alternatives: [],
  },
  {
    id: 'model-impurity',
    question: 'How impure is a binary split across the class probability?',
    data: 'Class probability and the impurity curves.',
    main: 'gini-impurity-entropy-chart',
    alternatives: [],
  },
] as const satisfies readonly ChartFamily[];

export function chartRole(id: string): ChartRole | undefined {
  return CHART_ROLES[id as ChartId];
}

/** Words for a chart. The component id stays on the spec. */
export function chartName(id: string): string {
  return id.replace(/-/g, ' ');
}

/** Name plus what the drawing shows, so a reply never says `bar-chart`. */
export function chartLabel(id: string): string {
  const role = chartRole(id);
  if (!role) return 'this chart';
  const described = role.role.trim().replace(/[.\s]+$/, '');
  const gloss = described.charAt(0).toLowerCase() + described.slice(1);
  return `${chartName(id)} (${gloss})`;
}

/** Families where this chart is the main drawing or an alternative. */
export function familiesForChart(id: string): ChartFamily[] {
  return CHART_FAMILIES.filter(
    (family) => family.main === id || family.alternatives.some((alt) => alt.id === id),
  );
}

export type ChartDrawings = {
  family: ChartFamily;
  main: ChartRole;
  alternatives: ChartRole[];
};

/**
 * The main chart and the other drawings of the same data.
 * Looks up the family whose `main` is this id.
 */
export function drawingsFor(mainId: string): ChartDrawings | undefined {
  const family = CHART_FAMILIES.find((item) => item.main === mainId);
  if (!family) return undefined;
  const main = chartRole(family.main);
  if (!main) return undefined;
  const alternatives = family.alternatives
    .map((alt) => chartRole(alt.id))
    .filter((role): role is ChartRole => role != null);
  return { family, main, alternatives };
}
