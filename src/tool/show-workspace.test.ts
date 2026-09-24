import { describe, expect, it } from 'vitest';

import type { EngineCatalog } from '../spec/engine-catalog.js';
import type { DataProfile } from '../spec/data-profile.js';
import { INTENTS } from '../spec/intent.js';
import { classifyColumns } from '../profiler/roles.js';
import { parseCsvTable } from '../profiler/table.js';
import {
  CALL_SERVER_TOOL,
  attachDataHandle,
  readViaHandle,
  type SignedLink,
} from './data-channel.js';
import { datasetFromPayload } from './ingest-table.js';
import {
  SHOW_WORKSPACE_DESCRIPTION,
  SHOW_WORKSPACE_INPUT_SCHEMA,
  SHOW_WORKSPACE_NAME,
  handleShowWorkspace,
  type ShowWorkspaceContext,
} from './show-workspace.js';

const catalog: EngineCatalog = [
  {
    id: 'map-chart',
    intents: ['spatial'],
    allowedActions: ['hover', 'pan', 'zoom', 'resize'],
    dataRoles: [
      { id: 'geo', required: true },
      { id: 'metric', required: false },
    ],
    eligibility: [
      {
        when: 'profile.hasGeo && profile.hasMapToken',
        reason: 'Map is eligible when the profile is spatial and a token is available.',
      },
    ],
  },
  {
    id: 'bar-chart',
    intents: ['comparison'],
    allowedActions: ['hover', 'resize'],
    dataRoles: [
      { id: 'category', required: true },
      { id: 'metric', required: true },
    ],
    eligibility: [
      {
        when: 'profile.hasCategory && profile.hasNumericMetric && profile.categoryCardinality <= 30',
        reason: 'Bar compares a handful of discrete groups on one metric.',
      },
    ],
  },
  {
    id: 'kpi-widget',
    intents: ['summary'],
    allowedActions: ['resize'],
    dataRoles: [{ id: 'metric', required: true }],
    eligibility: [
      {
        when: 'profile.hasNumericMetric && profile.categoryCardinality <= 12',
        reason: 'KPI summarises a small set of numeric headlines.',
      },
    ],
  },
  {
    id: 'form',
    intents: ['form'],
    allowedActions: ['submit'],
    dataRoles: [{ id: 'fields', required: true }],
    accessibility: { nameFrom: 'form label' },
    eligibility: [
      {
        when: 'profile.allControlsLabelled && profile.controlCount >= 1',
        reason: 'Form collects labelled fields.',
      },
    ],
  },
];

const profile: DataProfile = {
  hasCategory: true,
  hasNumericMetric: true,
  categoryCardinality: 5,
  hasGeo: true,
  hasMapToken: true,
  allControlsLabelled: true,
  controlCount: 2,
  rowCount: 3,
};

const secretRows = [
  { region: 'secret-north', value: 99 },
  { region: 'secret-south', value: 1 },
];

function memoryChannel() {
  const store = new Map<string, unknown>();
  let seq = 0;
  return {
    signDataLink(payload: unknown): SignedLink {
      const id = `link-${++seq}`;
      store.set(id, payload);
      return { dataUrl: `https://workspace.local/v1/data-links/${id}` };
    },
    readDataLink(link: SignedLink): unknown {
      const id = link.dataUrl.split('/').pop();
      return id ? store.get(id) : undefined;
    },
    loadDataset(id: string) {
      return datasetFromPayload(store.get(id));
    },
  };
}

function context(overrides: Partial<ShowWorkspaceContext> = {}): ShowWorkspaceContext {
  const channel = memoryChannel();
  return {
    catalog,
    profile,
    payload: secretRows,
    signDataLink: channel.signDataLink,
    loadDataset: channel.loadDataset,
    ...overrides,
  };
}

function hasRowObjects(value: unknown): boolean {
  const json = JSON.stringify(value);
  return json.includes('secret-north') || json.includes('"value":99');
}

