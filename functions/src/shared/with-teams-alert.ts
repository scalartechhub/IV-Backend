/**
 * with-teams-alert.ts
 *
 * Higher-order wrapper that runs a Firebase Function handler and sends a
 * Teams alert if it throws. Use this to wrap scheduled, trigger, and callable
 * function bodies.
 *
 * Usage (scheduled — no args):
 *   export const myFn = onSchedule(config, withTeamsAlert('myFn', async () => { ... }));
 *
 * Usage (trigger — receives event):
 *   export const myFn = onDocumentUpdated(config, withTeamsAlert('myFn', async (event) => { ... }));
 */

import * as teamsAlerter from './teams-alerter';
import { logger } from './logger';

/**
 * Wraps an async function handler so that any thrown error is:
 *  1. Logged via the shared logger
 *  2. Sent to Teams as an alert card
 *  3. Re-thrown so Firebase Functions marks the invocation as failed
 *
 * Generic over args (A) and return type (T) so it works with:
 *  - Scheduled handlers: `() => Promise<void>`
 *  - Trigger/callable handlers: `(event: SomeEvent) => Promise<void>`
 *
 * @param name  Human-readable function name shown in the Teams alert
 * @param fn    The async handler to wrap
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withTeamsAlert<A extends any[], T>(
  name: string,
  fn: (...args: A) => Promise<T>,
): (...args: A) => Promise<T> {
  return async (...args: A): Promise<T> => {
    try {
      return await fn(...args);
    } catch (error) {
      logger.error(`[withTeamsAlert] Function "${name}" threw an error`, error);

      // Fire-and-forget: alert should not block the re-throw
      void teamsAlerter.notify({
        context: `Firebase Function: ${name}`,
        error,
        extras: {
          'Function Type': 'Scheduled / Trigger / Callable',
        },
      });

      // Re-throw so Firebase marks the function invocation as failed
      // and retries are handled by Firebase's own retry policies
      throw error;
    }
  };
}
