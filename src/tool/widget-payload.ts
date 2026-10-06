/**
 * Chart object for the hosted MCP App. Builders live in `./payload/`.
 * A component missing from that registry keeps the raw table rows.
 */

export { bindFieldMap } from './payload/bind-fields.js';
export { catalogChartTypeKey, chartTypeForComponent } from './payload/chart-type.js';
export {
  chartPayloadTitle,
  isSlugChartName,
  workspaceWidgetPayload,
} from './payload/index.js';
