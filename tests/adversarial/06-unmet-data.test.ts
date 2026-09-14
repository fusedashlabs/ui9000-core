import { describe, it } from 'vitest';

import { expectRefusal } from './harness.js';

describe('adversarial: 06-unmet-data', () => {
  it('refuses a spec that leaves a required data role unbound', () => {
    expectRefusal('06-unmet-data', 'unmet_data');
  });
});
