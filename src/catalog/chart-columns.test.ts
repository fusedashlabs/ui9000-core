import { describe, expect, it } from 'vitest';

import type { Intent } from '../spec/intent.js';
import { handleShowWorkspace, type ShowWorkspaceContext } from '../tool/show-workspace.js';
import { CHART_FAMILIES, CHART_ROLES } from './chart-roles.js';
import { loadWorkspaceCatalog } from './load-workspace.js';

/**
 * Each chart's `columns` is what the model is told to rewrite its table into
 * when the chart it named did not fit. A reader that drifts from its example
 * would send the model a table that still does not draw.
 */

function context(): ShowWorkspaceContext {
  return {
    catalog: loadWorkspaceCatalog(),
    profile: {},
    payload: [],
    signDataLink: (payload: unknown) => ({ dataUrl: `https://workspace.local/v1/data-links/${JSON.stringify(payload).length}` }),
  };
}

const FAMILY_INTENT: Record<string, Intent> = { graph: 'graph', headline: 'summary', spatial: 'spatial' };

function intentFor(id: string): Intent {
  const family = CHART_FAMILIES.find(
    (item) => item.main === id || item.alternatives.some((alt) => alt.id === id),
  );
  return (family && FAMILY_INTENT[family.id]) ?? 'comparison';
}

describe('chart columns', () => {
  it.each(Object.values(CHART_ROLES).map((role) => [role.id, role.columns] as const))(
    'draws %s from its own columns when it is named',
    async (id, columns) => {
      const result = await handleShowWorkspace({ intent: intentFor(id), csv: columns, requestedChart: id }, context());
      expect(result.ok && result.spec.component).toBe(id);
    },
  );
});
