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
import { requestedChartFromUtterance } from '../catalog/discuss-chart.js';
import {
  SHOW_WORKSPACE_DESCRIPTION,
  SHOW_WORKSPACE_INPUT_SCHEMA,
  SHOW_WORKSPACE_NAME,
  handleShowWorkspace,
  isDatasetFollowUp,
  type ShowWorkspaceContext,
  type ShowWorkspaceOk,
  type ShowWorkspaceResult,
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
  { category: 'secret-north', metric: 99 },
  { category: 'secret-south', metric: 1 },
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

function columnSession(channel: ReturnType<typeof memoryChannel>) {
  let selected: readonly string[] | undefined;
  return () =>
    context({
      signDataLink: channel.signDataLink,
      loadDataset: channel.loadDataset,
      selectedColumns: selected,
      rememberColumns: (names) => {
        selected = names ? [...names] : undefined;
      },
    });
}

function isDrawn(result: ShowWorkspaceResult): result is ShowWorkspaceOk {
  return result.ok === true && result.awaitingUser !== true;
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
    expect(SHOW_WORKSPACE_INPUT_SCHEMA.properties).toHaveProperty('columns');
    expect(SHOW_WORKSPACE_INPUT_SCHEMA.additionalProperties).toBe(false);
    const bytes = new TextEncoder().encode(SHOW_WORKSPACE_DESCRIPTION).length;
    expect(bytes).toBeGreaterThanOrEqual(2048);
    expect(bytes).toBeLessThanOrEqual(3072);
    expect(SHOW_WORKSPACE_DESCRIPTION.includes('bar-chart')).toBe(false);
    expect(SHOW_WORKSPACE_DESCRIPTION.includes('network-graph')).toBe(false);
    expect(SHOW_WORKSPACE_DESCRIPTION).toContain('A refusal is not awaitingUser');
    expect(SHOW_WORKSPACE_DESCRIPTION).toContain('Do not replace their chart with suggestion');
    const step1 = SHOW_WORKSPACE_DESCRIPTION.indexOf('1. Read the table');
    const step2 = SHOW_WORKSPACE_DESCRIPTION.indexOf('2. Classify the columns');
    const step3 = SHOW_WORKSPACE_DESCRIPTION.indexOf('3. Pass utterance');
    const step4 = SHOW_WORKSPACE_DESCRIPTION.indexOf('4. Draw the chart they named');
    const step5 = SHOW_WORKSPACE_DESCRIPTION.indexOf('5. If the named chart cannot be drawn');
    expect(step1).toBeGreaterThan(-1);
    expect(step1).toBeLessThan(step2);
    expect(step2).toBeLessThan(step3);
    expect(step3).toBeLessThan(step4);
    expect(step4).toBeLessThan(step5);
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
    if (!isDrawn(result)) return;
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
    expect(isDrawn(first)).toBe(true);
    if (!isDrawn(first)) return;
    const second = await handleShowWorkspace(
      { intent: 'summary', datasetId: first.datasetId },
      ctx,
    );
    expect(isDrawn(second)).toBe(true);
    if (!isDrawn(second)) return;
    expect(second.spec.component).toBe('kpi-widget');
    expect(second.columns).toEqual(['team', 'score']);
    expect(JSON.stringify(second)).not.toContain('Alpha');
  });

  it('draws a status gauge when a health score sits beside other measures', async () => {
    const result = await handleShowWorkspace(
      { intent: 'summary', csv: 'unitHealth,txPower,temp\n72.8,28,68\n' },
      context(),
    );
    expect(isDrawn(result)).toBe(true);
    if (!isDrawn(result)) return;
    expect(result.spec.component).toBe('status-gauge-widget');
  });

  it('keeps a KPI when the only number is not a health score', async () => {
    const result = await handleShowWorkspace(
      { intent: 'summary', csv: 'txPower,temp\n28,68\n' },
      context(),
    );
    expect(isDrawn(result)).toBe(true);
    if (!isDrawn(result)) return;
    expect(result.spec.component).toBe('kpi-widget');
  });

  it('draws status cards when the gauge is requested without a health score', async () => {
    const result = await handleShowWorkspace(
      { intent: 'summary', requestedChart: 'statusGaugeWidget', csv: 'txPower,temp\n28,68\n' },
      context(),
    );
    expect(isDrawn(result)).toBe(true);
    if (!isDrawn(result)) return;
    expect(result.spec.component).toBe('status-gauge-widget');
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
    if (!isDrawn(result)) return;
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
    if (!isDrawn(result)) return;
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
    const countries = parseCsvTable('country,incidents\nFR,12\nDE,11\n');
    for (const intent of ['spatial', 'comparison', 'summary', 'form'] as const) {
      const result = await handleShowWorkspace(
        { intent },
        intent === 'spatial'
          ? context({
              fields: ['country', 'incidents'],
              classified: classifyColumns(countries).columns,
              payload: [
                { country: 'FR', incidents: '12' },
                { country: 'DE', incidents: '11' },
              ],
            })
          : context(),
      );
      expect(isDrawn(result)).toBe(true);
      if (isDrawn(result)) winners.push(result.spec.component);
    }
    expect(winners).toEqual(['map-chart', 'bar-chart', 'kpi-widget', 'form']);
    const form = await handleShowWorkspace({ intent: 'form' }, context());
    expect(isDrawn(form)).toBe(true);
    if (isDrawn(form)) expect(form.chartType).toBe('customWidget');
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
    expect(isDrawn(held)).toBe(true);
    if (!isDrawn(held)) return;
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

    const countries = parseCsvTable('country,incidents\nFR,12\nDE,11\n');
    const spatial = await handleShowWorkspace(
      { intent: 'spatial' },
      context({
        fields: ['country', 'incidents'],
        classified: classifyColumns(countries).columns,
        payload: [
          { country: 'FR', incidents: '12' },
          { country: 'DE', incidents: '11' },
        ],
      }),
    );
    expect(isDrawn(spatial)).toBe(true);
    if (!isDrawn(spatial)) return;
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
    if (!isDrawn(result)) return;
    expect(result.spec.dataUrl).toMatch(/^https:\/\/workspace\.local\/v1\/data-links\//);
    expect(result.spec.callServerTool).toBe(CALL_SERVER_TOOL);
    expect(result.spec).not.toHaveProperty('data');
    expect(hasRowObjects(result)).toBe(false);

    const rows = await readViaHandle(result.spec, channel.readDataLink);
    expect(rows).toMatchObject({
      chartType: 'barChart',
      data: secretRows,
    });
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
    if (!isDrawn(result)) return;
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

  it('does not sign rows when the chosen chart cannot be built', async () => {
    const result = await handleShowWorkspace(
      { intent: 'comparison' },
      context({
        fields: ['severity', 'count'],
        payload: [{ region: 'secret-north', value: 99 }],
      }),
    );
    expect(result).toMatchObject({ ok: false, code: 'chart_unbuilt' });
    expect(hasRowObjects(result)).toBe(false);
  });

  it('binds caller field names onto required catalog roles', async () => {
    const result = await handleShowWorkspace(
      { intent: 'comparison' },
      context({
        fields: ['severity', 'count'],
        payload: [
          { severity: 'high', count: 3 },
          { severity: 'low', count: 1 },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!isDrawn(result)) return;
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
    if (!isDrawn(result)) return;
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
    if (!isDrawn(result)) return;
    expect(result.spec.component).toBe('map-chart');
    expect(result.spec.binds).toEqual([
      { role: 'geo', field: 'country' },
      { role: 'metric', field: 'incidents' },
    ]);
  });

  it('refuses a choropleth whose regions match no boundary', async () => {
    const table = parseCsvTable('country,incidents\nNotACountry,12\nAlsoNo,11\n');
    const result = await handleShowWorkspace(
      { intent: 'spatial' },
      context({
        fields: table.columns.map((column) => column.name),
        classified: classifyColumns(table).columns,
        payload: [
          { country: 'NotACountry', incidents: '12' },
          { country: 'AlsoNo', incidents: '11' },
        ],
      }),
    );
    expect(result).toMatchObject({ ok: false, code: 'map_unrenderable' });
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
    if (!isDrawn(result)) return;
    expect(result.spec.component).toBe('histogram-chart');
    expect(result.spec.binds).toEqual([{ role: 'distribution', field: 'score' }]);
    expect(result.chartType).toBe('histogramChart');
  });

  it('charts message data on the columns the user named', async () => {
    const channel = memoryChannel();
    const result = await handleShowWorkspace(
      {
        intent: 'comparison',
        requestedChart: 'bar',
        csv: 'team,score,note\nAlpha,10,ignore\nBeta,4,ignore\n',
        columns: ['team', 'score'],
      },
      context({
        signDataLink: channel.signDataLink,
        loadDataset: channel.loadDataset,
      }),
    );
    expect(isDrawn(result)).toBe(true);
    if (!isDrawn(result)) return;
    expect(result.spec.component).toBe('bar-chart');
    expect(result.columns).toEqual(['team', 'score']);
    expect(result.spec.binds).toEqual([
      { role: 'category', field: 'team' },
      { role: 'metric', field: 'score' },
    ]);
    expect(JSON.stringify(result)).not.toContain('ignore');
    expect(channel.loadDataset(result.datasetId ?? '')?.columns).toEqual(['team', 'score', 'note']);
    const widget = await readViaHandle(result.spec, channel.readDataLink);
    expect(JSON.stringify(widget)).not.toContain('ignore');
    expect(JSON.stringify(widget)).not.toContain('note');
  });

  it('keeps named columns when the next call reuses datasetId', async () => {
    const channel = memoryChannel();
    const session = columnSession(channel);
    const first = await handleShowWorkspace(
      {
        intent: 'comparison',
        requestedChart: 'sankey',
        csv: 'team,score,note\nAlpha,10,ignore\nBeta,4,ignore\n',
        columns: ['team', 'score'],
      },
      session(),
    );
    expect(first.ok).toBe(true);
    if (!first.ok || !first.awaitingUser) return;
    expect(first.columns).toEqual(['team', 'score']);
    expect(first).not.toHaveProperty('spec');
    expect(first.suggestion).toBe('bar-chart');
    expect(first.message).toContain('nothing was generated');

    const second = await handleShowWorkspace(
      {
        intent: 'comparison',
        requestedChart: first.suggestion,
        datasetId: first.datasetId,
      },
      session(),
    );
    expect(isDrawn(second)).toBe(true);
    if (!isDrawn(second)) return;
    expect(second.columns).toEqual(['team', 'score']);
    expect(second.spec.binds).toEqual([
      { role: 'category', field: 'team' },
      { role: 'metric', field: 'score' },
    ]);
    const widget = await readViaHandle(second.spec, channel.readDataLink);
    expect(JSON.stringify(widget)).not.toContain('ignore');
    expect(JSON.stringify(second)).not.toContain('ignore');
  });

  it('uses the whole table when a new csv omits columns', async () => {
    const channel = memoryChannel();
    const session = columnSession(channel);
    await handleShowWorkspace(
      {
        intent: 'comparison',
        csv: 'team,score,note\nAlpha,10,x\nBeta,4,y\n',
        columns: ['team', 'score'],
      },
      session(),
    );
    const next = await handleShowWorkspace(
      {
        intent: 'comparison',
        csv: 'team,score,note\nAlpha,10,x\nBeta,4,y\n',
      },
      session(),
    );
    expect(isDrawn(next)).toBe(true);
    if (!isDrawn(next)) return;
    expect(next.columns).toEqual(['team', 'score', 'note']);
  });

  it('limits an already loaded table to the named columns', async () => {
    const result = await handleShowWorkspace(
      { intent: 'comparison', requestedChart: 'bar', columns: ['team', 'score'] },
      context({
        payload: [
          { team: 'Alpha', score: 10, note: 'secret-cell' },
          { team: 'Beta', score: 4, note: 'other' },
        ],
      }),
    );
    expect(isDrawn(result)).toBe(true);
    if (!isDrawn(result)) return;
    expect(result.columns).toEqual(['team', 'score']);
    expect(result.spec.binds).toEqual([
      { role: 'category', field: 'team' },
      { role: 'metric', field: 'score' },
    ]);
    expect(JSON.stringify(result)).not.toContain('secret-cell');
  });

  it('refuses a column the table does not have', async () => {
    const result = await handleShowWorkspace(
      {
        intent: 'comparison',
        csv: 'region,sales\nNorth,10\n',
        columns: ['region', 'missing'],
      },
      context(),
    );
    expect(result).toMatchObject({ ok: false, code: 'invalid_args' });
    expect(JSON.stringify(result)).not.toContain('North');
  });

  it('refuses a name that matches two headers', async () => {
    const result = await handleShowWorkspace(
      {
        intent: 'comparison',
        csv: 'Team,team,score\nA,B,1\nC,D,2\n',
        columns: ['TEAM'],
      },
      context(),
    );
    expect(result).toMatchObject({ ok: false, code: 'invalid_args' });
    if (result.ok) return;
    expect(result.reason).toContain('Team');
    expect(result.reason).toContain('team');
  });

  it('keeps the exact header when another header differs only by case', async () => {
    const result = await handleShowWorkspace(
      {
        intent: 'comparison',
        requestedChart: 'bar',
        csv: 'Team,team,score\nA,B,1\nC,D,2\n',
        columns: ['Team', 'score'],
      },
      context(),
    );
    expect(isDrawn(result)).toBe(true);
    if (!isDrawn(result)) return;
    expect(result.columns).toEqual(['Team', 'score']);
    expect(result.spec.binds).toEqual([
      { role: 'category', field: 'Team' },
      { role: 'metric', field: 'score' },
    ]);
  });

  it('draws a pie when the user asks for shares of a small category table', async () => {
    const result = await handleShowWorkspace(
      {
        intent: 'comparison',
        requestedChart: 'pie',
        csv: 'team,score\nAlpha,10\nBeta,4\nGamma,6\n',
      },
      context(),
    );
    expect(isDrawn(result)).toBe(true);
    if (!isDrawn(result)) return;
    expect(result.spec.component).toBe('pie-chart');
    expect(result.chartType).toBe('pieChart');
    expect(result.spec.binds).toEqual([
      { role: 'label', field: 'team' },
      { role: 'y', field: 'score' },
    ]);
  });

  it('draws the chart the user named and only suggests a closer fit', async () => {
    const result = await handleShowWorkspace(
      {
        intent: 'comparison',
        requestedChart: 'sankey',
        csv: 'from_team,to_team,moves\nA,B,10\nB,C,4\n',
      },
      context(),
    );
    expect(isDrawn(result)).toBe(true);
    if (!isDrawn(result)) return;
    expect(result.spec.component).toBe('sankey-chart');
    expect(result.suggestion).toBe('bar-chart');
    expect(result.chartWhy).toContain('Drawing it');
    expect(result.chartWhy).toContain('suggestion');
    expect(hasRowObjects(result)).toBe(false);
  });

  it('still draws the named chart when confirm is set', async () => {
    const result = await handleShowWorkspace(
      {
        intent: 'comparison',
        requestedChart: 'sankey',
        confirm: true,
        csv: 'from_team,to_team,moves\nA,B,10\nB,C,4\n',
      },
      context(),
    );
    expect(isDrawn(result)).toBe(true);
    if (!isDrawn(result)) return;
    expect(result.spec.component).toBe('sankey-chart');
    expect(result.suggestion).toBe('bar-chart');
  });

  it('does not generate a substitute when the named chart is unknown', async () => {
    const result = await handleShowWorkspace(
      { intent: 'comparison', requestedChart: 'not-a-chart' },
      context(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok || !result.awaitingUser) return;
    expect(result).not.toHaveProperty('spec');
    expect(result.suggestion).toBe('bar-chart');
    expect(result.message).toContain('nothing was generated');
    expect(result.message).toContain('not-a-chart');
  });

  it('draws the chart the user asked for when it is the main fit', async () => {
    const result = await handleShowWorkspace(
      { intent: 'summary', requestedChart: 'bar' },
      context(),
    );
    expect(isDrawn(result)).toBe(true);
    if (!isDrawn(result)) return;
    expect(result.spec.component).toBe('bar-chart');
    expect(result.chartWhy).toContain('discrete groups');
    expect(result.trace.chosen).toEqual({
      id: 'bar-chart',
      by: 'named',
      why: result.chartWhy,
    });
    expect(result.trace.tieBreak).toBe(result.chartWhy);
    expect(result.summary).toContain('bar-chart');
    expect(result.trace.candidates.map((item) => item.id)).toContain('kpi-widget');
    expect(result.trace.rejections.map((item) => item.id)).not.toContain('bar-chart');
    expect(result.proposal).toBeUndefined();
  });

  it('draws a lollipop when the user asks for that mark on a comparison', async () => {
    const result = await handleShowWorkspace(
      {
        intent: 'comparison',
        requestedChart: 'lollipop',
        csv: 'team,score\nAlpha,10\nBeta,4\n',
      },
      context(),
    );
    expect(isDrawn(result)).toBe(true);
    if (!isDrawn(result)) return;
    expect(result.spec.component).toBe('lollipop');
    expect(result.chartType).toBe('lollipopChart');
    expect(result.spec.binds).toEqual([
      { role: 'label', field: 'team' },
      { role: 'y', field: 'score' },
    ]);
  });

  it('draws a line when the model invents a chart the user did not name', async () => {
    const result = await handleShowWorkspace(
      {
        csv: 'period,closed_sales\nJul 2026,1200\nAug 2026,1100\nSep 2026,1300\n',
        intent: 'comparison',
        requestedChart: 'bar-chart',
        utterance:
          'Do a research on Fairfax county real estate situation for last 3 months and create a list widgets to explain the demand, supply and prices, location best',
      },
      context(),
    );
    expect(isDrawn(result)).toBe(true);
    if (!isDrawn(result)) return;
    expect(result.spec.component).toBe('line-chart');
    expect(JSON.stringify(result)).not.toContain('You asked for');
  });

  it('keeps the chart the user picked when the follow-up resends the old words', async () => {
    const channel = memoryChannel();
    const session = context({
      signDataLink: channel.signDataLink,
      loadDataset: channel.loadDataset,
    });
    const first = await handleShowWorkspace(
      {
        intent: 'comparison',
        csv: 'team,score\nAlpha,10\nBeta,4\nGamma,6\n',
        utterance: 'Compare the teams.',
      },
      session,
    );
    expect(isDrawn(first)).toBe(true);
    if (!isDrawn(first) || !first.datasetId) return;

    const second = await handleShowWorkspace(
      {
        intent: 'comparison',
        datasetId: first.datasetId,
        requestedChart: 'pie',
        utterance: 'Compare the teams.',
      },
      session,
    );
    expect(isDrawn(second)).toBe(true);
    if (!isDrawn(second)) return;
    expect(second.spec.component).toBe('pie-chart');
  });

  it('does not treat csv, url, or path plus datasetId as a follow-up', () => {
    const research =
      'Do a research on Fairfax county real estate situation for last 3 months and create a list widgets to explain the demand, supply and prices, location best';
    const withCsv = { datasetId: 'abc', csv: 'period,closed_sales\nJul,1\n' };
    expect(isDatasetFollowUp({ datasetId: 'abc' })).toBe(true);
    expect(isDatasetFollowUp({ datasetId: 'abc', csv: '' })).toBe(true);
    expect(isDatasetFollowUp(withCsv)).toBe(false);
    expect(isDatasetFollowUp({ datasetId: 'abc', url: 'https://example.test/fairfax.csv' })).toBe(false);
    expect(isDatasetFollowUp({ datasetId: 'abc', path: '/tmp/fairfax.csv' })).toBe(false);
    expect(isDatasetFollowUp({ csv: 'period,closed_sales\nJul,1\n' })).toBe(false);
    expect(requestedChartFromUtterance(research, 'bar-chart', { followUp: isDatasetFollowUp(withCsv) })).toBeUndefined();
  });

  it('refuses csv and datasetId in the same call', async () => {
    const result = await handleShowWorkspace(
      {
        csv: 'period,closed_sales\nJul 2026,1200\nAug 2026,1100\n',
        datasetId: 'already-stored',
        intent: 'comparison',
        requestedChart: 'bar-chart',
        utterance:
          'Do a research on Fairfax county real estate situation for last 3 months and create a list widgets to explain the demand, supply and prices, location best',
      },
      context(),
    );
    expect(result).toMatchObject({ ok: false, code: 'invalid_ingest' });
  });

  it('draws both measures over time when the engine has no comparison chart', async () => {
    const channel = memoryChannel();
    const result = await handleShowWorkspace(
      {
        csv: 'month,active_listings,pending_sales\nJul 2026,2035,1049\nAug 2026,1985,1002',
        intent: 'comparison',
        utterance: 'Fairfax County real estate supply: active listings vs pending sales, July and August',
      },
      context({ signDataLink: channel.signDataLink, loadDataset: channel.loadDataset }),
    );
    expect(isDrawn(result)).toBe(true);
    if (!isDrawn(result)) return;
    expect(result.spec.component).toBe('line-chart');
    expect(result.chartType).toBe('lineGroupedChart');
    const widget = await readViaHandle(result.spec, channel.readDataLink);
    expect(widget).toMatchObject({
      chartType: 'lineGroupedChart',
      xAxe: ['month'],
      groupBy: ['measure'],
    });
    const data = (widget as { data: { measure: string; value: number }[] }).data;
    expect(data.map((row) => row.measure)).toEqual([
      'active_listings',
      'pending_sales',
      'active_listings',
      'pending_sales',
    ]);
    expect(data.map((row) => row.value)).toEqual([2035, 1049, 1985, 1002]);
  });

  it('draws a grouped line when the user asks for a line over time', async () => {
    const result = await handleShowWorkspace(
      {
        intent: 'comparison',
        requestedChart: 'line',
        csv: 'team,month,incidents\nAlpha,2024-01,10\nAlpha,2024-02,12\nBeta,2024-01,4\nBeta,2024-02,9\n',
      },
      context(),
    );
    expect(isDrawn(result)).toBe(true);
    if (!isDrawn(result)) return;
    expect(result.spec.component).toBe('line-chart');
    expect(result.chartType).toBe('lineGroupedChart');
    expect(result.spec.binds).toEqual([
      { role: 'x', field: 'month' },
      { role: 'y', field: 'incidents' },
      { role: 'series', field: 'team' },
    ]);
  });

  it('draws the chart Jev selects when the user did not name one', async () => {
    const result = await handleShowWorkspace(
      { intent: 'comparison', utterance: 'Compare incident counts by team over months.' },
      context({
        profile: { ...profile, hasTemporal: true },
        askJev: async (request) => {
          const offered = Object.keys(request.questions.chart.criteria);
          const choice = offered.includes('lollipop') ? 'line-chart' : 'bar-chart';
          return {
            answers: {
              chart: { type: 'choice', choice, confidence: 0.9 },
            },
          };
        },
      }),
    );
    expect(isDrawn(result)).toBe(true);
    if (!isDrawn(result)) return;
    expect(result.spec.component).toBe('line-chart');
    expect(result.suggestion).toBeUndefined();
    expect(result.trace.chosen).toMatchObject({ id: 'line-chart', by: 'jev' });
    expect(result.trace.candidates.some((item) => item.id !== 'line-chart')).toBe(true);
    expect(result.chartWhy).toContain('Jev selected line-chart');
    expect(result.chartWhy).toContain('because');
  });

  it('keeps the named chart when it sits in the class Jev chose', async () => {
    const result = await handleShowWorkspace(
      {
        intent: 'comparison',
        utterance: 'Show teams as a bar.',
        requestedChart: 'bar',
        csv: 'team,score\nAlpha,10\nBeta,4\n',
      },
      context({
        askJev: async () => ({
          answers: {
            chart: { type: 'choice', choice: 'bar-chart', confidence: 0.9 },
          },
        }),
      }),
    );
    expect(isDrawn(result)).toBe(true);
    if (!isDrawn(result)) return;
    expect(result.spec.component).toBe('bar-chart');
    expect(result.suggestion).toBeUndefined();
    expect(result.chartWhy).toContain('same class');
    expect(result.chartWhy).toContain('stays');
    expect(result.trace.chosen).toMatchObject({ id: 'bar-chart', by: 'named' });
  });

  it('waits when the named chart sits in another class', async () => {
    const result = await handleShowWorkspace(
      {
        intent: 'comparison',
        utterance: 'Show the moves as a sankey.',
        requestedChart: 'sankey',
        csv: 'from_team,to_team,moves\nA,B,10\nB,C,4\n',
      },
      context({
        askJev: async () => ({
          answers: {
            chart: { type: 'choice', choice: 'bar-chart', confidence: 0.9 },
          },
        }),
      }),
    );
    expect(result.ok && result.awaitingUser).toBe(true);
    if (!result.ok || !result.awaitingUser) return;
    expect(result).not.toHaveProperty('spec');
    expect(result.suggestion).toBe('bar-chart');
    expect(result.message).toContain('Source, target, and a value');
    expect(result.message).toContain('Jev would draw bar-chart');
    expect(result.message).toContain('Nothing was generated');
    expect(result.message).toContain('Say which of the two you want');
  });

  it('draws the class main when the mark call fails', async () => {
    const result = await handleShowWorkspace(
      { intent: 'comparison', utterance: 'Compare incident counts by team.' },
      context({
        askJev: async (request) => {
          if (Object.keys(request.questions.chart.criteria).includes('lollipop')) {
            throw new Error('mark down');
          }
          return {
            answers: {
              chart: { type: 'choice', choice: 'bar-chart', confidence: 0.9 },
            },
          };
        },
      }),
    );
    expect(isDrawn(result)).toBe(true);
    if (!isDrawn(result)) return;
    expect(result.spec.component).toBe('bar-chart');
    expect(result.chartWhy).toContain('Jev selected bar-chart');
    expect(result.chartWhy).not.toContain('Jev did not select');
    expect(result.trace.chosen).toMatchObject({ by: 'jev' });
  });

  it('waits when Jev cannot separate two classes', async () => {
    const result = await handleShowWorkspace(
      { intent: 'comparison', utterance: 'Compare incidents by city.' },
      context({
        askJev: async () => ({
          answers: {
            chart: {
              type: 'choice',
              choice: 'bar-chart',
              confidence: 0.52,
              probabilities: { 'bar-chart': 0.52, 'map-chart': 0.48 },
            },
          },
        }),
      }),
    );
    expect(result.ok && result.awaitingUser).toBe(true);
    if (!result.ok || !result.awaitingUser) return;
    expect(result).not.toHaveProperty('spec');
    expect(result.suggestion).toBeUndefined();
    expect(result.message).toContain('hesitated between bar-chart and map-chart');
    expect(result.message).toContain('Nothing was generated');
  });

  it('draws with decide when Jev does not answer', async () => {
    const result = await handleShowWorkspace(
      { intent: 'comparison', utterance: 'Compare teams.' },
      context({
        askJev: async () => {
          throw new Error('down');
        },
      }),
    );
    expect(isDrawn(result)).toBe(true);
    if (!isDrawn(result)) return;
    expect(result.spec.component).toBe('bar-chart');
    expect(result.chartWhy).toContain('Jev did not select');
    expect(result.chartWhy).toContain("not Jev's");
  });

  it('does not draw Jev when the utterance names a chart and requestedChart is missing', async () => {
    const result = await handleShowWorkspace(
      { intent: 'comparison', utterance: 'Compare incidents as a line, not a bar.' },
      context({
        askJev: async () => ({
          answers: {
            chart: { type: 'choice', choice: 'bar-chart', confidence: 0.99 },
            named_chart: { type: 'noul', noul: 0.98 },
          },
        }),
      }),
    );
    expect(result.ok && result.awaitingUser).toBe(true);
    if (!result.ok || !result.awaitingUser) return;
    expect(result).not.toHaveProperty('spec');
    expect(result.suggestion).toBeUndefined();
    expect(result.message).toContain('requestedChart');
    expect(result.message).toContain('names a chart');
  });

  it('uses Jev as the suggestion when the named chart cannot be drawn', async () => {
    const result = await handleShowWorkspace(
      { intent: 'comparison', utterance: 'Show a sankey.', requestedChart: 'not-a-chart' },
      context({
        askJev: async () => ({
          answers: {
            chart: { type: 'choice', choice: 'bar-chart', confidence: 0.9 },
          },
        }),
      }),
    );
    expect(result.ok && result.awaitingUser).toBe(true);
    if (!result.ok || !result.awaitingUser) return;
    expect(result).not.toHaveProperty('spec');
    expect(result.suggestion).toBe('bar-chart');
    expect(result.message).toContain('not a chart I know');
    expect(result.message).toContain('Jev would draw bar-chart');
    expect(result.message).toContain('Nothing was generated');
  });

  it('does not draw when Jev selects a chart this workspace cannot draw', async () => {
    const result = await handleShowWorkspace(
      { intent: 'comparison', utterance: 'Show incidents on a map.' },
      context({
        profile: { ...profile, hasMapToken: false },
        askJev: async () => ({
          answers: {
            chart: { type: 'choice', choice: 'map-chart', confidence: 0.99 },
            named_chart: { type: 'noul', noul: 0.1 },
          },
        }),
      }),
    );
    expect(result.ok && result.awaitingUser).toBe(true);
    if (!result.ok || !result.awaitingUser) return;
    expect(result).not.toHaveProperty('spec');
    expect(result.suggestion).toBeUndefined();
    expect(result.message).toContain('Jev selected map-chart');
    expect(result.message).toContain('cannot draw');
    expect(result.message).toContain('Nothing was generated');
    expect(result.message).not.toContain("not Jev's");
    expect(result.message).not.toContain('Jev did not select');
  });

  it('recommends Jev when an undrawable named chart is outside Jev\'s class', async () => {
    const result = await handleShowWorkspace(
      { intent: 'spatial', utterance: 'Show a map.', requestedChart: 'map' },
      context({
        profile: { ...profile, hasMapToken: false },
        askJev: async () => ({
          answers: {
            chart: { type: 'choice', choice: 'bar-chart', confidence: 0.9 },
          },
        }),
      }),
    );
    expect(result.ok && result.awaitingUser).toBe(true);
    if (!result.ok || !result.awaitingUser) return;
    expect(result).not.toHaveProperty('spec');
    expect(result.suggestion).toBe('bar-chart');
    expect(result.message).toContain('Region id or lat/lng');
    expect(result.message).toContain('Jev would draw bar-chart');
    expect(result.message).toContain('Nothing was generated');
    expect(result.message).toContain('Say which of the two you want');
    expect(result.message).not.toContain('I am not switching');
  });

  it('argues an undrawable named chart that shares Jev\'s class', async () => {
    const result = await handleShowWorkspace(
      { intent: 'spatial', utterance: 'Show a map.', requestedChart: 'map' },
      context({
        profile: { ...profile, hasMapToken: false },
        askJev: async () => ({
          answers: {
            chart: { type: 'choice', choice: 'map-chart', confidence: 0.9 },
          },
        }),
      }),
    );
    expect(result.ok && result.awaitingUser).toBe(true);
    if (!result.ok || !result.awaitingUser) return;
    expect(result).not.toHaveProperty('spec');
    expect(result.suggestion).toBeUndefined();
    expect(result.message).toContain('Region id or lat/lng');
    expect(result.message).toContain('Jev selected map-chart');
    expect(result.message).toContain('cannot draw');
    expect(result.message).toContain('Nothing was generated');
    expect(result.message).not.toContain('I am not switching');
    expect(result.message).not.toContain('Jev would draw');
  });

  it('does not draw a named chart that the columns do not support', async () => {
    const result = await handleShowWorkspace(
      {
        intent: 'comparison',
        utterance: 'Show a sankey of team scores.',
        requestedChart: 'sankey',
        csv: 'team,score\nAlpha,10\nBeta,4\n',
      },
      context({
        askJev: async () => ({
          answers: {
            chart: { type: 'choice', choice: 'bar-chart', confidence: 0.9 },
          },
        }),
      }),
    );
    expect(result.ok && result.awaitingUser).toBe(true);
    if (!result.ok || !result.awaitingUser) return;
    expect(result).not.toHaveProperty('spec');
    expect(result.suggestion).toBe('bar-chart');
    expect(result.message).toContain('Source, target, and a value');
    expect(result.message).toContain('Jev would draw bar-chart');
    expect(result.message).not.toContain('A closer chart would be');
    expect(result.message.match(/Jev would draw/g)).toHaveLength(1);
  });
});
