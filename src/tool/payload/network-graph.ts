/**
 * Network object from mcp-ui generate_network_graph.
 * Endpoints are two different columns. A link is kept only when source and
 * target are non-empty, different, and both exist as nodes.
 */
export function networkGraphPayload(
  chartType: string | undefined,
  fields: Record<string, string>,
  rows: Record<string, unknown>[],
): unknown | null {
  const sourceField = fields.nodes;
  const targetField = fields.links;
  if (!sourceField || !targetField || sourceField === targetField) return null;
  if (!(sourceField in rows[0]!) || !(targetField in rows[0]!)) return null;

  const metric =
    fields.metric &&
    fields.metric !== sourceField &&
    fields.metric !== targetField &&
    fields.metric in rows[0]!
      ? fields.metric
      : undefined;

  const nodes = new Map<string, { id: string; label: string; type: string }>();
  const links = new Map<string, { id: string; source: string; target: string; value: number }>();

  for (const row of rows) {
    const source = String(row[sourceField] ?? '').trim();
    const target = String(row[targetField] ?? '').trim();
    if (!source || !target || source === target) continue;
    if (!nodes.has(source)) nodes.set(source, { id: source, label: source, type: 'node' });
    if (!nodes.has(target)) nodes.set(target, { id: target, label: target, type: 'node' });
    const raw = metric ? Number(row[metric]) : 1;
    const value = Number.isFinite(raw) ? raw : 1;
    const id = `${source}->${target}`;
    const existing = links.get(id);
    if (existing) existing.value += value;
    else links.set(id, { id, source, target, value });
  }

  if (links.size === 0) return null;
  return {
    chartType: chartType || 'networkGraphChart',
    name: 'network-graph',
    nodes: [...nodes.values()],
    links: [...links.values()],
  };
}
