import { describe, it } from 'vitest';

import { expectRefusal } from './harness.js';

describe('adversarial: 02-javascript-url', () => {
  it('refuses a javascript: URL smuggled into a prop', () => {
    expectRefusal('02-javascript-url', 'javascript_url');
  });
});
