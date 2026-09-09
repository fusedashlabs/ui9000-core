import { describe, expect, it } from 'vitest';

import type { EngineCatalog } from '../spec/engine-catalog.js';
import { validateSpec } from './validate-spec.js';

const catalog: EngineCatalog = [
  {
    id: 'bar-chart',
    intents: ['comparison'],
    dataRoles: [
      { id: 'category', required: true },
      { id: 'metric', required: true },
    ],
    allowedActions: ['hover', 'resize'],
    accessibility: { nameFrom: 'title or xLabel' },
  },
  {
    id: 'text-input',
    intents: ['form'],
    dataRoles: [{ id: 'value', required: false }],
    allowedActions: ['resize'],
    accessibility: { nameFrom: 'label' },
  },
  {
    id: 'form',
    intents: ['form'],
    dataRoles: [{ id: 'fields', required: true }],
    allowedActions: ['submit'],
    accessibility: { nameFrom: 'form label' },
  },
  {
    id: 'map-chart',
    intents: ['spatial'],
    dataRoles: [{ id: 'geo', required: true }],
    allowedActions: ['hover', 'pan', 'zoom', 'resize'],
    accessibility: { nameFrom: 'title' },
  },
];

const validBar = {
  component: 'bar-chart',
  fields: ['severity', 'count'],
  binds: { category: 'severity', metric: 'count' },
  props: { title: 'Severity' },
  allowedActions: ['hover', 'resize'],
};

