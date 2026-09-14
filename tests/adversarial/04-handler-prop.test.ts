import { describe, it } from 'vitest';

import { expectRefusal, expectSpecRefusal, hostileSpec } from './harness.js';

describe('adversarial: 04-handler-prop', () => {
  it('refuses an onClick prop carrying script source', () => {
    expectRefusal('04-handler-prop', 'handler_prop');
  });

  it('refuses a live function on a prop', () => {
    // JSON cannot carry a function, so the other half of the case is built here:
    // a spec that arrives over an in-process channel rather than the wire.
    const spec = hostileSpec('04-handler-prop') as { props: Record<string, unknown> };
    delete spec.props.onClick;
    spec.props.label = () => 'Approve';

    expectSpecRefusal(spec, 'handler_prop');
  });
});