describe('show_workspace', () => {
  it('is one tool with a closed intent schema and a 2–3 KB description', () => {
    expect(SHOW_WORKSPACE_NAME).toBe('show_workspace');
    expect(SHOW_WORKSPACE_INPUT_SCHEMA.properties.intent.enum).toEqual([...INTENTS]);
    expect(SHOW_WORKSPACE_INPUT_SCHEMA.properties).not.toHaveProperty('data');
    expect(SHOW_WORKSPACE_INPUT_SCHEMA.properties).toHaveProperty('csv');
    expect(SHOW_WORKSPACE_INPUT_SCHEMA.properties).toHaveProperty('datasetId');
    expect(SHOW_WORKSPACE_INPUT_SCHEMA.additionalProperties).toBe(false);
    const bytes = new TextEncoder().encode(SHOW_WORKSPACE_DESCRIPTION).length;
    expect(bytes).toBeGreaterThanOrEqual(2048);
    expect(bytes).toBeLessThanOrEqual(3072);
    expect(SHOW_WORKSPACE_DESCRIPTION.includes('bar-chart')).toBe(false);
    expect(SHOW_WORKSPACE_DESCRIPTION.includes('network-graph')).toBe(false);
  });

  it('refuses args that smuggle data rows', async () => {
    const result = await handleShowWorkspace(
      { intent: 'comparison', data: secretRows },
      context(),
    );
    expect(result).toMatchObject({ ok: false, code: 'rows_in_args' });
    expect(hasRowObjects(result)).toBe(false);
  });

  it('profiles a pasted csv instead of the server demo table', async () => {
    const remembered: string[] = [];
    const result = await handleShowWorkspace(
      { intent: 'comparison', csv: 'team,score\nAlpha,10\nBeta,20\nGamma,5\n' },
      context({
        rememberTable: (table) => {
          remembered.push(table.columns.map((column) => column.name).join(','));
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.component).toBe('bar-chart');
    expect(result.spec.binds).toEqual([
      { role: 'category', field: 'team' },
      { role: 'metric', field: 'score' },
    ]);
    expect(result.datasetId).toBe('link-1');
    expect(result.rowCount).toBe(3);
    expect(result.columns).toEqual(['team', 'score']);
    expect(JSON.stringify(result)).not.toContain('Alpha');
    expect(remembered).toEqual(['team,score']);
  });

  it('reuses datasetId without the csv body', async () => {
    const ctx = context();
    const first = await handleShowWorkspace(
      { intent: 'comparison', csv: 'team,score\nAlpha,10\nBeta,20\n' },
      ctx,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await handleShowWorkspace(
      { intent: 'summary', datasetId: first.datasetId },
      ctx,
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.spec.component).toBe('kpi-widget');
    expect(second.columns).toEqual(['team', 'score']);
    expect(JSON.stringify(second)).not.toContain('Alpha');
  });

  it('refuses csv and datasetId together', async () => {
    const result = await handleShowWorkspace(
      { intent: 'comparison', csv: 'a,b\n1,2\n', datasetId: 'x' },
      context(),
    );
    expect(result).toMatchObject({ ok: false, code: 'invalid_ingest' });
  });

  it('returns spec and summary without row objects', async () => {
    const result = await handleShowWorkspace({ intent: 'comparison' }, context());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.component).toBe('bar-chart');
    expect(result.chartType).toBe('barChart');
    expect(result.spec.binds).toEqual([
      { role: 'category', field: 'category' },
      { role: 'metric', field: 'metric' },
    ]);
    expect(result.summary.includes('secret-north')).toBe(false);
    expect(hasRowObjects(result)).toBe(false);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('does not bind the category field again as series', async () => {
    const withSeries = catalog.map((entry) =>
      entry.id === 'bar-chart'
        ? {
            ...entry,
            dataRoles: [
              { id: 'category', required: true },
              { id: 'metric', required: true },
              { id: 'series', required: false },
            ],
          }
        : entry,
    );
    const result = await handleShowWorkspace(
      {
        intent: 'comparison',
        csv: 'pharmacy,compensated_sum\nA,10\nB,20\n',
      },
      context({ catalog: withSeries }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const binds = result.spec.binds ?? [];
    const fields = Array.isArray(binds) ? binds.map((item) => item.field) : [];
    expect(new Set(fields).size).toBe(fields.length);
    expect(result.spec.binds).toEqual([
      { role: 'category', field: 'pharmacy' },
      { role: 'metric', field: 'compensated_sum' },
    ]);
  });

  it('refuses a required series role when the only category field is already the x axis', async () => {
    const withSeries = catalog.map((entry) =>
      entry.id === 'bar-chart'
        ? {
            ...entry,
            dataRoles: [
              { id: 'category', required: true },
              { id: 'series', required: true },
              { id: 'metric', required: true },
            ],
          }
        : entry,
    );
    const result = await handleShowWorkspace(
      {
        intent: 'comparison',
        csv: 'pharmacy,compensated_sum\nA,10\nB,20\n',
      },
      context({ catalog: withSeries }),
    );
    expect(result).toMatchObject({ ok: false, code: 'missing_binds' });
  });

  it('picks different components for four intents without an LLM', async () => {
    const winners = [];
    for (const intent of ['spatial', 'comparison', 'summary', 'form'] as const) {
      const result = await handleShowWorkspace({ intent }, context());
      expect(result.ok).toBe(true);
      if (result.ok) winners.push(result.spec.component);
    }
    expect(winners).toEqual(['map-chart', 'bar-chart', 'kpi-widget', 'form']);
    const form = await handleShowWorkspace({ intent: 'form' }, context());
    expect(form.ok).toBe(true);
    if (form.ok) expect(form.chartType).toBe('customWidget');
  });

  it('holds approval-bar and leaves spatial hover unheld', async () => {
    const approvalCatalog: EngineCatalog = [
      ...catalog,
      {
        id: 'approval-bar',
        intents: ['form'],
        allowedActions: ['approve', 'reject'],
        dataRoles: [{ id: 'proposal', required: true }],
        eligibility: [
          {
            when: 'profile.hasEntityId',
            reason: 'Approval bar proposes an action on an entity.',
          },
        ],
      },
    ];
    const held = await handleShowWorkspace(
      { intent: 'form' },
      context({
        catalog: approvalCatalog,
        profile: { ...profile, hasEntityId: true, allControlsLabelled: false, controlCount: 0 },
        fields: ['claim'],
      }),
    );
    expect(held.ok).toBe(true);
    if (!held.ok) return;
    expect(held.spec.component).toBe('approval-bar');
    expect(held.trace.outcome).toBe('held');
    expect(held.proposal).toMatchObject({
      action: 'approve',
      preview: 'Preview approve. This is not an execution.',
    });
    expect(held.proposal?.id).toBe('proposal:approve');
    expect(held.trace.proposal).toEqual(held.proposal);
    expect(held.trace.proposals.map((item) => item.action)).toEqual(['approve', 'reject']);
    expect(JSON.stringify(held.trace)).not.toContain('secret-north');

    const spatial = await handleShowWorkspace({ intent: 'spatial' }, context());
    expect(spatial.ok).toBe(true);
    if (!spatial.ok) return;
    expect(spatial.spec.component).toBe('map-chart');
    expect(spatial.proposal).toBeUndefined();
    expect(spatial.trace.outcome).toBe('rendered');
    expect(spatial.trace.risk.map((item) => item.band)).toEqual(['low', 'low', 'low', 'low']);
  });
});

describe('data channel', () => {
  it('puts a handle on the spec instead of data rows', async () => {
    const channel = memoryChannel();
    const result = await handleShowWorkspace(
      { intent: 'comparison' },
      context({ signDataLink: channel.signDataLink, payload: secretRows }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.dataUrl).toMatch(/^https:\/\/workspace\.local\/v1\/data-links\//);
    expect(result.spec.callServerTool).toBe(CALL_SERVER_TOOL);
    expect(result.spec).not.toHaveProperty('data');
    expect(hasRowObjects(result)).toBe(false);

    const rows = await readViaHandle(result.spec, channel.readDataLink);
    expect(rows).toEqual(secretRows);
  });

  it('does not copy payload onto the spec when attaching a handle', async () => {
    const channel = memoryChannel();
    const attached = await attachDataHandle(
      { component: 'bar-chart' },
      secretRows,
      channel.signDataLink,
    );
    expect(attached.ok).toBe(true);
    if (!attached.ok) return;
    expect(attached.spec.dataUrl).toBeTruthy();
    expect(attached.spec.callServerTool).toBe(CALL_SERVER_TOOL);
    expect(hasRowObjects(attached.spec)).toBe(false);
    expect(await readViaHandle(attached.spec, channel.readDataLink)).toEqual(secretRows);
  });

  it('refuses a dataUrl that embeds the payload', async () => {
    const result = await handleShowWorkspace(
      { intent: 'comparison' },
      context({
        signDataLink: (payload) => ({
          dataUrl: `https://workspace.local/v1/data-links?payload=${encodeURIComponent(JSON.stringify(payload))}`,
        }),
      }),
    );
    expect(result).toMatchObject({ ok: false, code: 'leaky_handle' });
    expect(hasRowObjects(result)).toBe(false);
  });

  it('refuses a dataUrl with extra query keys even if they are not JSON', async () => {
    const result = await handleShowWorkspace(
      { intent: 'comparison' },
      context({
        signDataLink: () => ({
          dataUrl: 'https://workspace.local/v1/data-links/abc?payload=YmFzZTY0',
        }),
      }),
    );
    expect(result).toMatchObject({ ok: false, code: 'leaky_handle' });
  });

  it('accepts an opaque handle with HMAC query keys', async () => {
    const result = await handleShowWorkspace(
      { intent: 'comparison' },
      context({
        signDataLink: () => ({
          dataUrl: 'https://workspace.local/v1/data-links/abc?sig=deadbeef&exp=1',
        }),
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.dataUrl).toBe('https://workspace.local/v1/data-links/abc?sig=deadbeef&exp=1');
  });
});

describe('show_workspace fail-closed', () => {
  it('refuses an unknown intent', async () => {
    const result = await handleShowWorkspace({ intent: 'pie' }, context());
    expect(result).toMatchObject({ ok: false, code: 'unknown_intent' });
  });

  it('distinguishes a missing signer from a signer failure', async () => {
    const missing = await handleShowWorkspace(
      { intent: 'comparison' },
      context({ signDataLink: true as unknown as ShowWorkspaceContext['signDataLink'] }),
    );
    expect(missing).toMatchObject({ ok: false, code: 'missing_signer' });

    const failed = await handleShowWorkspace(
      { intent: 'comparison' },
      context({ signDataLink: async () => ({ dataUrl: '' }) }),
    );
    expect(failed).toMatchObject({ ok: false, code: 'signer_failed' });
  });

  it('refuses when required data roles have too few field names', async () => {
    const result = await handleShowWorkspace(
      { intent: 'comparison' },
      context({ fields: ['severity'] }),
    );
    expect(result).toMatchObject({ ok: false, code: 'missing_binds' });
  });

  it('refuses non-string field names instead of throwing', async () => {
    const result = await handleShowWorkspace(
      { intent: 'comparison' },
      context({ fields: [123, 'count'] as unknown as string[] }),
    );
    expect(result).toMatchObject({ ok: false, code: 'missing_binds' });
  });

  it('binds caller field names onto required catalog roles', async () => {
    const result = await handleShowWorkspace(
      { intent: 'comparison' },
      context({ fields: ['severity', 'count'] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.binds).toEqual([
      { role: 'category', field: 'severity' },
      { role: 'metric', field: 'count' },
    ]);
    expect(hasRowObjects(result)).toBe(false);
  });

  it('binds profiler columns onto catalog roles, not CSV order', async () => {
    const table = parseCsvTable('id,country,team,incidents\nINC-001,FR,Search,22\n');
    const result = await handleShowWorkspace(
      { intent: 'comparison' },
      context({
        fields: table.columns.map((column) => column.name),
        classified: classifyColumns(table).columns,
        payload: [{ id: 'INC-001', country: 'FR', team: 'Search', incidents: '22' }],
        profile: {
          ...profile,
          hasGeo: true,
          hasEntityId: true,
          categoryCardinality: 1,
          rowCount: 1,
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.binds).toEqual([
      { role: 'category', field: 'team' },
      { role: 'metric', field: 'incidents' },
    ]);
    expect(result.chartType).toBe('barChart');
  });

  it('binds optional map metric when the profiler found one', async () => {
    const table = parseCsvTable('country,incidents\nFR,12\nDE,11\n');
    const result = await handleShowWorkspace(
      { intent: 'spatial' },
      context({
        fields: table.columns.map((column) => column.name),
        classified: classifyColumns(table).columns,
        payload: [
          { country: 'FR', incidents: '12' },
          { country: 'DE', incidents: '11' },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.component).toBe('map-chart');
    expect(result.spec.binds).toEqual([
      { role: 'geo', field: 'country' },
      { role: 'metric', field: 'incidents' },
    ]);
  });

  it('binds histogram distribution to the profiler metric column', async () => {
    const table = parseCsvTable('score\n1\n4\n4\n8\n');
    const result = await handleShowWorkspace(
      { intent: 'comparison' },
      context({
        catalog: [
          {
            id: 'histogram-chart',
            intents: ['comparison'],
            allowedActions: ['hover', 'resize'],
            dataRoles: [{ id: 'distribution', required: true }],
            chartTypeKeys: ['histogramChart'],
            eligibility: [
              {
                when: 'profile.hasNumericMetric',
                reason: 'Histogram bins a numeric column.',
              },
            ],
          },
        ],
        fields: table.columns.map((column) => column.name),
        classified: classifyColumns(table).columns,
        payload: [{ score: '1' }, { score: '4' }, { score: '4' }, { score: '8' }],
        profile: {
          hasNumericMetric: true,
          rowCount: 4,
          hasCategory: false,
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.component).toBe('histogram-chart');
    expect(result.spec.binds).toEqual([{ role: 'distribution', field: 'score' }]);
    expect(result.chartType).toBe('histogramChart');
  });
});
