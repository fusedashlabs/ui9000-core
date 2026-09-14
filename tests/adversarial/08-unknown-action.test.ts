import { describe, it } from 'vitest';

import { expectRefusal } from './harness.js';

describe('adversarial: 08-unknown-action', () => {
  it('refuses an action outside hover|resize|select|submit|approve|reject', () => {
    expectRefusal('08-unknown-action', 'unknown_action');
  });
});
