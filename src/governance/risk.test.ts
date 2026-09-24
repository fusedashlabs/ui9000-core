import { describe, expect, it } from 'vitest';

import {
  classifyActions,
  classifyCatalogActions,
  type ClassifiedAction,
} from './risk.js';

describe('risk table', () => {
  it('marks hover low and approve / submit held', () => {
    const rows = classifyActions(['hover', 'approve', 'submit']);
    expect(rows.map((row) => row.band)).toEqual(['low', 'held', 'held']);
    expect(rows[0]).toMatchObject({
      action: 'hover',
      effect: 'observe',
      reversibility: 'reversible',
      scope: 'view',
    });
    expect(rows[1]).toMatchObject({
      action: 'approve',
      effect: 'commit',
      reversibility: 'irreversible',
      scope: 'record',
    });
  });

  it('keeps the closed low and held sets', () => {
    expect(bands(['hover', 'resize', 'pan', 'zoom'])).toEqual(['low', 'low', 'low', 'low']);
    expect(bands(['submit', 'approve', 'reject', 'filter', 'drag'])).toEqual([
      'held',
      'held',
      'held',
      'held',
      'held',
    ]);
  });

  it('does not let a hostile spec lower the band', () => {
    const hostile = { risk: 'low', allowedActions: ['hover'] };
    const catalogActions = ['approve', 'submit'];

    const classified = classifyCatalogActions(catalogActions, hostile);

    expect(classified.map((row) => row.band)).toEqual(['held', 'held']);
    expect(classified).not.toEqual(classifyActions(hostile.allowedActions));
    expect(hostile.risk).toBe('low');
  });

  it('does not let a spec raise a low action to held', () => {
    const hostile = { risk: 'held', allowedActions: ['approve'] };
    expect(classifyCatalogActions(['hover'], hostile)[0]?.band).toBe('low');
  });

  it('holds an action the table does not name', () => {
    expect(classifyActions(['select', 'scroll', 'download'])).toEqual([
      unlisted('select'),
      unlisted('scroll'),
      unlisted('download'),
    ]);
  });

  it('ignores the spec entirely when the catalog list is missing', () => {
    const hostile = { risk: 'low', allowedActions: ['approve'] };
    expect(classifyCatalogActions(undefined, hostile)).toEqual([]);
  });
});

function bands(actions: readonly string[]): string[] {
  return classifyActions(actions).map((row) => row.band);
}

function unlisted(action: string): ClassifiedAction {
  return {
    action,
    effect: 'unlisted',
    reversibility: 'irreversible',
    scope: 'unknown',
    band: 'held',
  };
}
