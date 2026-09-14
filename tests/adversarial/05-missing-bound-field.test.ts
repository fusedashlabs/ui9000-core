import { describe, it } from 'vitest';

import { expectRefusal } from './harness.js';

describe('adversarial: 05-missing-bound-field', () => {
  it('refuses a bind to a column that is not declared', () => {
    expectRefusal('05-missing-bound-field', 'missing_bound_field');
  });
});
