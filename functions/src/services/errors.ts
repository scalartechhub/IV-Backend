/**
 * Map AppError (Express) → HttpsError (callables).
 */

import { HttpsError } from 'firebase-functions/v2/https';
import { AppError } from '../shared/utils';

export function toHttpsError(error: unknown): HttpsError {
  if (error instanceof HttpsError) return error;
  if (error instanceof AppError) {
    const code =
      error.statusCode === 400
        ? 'invalid-argument'
        : error.statusCode === 401
          ? 'unauthenticated'
          : error.statusCode === 403
            ? 'permission-denied'
            : error.statusCode === 404
              ? 'not-found'
              : error.statusCode === 409 || error.statusCode === 412
                ? 'failed-precondition'
                : 'internal';
    return new HttpsError(code, error.message);
  }
  const message = error instanceof Error ? error.message : 'Internal error';
  return new HttpsError('internal', message);
}
