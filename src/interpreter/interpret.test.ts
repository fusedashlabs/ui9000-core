import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import type { EngineCatalog } from '../spec/engine-catalog.js';
import { VALIDATION_CODES } from '../validate/validate-spec.js';
import { interpretWorkspace } from './interpret.js';

const catalog: EngineCatalog = [
  {
    id: 'bar-chart',
    intents: ['comparison'],
    dataRoles: [
      { id: 'category', required: true },
      { id: 'metric', required: true },
    ],
    allowedActions: ['hover', 'resize'],
  },
  {
    id: 'text-input',
    intents: ['form'],
    allowedActions: ['resize'],
    accessibility: { nameFrom: 'label' },
  },
];

const validBar = {
  component: 'bar-chart',
  fields: ['severity', 'count'],
  binds: { category: 'severity', metric: 'count' },
  allowedActions: ['hover', 'resize'],
};

const hostile: Record<(typeof VALIDATION_CODES)[number], unknown> = {
  unknown_component: { component: 'pie-chart' },
  javascript_url: { ...validBar, props: { href: 'javascript:alert(1)' } },
  data_url: { ...validBar, props: { src: 'data:text/html,hi' } },
  handler_prop: { ...validBar, props: { onClick: 'noop' } },
  missing_bound_field: {
    component: 'bar-chart',
    fields: ['severity', 'count'],
    binds: { category: 'no_such_column', metric: 'count' },
  },
  unmet_data: {
    component: 'bar-chart',
    fields: ['severity'],
    binds: { category: 'severity' },
  },
  unlabelled_control: { component: 'text-input', props: { name: 'assignee' } },
  unknown_action: { ...validBar, allowedActions: ['hover', 'explode'] },
  unnamed_tool: { ...validBar, tools: [{ id: 'refresh' }] },
};

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'interpret.ts'), 'utf8');

describe('interpretWorkspace', () => {
  it('does not write host markup or define elements', () => {
    expect(source.includes('innerHTML')).toBe(false);
    expect(source.includes('customElements')).toBe(false);
  });

  it('mounts a valid bar-chart from a show_workspace tool result', async () => {
    const mount = vi.fn();
    const load = vi.fn(async (id: string) => (id === 'bar-chart' ? { mount } : undefined));
    const host = { replaceChildren: vi.fn() };

    const result = await interpretWorkspace(
      { spec: validBar, summary: 'bar-chart for comparison' },
      catalog,
      load,
      host,
    );

    expect(result).toMatchObject({ mounted: true, spec: { component: 'bar-chart' } });
    expect(load).toHaveBeenCalledWith('bar-chart');
    expect(host.replaceChildren).toHaveBeenCalledTimes(1);
    expect(mount).toHaveBeenCalledWith(host, expect.objectContaining({ component: 'bar-chart' }));
  });

  it('refuses all nine hostile specs without loading or mounting', async () => {
    for (const code of VALIDATION_CODES) {
      const load = vi.fn();
      const host = { replaceChildren: vi.fn() };
      const result = await interpretWorkspace({ spec: hostile[code] }, catalog, load, host);
      expect(result).toMatchObject({ mounted: false, code });
      expect(load).not.toHaveBeenCalled();
      expect(host.replaceChildren).not.toHaveBeenCalled();
    }
  });

  it('does not mount when the catalog loader has no entry', async () => {
    const load = vi.fn(async () => undefined);
    const host = { replaceChildren: vi.fn() };
    const result = await interpretWorkspace({ spec: validBar }, catalog, load, host);
    expect(result).toMatchObject({ mounted: false, code: 'unknown_component' });
    expect(load).toHaveBeenCalledWith('bar-chart');
    expect(host.replaceChildren).not.toHaveBeenCalled();
  });
});
