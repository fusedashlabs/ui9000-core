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
    visual: 'Bar length. Vertical or horizontal; plain, grouped, stacked, or with a cumulative line.',
  },
  lollipop: {
    id: 'lollipop',
    chartTypeKeys: ['lollipopChart', 'lollipopGroupedChart', 'lollipopStackedChart'],
    role: 'Same comparison as a bar, drawn as a stem and a dot.',
    data: 'Category, one number, optional series.',
    visual: 'Stem length plus a head. Vertical or horizontal; plain, grouped, or stacked.',
  },
  'line-chart': {
    id: 'line-chart',
    chartTypeKeys: ['lineChart', 'lineGroupedChart'],
    role: 'Show how a metric moves along an ordered axis.',
    data: 'Ordered x (time or sequence) and a number, optional series.',
    visual: 'Connected points. One line, or one line per series.',
  },
  'area-chart': {
    id: 'area-chart',
    chartTypeKeys: ['areaChart', 'areaStackedChart'],
    role: 'Same ordered series as a line, with the region under the line filled.',
    data: 'Ordered x and a number, optional series.',
    visual: 'Filled area. Grouped or stacked.',
  },
  'area-grouped-bar-chart': {
    id: 'area-grouped-bar-chart',
    chartTypeKeys: ['areaGroupedBarChart'],
    role: 'Compare groups with bars and overlay an area or line on the same categories.',
    data: 'Category, a bar metric, and a second series for the overlay.',
    visual: 'Grouped bars plus an area or line. Vertical only.',
  },
  'radial-bar-chart': {
    id: 'radial-bar-chart',
    chartTypeKeys: ['radialBarChart'],
    role: 'Compare a few categories by ring length instead of a bar.',
    data: 'Category and one number. Few categories.',
    visual: 'One ring per category over a 270° sweep.',
  },
  'polar-area-chart': {
    id: 'polar-area-chart',
    chartTypeKeys: ['polarAreaChart'],
    role: 'Compare a few categories by wedge radius.',
    data: 'Category and one number, optional group.',
    visual: 'Coxcomb slices. Radius is the metric, not the share of a whole.',
  },
  'pie-chart': {
    id: 'pie-chart',
    chartTypeKeys: ['pieChart'],
    role: 'Show each category as a share of a total.',
    data: 'Categories whose metric sums to a whole. Low cardinality.',
    visual: 'Full disc. Angle is the share.',
  },
  'donut-chart': {
    id: 'donut-chart',
    chartTypeKeys: ['donutChart'],
    role: 'Same shares as a pie, with a hole in the middle.',
    data: 'Same as pie: categories that sum to a whole.',
    visual: 'Ring. Angle is the share.',
  },
  'treemap-chart': {
    id: 'treemap-chart',
    chartTypeKeys: ['treemapChart'],
    role: 'Show magnitude, or a share of a total, as tile area. A second category nests tiles.',
    data: 'Category and a number. Optional subgroup for one card per group.',
    visual: 'Area-proportional tiles. Color follows magnitude.',
  },
  'band-utilization-chart': {
    id: 'band-utilization-chart',
    chartTypeKeys: ['bandUtilizationChart'],
    role: 'Show the same share breakdown once per entity.',
    data: 'One category for the entity, one category for the segment, and the segment share of the row. Each row sums to its own whole.',
    visual: 'One horizontal band per entity. Segment width is the share. The percent is written inside the segment.',
  },
  'histogram-chart': {
    id: 'histogram-chart',
    chartTypeKeys: ['histogramChart'],
    role: 'Show the shape of one numeric variable.',
    data: 'Numeric samples, binned. Optional series stacks the bins.',
    visual: 'Adjacent bars along a linear x-axis.',
  },
  'box-plot-chart': {
    id: 'box-plot-chart',
    chartTypeKeys: ['boxplotChart'],
    role: 'Summarize a numeric sample per category: median, quartiles, outliers.',
    data: 'Numeric samples, split by a category.',
    visual: 'Box, whiskers, and outlier points. Vertical or horizontal.',
  },
  'violin-chart': {
    id: 'violin-chart',
    chartTypeKeys: ['violinChart'],
    role: 'Show the density of a numeric sample per category, with a box inside.',
    data: 'Numeric samples, split by a category.',
    visual: 'Kernel density plus a box overlay.',
  },
  'scatter-plot-chart': {
    id: 'scatter-plot-chart',
    chartTypeKeys: ['scatterplotChart', 'qqPlot'],
    role: 'Show the relationship between two numbers. Also a QQ plot of quantiles.',
    data: 'Numeric x, numeric y, optional group.',
    visual: 'One point per row. Color marks the group.',
  },
  'bubble-chart': {
    id: 'bubble-chart',
    chartTypeKeys: ['bubbleChart'],
    role: 'Same two-number relationship as a scatter, with a third number as size.',
    data: 'Numeric x, numeric y, a size number, optional group.',
    visual: 'Point radius from the absolute size. Color marks the group.',
  },
  'matrix-chart': {
    id: 'matrix-chart',
    chartTypeKeys: ['matrixChart'],
    role: 'Show the metric at each pair of categories.',
    data: 'Row category, column category, one number.',
    visual: 'Cell color on a sequential palette.',
  },
  'punchcard-chart': {
    id: 'punchcard-chart',
    chartTypeKeys: ['punchcardChart'],
    role: 'Same two-category grid as a matrix, drawn as dots.',
    data: 'Row category, column category, one number.',
    visual: 'Dot size (and position) encodes the metric.',
  },
  'radar-chart': {
    id: 'radar-chart',
    chartTypeKeys: ['radarChart', 'radarGroupedChart'],
    role: 'Compare one or a few entities across several metrics on a shared scale.',
    data: 'Few entities, several numeric axes.',
    visual: 'Polygon on a polar grid. One shape, or one per series.',
  },
  'parallel-coordinates-chart': {
    id: 'parallel-coordinates-chart',
    chartTypeKeys: ['parallelCoordinatesChart'],
    role: 'Compare many records across several numeric dimensions.',
    data: 'Many rows. Every numeric column is an axis.',
    visual: 'One polyline per record. Color follows the active axis.',
  },
  'sankey-chart': {
    id: 'sankey-chart',
    chartTypeKeys: ['sankeyChart'],
    role: 'Show how much moves from a source category to a target category.',
    data: 'Source, target, and a value.',
    visual: 'Nodes and value-coloured ribbons.',
  },
  'waterfall-chart': {
    id: 'waterfall-chart',
    chartTypeKeys: ['waterfallChart'],
    role: 'Show how signed steps add up to a total.',
    data: 'Ordered categories and a signed delta, or a running level.',
    visual: 'Floating bars. Vertical or horizontal.',
  },
  'map-chart': {
    id: 'map-chart',
    chartTypeKeys: ['mapChart', 'UniversalMap'],
    role: 'Place a metric on geography.',
    data: 'Region id or lat/lng, optional magnitude.',
    visual: 'Choropleth fill, bubbles, or spikes on a map.',
  },
  'network-graph': {
    id: 'network-graph',
    chartTypeKeys: ['networkGraphChart'],
    role: 'Show what is connected to what.',
    data: 'Nodes and links.',
    visual: 'Force layout. Node size from a value, color from a category.',
  },
  'kpi-widget': {
    id: 'kpi-widget',
    chartTypeKeys: ['KPI', 'KPIs'],
    role: 'State a headline card: one number, its change, current versus previous, or the high and low of a category.',
    data: 'One metric. A change, a previous period, or a category for high and low, when that reading was asked.',
    visual: 'Cards, not a plot.',
  },
  'status-gauge-widget': {
    id: 'status-gauge-widget',
    chartTypeKeys: ['statusGaugeWidget'],
    role: 'State one health score as a dial, plus the measures behind it.',
    data: 'A health or condition score that already exists, plus at least one other measure. Optional unit, status, min, and max.',
    visual: 'Semicircular health gauge and KPI cards with ticked range bars.',
  },
  'loss-indicator': {
    id: 'loss-indicator',
    chartTypeKeys: ['lossIndicator'],
    role: 'Read one metric as its position on a threshold scale.',
    data: 'Exactly one metric that already has a minimum, a maximum, and operating thresholds. Optional unit and trend. Not a health score beside other measures, and not several metrics.',
    visual: 'Coloured ticks, a marker on the current value, and an optional trend arrow. Ticks past the marker stay grey.',
  },
  'step-line-chart': {
    id: 'step-line-chart',
    chartTypeKeys: ['stepLineChart', 'ksPlotChart', 'rocCurveChart'],
    role: 'Show a metric that holds until the next x. Also KS and ROC reference overlays.',
    data: 'Ordered x and a number, optional series. KS/ROC add a reference curve.',
    visual: 'Step line. `ksPlotChart` draws the ideal curve; `rocCurveChart` draws the diagonal.',
  },
  'spark-line-chart': {
    id: 'spark-line-chart',
    chartTypeKeys: ['sparkLineChart'],
    role: 'Compact reading of a datetime series.',
    data: 'Datetime x and a number, optional series.',
    visual: 'Line with axes and a crosshair.',
  },
  'spark-area-chart': {
    id: 'spark-area-chart',
    chartTypeKeys: ['sparkAreaChart'],
    role: 'Compact datetime series with the region under the line filled.',
    data: 'Datetime x and a number, optional series.',
    visual: 'Line filled to y = 0.',
  },
  'scatter-sparkline-chart': {
    id: 'scatter-sparkline-chart',
    chartTypeKeys: ['scatterSparklineChart'],
    role: 'Datetime series as a line, with the underlying points still visible.',
    data: 'Datetime x, a number, and the raw points.',
    visual: 'Aggregated line with gradient fill plus jittered markers.',
  },
  'partial-dependence-chart': {
    id: 'partial-dependence-chart',
    chartTypeKeys: ['partialDependenceChart'],
    role: 'Show how a model prediction moves as one feature changes.',
    data: 'Feature values, ICE curves, and their average.',
    visual: 'Faint ICE lines under a dashed average.',
  },
  'bias-variance-tradeoff-chart': {
    id: 'bias-variance-tradeoff-chart',
    chartTypeKeys: ['biasVarianceTradeoffChart'],
    role: 'Show bias, variance, and total error against model complexity.',
    data: 'Complexity on x and the three error curves.',
    visual: 'Fixed diagnostic lines, not a general series.',
  },
  'gini-impurity-entropy-chart': {
    id: 'gini-impurity-entropy-chart',
    chartTypeKeys: ['giniImpurityEntropyChart'],
    role: 'Show impurity of a binary split across the class probability.',
    data: 'Probability p, and the entropy / Gini / misclassification curves.',
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
    alternatives: [],
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
    alternatives: [],
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
