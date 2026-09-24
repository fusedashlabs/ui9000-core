const CHART_TYPE_BY_COMPONENT: Record<string, string> = {
  'bar-chart': 'barChart',
  'histogram-chart': 'histogramChart',
  'map-chart': 'mapChart',
  'kpi-widget': 'KPI',
  'network-graph': 'networkGraphChart',
  table: 'customWidget',
  text: 'customWidget',
  image: 'customWidget',
  'event-timeline': 'customWidget',
  'evidence-panel': 'customWidget',
  'entity-detail': 'customWidget',
  'text-input': 'customWidget',
  'number-input': 'customWidget',
  select: 'customWidget',
  'multi-select': 'customWidget',
  checkbox: 'customWidget',
  'date-input': 'customWidget',
  button: 'customWidget',
  form: 'customWidget',
  'approval-bar': 'customWidget',
};

export function catalogChartTypeKey(
  chartTypeKeys?: readonly string[],
): string | undefined {
  return chartTypeKeys?.find((key) => key.trim().length > 0 && key !== '*');
}

/** Always a FuseDash chartType so the MCP App View never receives a blank type. */
export function chartTypeForComponent(
  component: string,
  chartTypeKeys?: readonly string[],
): string {
  return (
    catalogChartTypeKey(chartTypeKeys) ??
    CHART_TYPE_BY_COMPONENT[component] ??
    'customWidget'
  );
}
