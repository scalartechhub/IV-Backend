/**
 * V2 profile / settings service.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { AppError } from '../shared/utils';
import { ensureAdmin } from '../utils/callable-auth';
import { userRef } from '../utils/firestore-refs';
import { ensureUserDefaults } from './schema-defaults';

export interface SaveProfileSettingsInput {
  profile?: {
    currentRole?: string;
    yearsExperience?: number;
    targetRole?: string;
    targetCompanies?: string[];
    location?: string;
  };
  preferences?: {
    dailyReminders?: boolean;
    aiVoiceFeedback?: boolean;
    focusMode?: boolean;
    weeklyProgressEmail?: boolean;
    darkMode?: boolean;
  };
  displayName?: string;
}

export async function saveProfileSettings(
  uid: string,
  input: SaveProfileSettingsInput,
): Promise<{ ok: true }> {
  const db = ensureAdmin();
  const { profile, preferences, displayName } = input;

  if (!profile && !preferences && !displayName) {
    throw new AppError(
      400,
      'Provide profile, preferences, and/or displayName.',
    );
  }

  const updates: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (displayName !== undefined) updates.displayName = displayName;
  if (profile) {
    for (const [key, value] of Object.entries(profile)) {
      if (value !== undefined) updates[`profile.${key}`] = value;
    }
  }
  if (preferences) {
    for (const [key, value] of Object.entries(preferences)) {
      if (value !== undefined) updates[`preferences.${key}`] = value;
    }
  }

  for (const key of Object.keys(updates)) {
    if (key.startsWith('gamification') || key.startsWith('readiness')) {
      throw new AppError(
        403,
        'gamification and readiness are server-writable only.',
      );
    }
  }

  const ref = userRef(db, uid);
  const snap = await ref.get();
  if (!snap.exists) throw new AppError(404, 'User not found.');

  await ref.update(updates);
  return { ok: true };
}

export async function getProfile(uid: string) {
  const db = ensureAdmin();
  await ensureUserDefaults(db, uid);
  const snap = await userRef(db, uid).get();
  if (!snap.exists) throw new AppError(404, 'User not found.');
  return { id: snap.id, ...snap.data()! };
}
