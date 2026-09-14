import { describe, it } from 'vitest';

import { expectRefusal } from './harness.js';

describe('adversarial: 01-unknown-component', () => {
  it('refuses a component that is not in the engine catalog', () => {
    expectRefusal('01-unknown-component', 'unknown_component');
  });
});
