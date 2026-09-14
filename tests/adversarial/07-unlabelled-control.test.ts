import { describe, it } from 'vitest';

import { expectRefusal } from './harness.js';

describe('adversarial: 07-unlabelled-control', () => {
  it('refuses a control whose placeholder stands in for a label', () => {
    expectRefusal('07-unlabelled-control', 'unlabelled_control');
  });
});