describe('validateSpec', () => {
  it('accepts a bound bar-chart with no rows', () => {
    const result = validateSpec(validBar, catalog);
    expect(result).toEqual({ ok: true, spec: validBar });
  });

  it('accepts a labelled control', () => {
    const spec = { component: 'text-input', props: { label: 'Assignee', name: 'assignee' } };
    expect(validateSpec(spec, catalog).ok).toBe(true);
  });

  it('accepts a labelled form with labelled fields', () => {
    const spec = {
      component: 'form',
      props: {
        label: 'Intake',
        fields: [{ name: 'assignee', label: 'Assignee' }],
      },
    };
    expect(validateSpec(spec, catalog).ok).toBe(true);
  });

  it('refuses an unknown component', () => {
    const result = validateSpec({ component: 'pie-chart' }, catalog);
    expect(result).toMatchObject({ ok: false, code: 'unknown_component' });
  });

  it('refuses a javascript: URL anywhere on the spec', () => {
    const result = validateSpec(
      { ...validBar, props: { href: 'javascript:alert(1)' } },
      catalog,
    );
    expect(result).toMatchObject({ ok: false, code: 'javascript_url' });
  });

  it('refuses a data: URL anywhere on the spec', () => {
    const result = validateSpec(
      { ...validBar, props: { src: 'data:text/html,hi' } },
      catalog,
    );
    expect(result).toMatchObject({ ok: false, code: 'data_url' });
  });

  it('refuses onClick and function props', () => {
    const click = validateSpec({ ...validBar, props: { onClick: 'noop' } }, catalog);
    expect(click).toMatchObject({ ok: false, code: 'handler_prop' });

    const fn = validateSpec({ ...validBar, props: { title: () => 'x' } }, catalog);
    expect(fn).toMatchObject({ ok: false, code: 'handler_prop' });
  });

  it('refuses a bind to a field that is not declared', () => {
    const result = validateSpec(
      {
        component: 'bar-chart',
        fields: ['severity', 'count'],
        binds: { category: 'no_such_column', metric: 'count' },
      },
      catalog,
    );
    expect(result).toMatchObject({ ok: false, code: 'missing_bound_field' });
  });

  it('refuses when a required data role is not bound', () => {
    const result = validateSpec(
      { component: 'bar-chart', fields: ['severity'], binds: { category: 'severity' } },
      catalog,
    );
    expect(result).toMatchObject({ ok: false, code: 'unmet_data' });
  });

  it('refuses data rows on the spec', () => {
    const result = validateSpec(
      {
        ...validBar,
        props: { data: [{ label: 'high', value: 3 }] },
      },
      catalog,
    );
    expect(result).toMatchObject({ ok: false, code: 'unmet_data' });
  });

  it('refuses an unlabelled control', () => {
    const result = validateSpec({ component: 'text-input', props: { name: 'assignee' } }, catalog);
    expect(result).toMatchObject({ ok: false, code: 'unlabelled_control' });
  });

  it('refuses an action outside the closed set', () => {
    const result = validateSpec({ ...validBar, allowedActions: ['hover', 'explode'] }, catalog);
    expect(result).toMatchObject({ ok: false, code: 'unknown_action' });
  });

  it('refuses a tool without a name', () => {
    const result = validateSpec({ ...validBar, tools: [{ id: 'refresh' }] }, catalog);
    expect(result).toMatchObject({ ok: false, code: 'unnamed_tool' });
  });

  it('does not pass a hostile spec with a warning', () => {
    const result = validateSpec({ component: 'custom-widget', props: { onClick: 'x' } }, catalog);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBeTruthy();
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it('refuses javascript: and data: schemes wrapped in url()', () => {
    const js = validateSpec({ ...validBar, props: { fill: 'url(javascript:alert(1))' } }, catalog);
    expect(js).toMatchObject({ ok: false, code: 'javascript_url' });

    const data = validateSpec(
      { ...validBar, props: { fill: 'url(data:text/html,hi)' } },
      catalog,
    );
    expect(data).toMatchObject({ ok: false, code: 'data_url' });
  });

  it('does not treat prose "data:" as a data URL', () => {
    const result = validateSpec(
      { ...validBar, props: { title: 'Compare data: production vs staging' } },
      catalog,
    );
    expect(result.ok).toBe(true);
  });

  it('refuses a hostile child even when the parent is valid', () => {
    const result = validateSpec(
      {
        component: 'form',
        props: { label: 'Intake' },
        children: [{ component: 'text-input', props: { href: 'javascript:alert(1)' } }],
      },
      catalog,
    );
    expect(result).toMatchObject({ ok: false, code: 'javascript_url' });
  });

  it('refuses binds when no fields list is declared', () => {
    const result = validateSpec(
      { component: 'bar-chart', binds: { category: 'severity', metric: 'count' } },
      catalog,
    );
    expect(result).toMatchObject({ ok: false, code: 'missing_bound_field' });
  });

  it('refuses innerHTML and html props', () => {
    const html = validateSpec({ ...validBar, props: { innerHTML: '<img>' } }, catalog);
    expect(html).toMatchObject({ ok: false, code: 'handler_prop' });

    const markup = validateSpec({ ...validBar, props: { html: '<b>x</b>' } }, catalog);
    expect(markup).toMatchObject({ ok: false, code: 'handler_prop' });
  });

  it('refuses catalog-only actions such as pan even when metadata lists them', () => {
    const result = validateSpec(
      {
        component: 'map-chart',
        fields: ['country'],
        binds: { geo: 'country' },
        allowedActions: ['hover', 'pan'],
      },
      catalog,
    );
    expect(result).toMatchObject({ ok: false, code: 'unknown_action' });
  });

  it('refuses a closed action that the catalog entry does not allow', () => {
    const result = validateSpec(
      {
        component: 'map-chart',
        fields: ['country'],
        binds: { geo: 'country' },
        allowedActions: ['hover', 'select'],
      },
      catalog,
    );
    expect(result).toMatchObject({ ok: false, code: 'unknown_action' });
  });

  it('accepts a map-chart with closed actions only', () => {
    const spec = {
      component: 'map-chart',
      fields: ['country'],
      binds: { geo: 'country' },
      allowedActions: ['hover', 'resize'],
    };
    expect(validateSpec(spec, catalog).ok).toBe(true);
  });

  it('refuses a mixed fields+rows payload', () => {
    const result = validateSpec(
      {
        ...validBar,
        props: {
          data: [
            { name: 'severity', label: 'Severity' },
            { label: 'high', value: 3 },
          ],
        },
      },
      catalog,
    );
    expect(result).toMatchObject({ ok: false, code: 'unmet_data' });
  });

  it('refuses vbscript: as javascript_url and blob: as data_url', () => {
    const vbs = validateSpec({ ...validBar, props: { href: 'vbscript:msgbox(1)' } }, catalog);
    expect(vbs).toMatchObject({ ok: false, code: 'javascript_url' });

    const blob = validateSpec({ ...validBar, props: { src: 'blob:https://h/1' } }, catalog);
    expect(blob).toMatchObject({ ok: false, code: 'data_url' });
  });

  it('refuses row-shaped points and series on props', () => {
    const points = validateSpec(
      { ...validBar, props: { points: [{ x: 'a', y: 1 }] } },
      catalog,
    );
    expect(points).toMatchObject({ ok: false, code: 'unmet_data' });

    const series = validateSpec(
      { ...validBar, props: { series: [{ id: 's', points: [{ x: 'a', y: 1 }] }] } },
      catalog,
    );
    expect(series).toMatchObject({ ok: false, code: 'unmet_data' });
  });
});
