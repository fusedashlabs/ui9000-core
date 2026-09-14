import { describe, it } from 'vitest';

import { expectRefusal } from './harness.js';

describe('adversarial: 09-unnamed-tool', () => {
  it('refuses a tool declared without a name', () => {
    expectRefusal('09-unnamed-tool', 'unnamed_tool');
  });
});
