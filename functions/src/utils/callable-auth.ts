import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

/** Ensure Admin SDK is initialized once per cold start. */
export function ensureAdmin(): Firestore {
  if (getApps().length === 0) {
    initializeApp();
  }
  return getFirestore();
}

export function ensureStorage() {
  if (getApps().length === 0) {
    initializeApp();
  }
  return getStorage();
}

/** Require authenticated callable context; return uid. */
export function requireAuth(request: CallableRequest<unknown>): string {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }
  return request.auth.uid;
}
