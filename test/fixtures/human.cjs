'use strict';
/**
 * A trusted human context in the exact shape main's identity service resolves for a human-facing IPC event
 * (see src/main/humanIdentity.ts). v0.15: a human decision is a verified event with its owner, so the runtime
 * refuses decide / confirm / cancel / complete without one — direct runtime calls in tests pass this.
 */
const TRUSTED_HUMAN = Object.freeze({
  human: Object.freeze({ id: 'hum-test0123456789', displayName: 'Test Human' }),
  session: 'ses-test01234567',
  window: 1
});
module.exports = { TRUSTED_HUMAN };
