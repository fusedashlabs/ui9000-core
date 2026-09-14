import { describe, it } from 'vitest';

import { expectRefusal } from './harness.js';

describe('adversarial: 03-data-url', () => {
  it('refuses a data: URL carrying inline markup', () => {
    expectRefusal('03-data-url', 'data_url');
  });
});
