import { describe, expect, it } from 'vitest';
import { DATA_PROFILE_KEYS, INTENTS } from '../index.js';

describe('closed Stage 3 contracts', () => {
  it('freezes DataProfile keys', () => {
    expect([...DATA_PROFILE_KEYS]).toEqual([
      'hasCategory',
      'hasNumericMetric',
      'categoryCardinality',
      'hasGeo',
      'hasTemporal',
      'hasNodes',
      'hasLinks',
      'hasTabularRows',
      'rowCount',
      'hasEntityId',
      'hasClaim',
      'hasEvents',
      'controlCount',
      'allControlsLabelled',
      'hasMapToken',
    ]);
  });

  it('freezes intents', () => {
    expect([...INTENTS]).toEqual([
      'spatial',
      'comparison',
      'summary',
      'form',
      'evidence',
      'graph',
    ]);
  });
});
