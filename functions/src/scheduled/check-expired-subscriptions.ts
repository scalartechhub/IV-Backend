/**
 * Scheduled Cron Function: Runs every 6 hours to check for expired Razorpay subscriptions.
 * Validates subscriptions against Razorpay API or local end dates and downgrades
 * expired memberships back to the Free tier.
 */


import { onSchedule } from 'firebase-functions/v2/scheduler';
import { ensureAdmin } from '../utils/callable-auth';
import { getCurrentSubscription } from '../modules/subscription/razorpay-subscription.service';
import { withTeamsAlert } from '../shared/with-teams-alert';
import { logger } from '../shared/logger';

export const checkExpiredSubscriptions = onSchedule(
  {
    schedule: 'every 6 hours',
    timeZone: 'UTC',
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 300,
  },
  withTeamsAlert('checkExpiredSubscriptions', async () => {
    const db = ensureAdmin();
    const nowMs = Date.now();

    // Query users with a Razorpay provider
    const snap = await db
      .collection('users')
      .where('subscriptionSummary.provider', '==', 'razorpay')
      .limit(200)
      .get();

    if (snap.empty) {
      logger.info('[checkExpiredSubscriptions] No Razorpay users found to check');
      return;
    }

    let checkedCount = 0;
    let downgradedCount = 0;

    for (const doc of snap.docs) {
      const data = doc.data();
      const summary = data.subscriptionSummary;
      if (!summary || !summary.currentPeriodEnd) continue;

      const periodEndMs = new Date(summary.currentPeriodEnd).getTime();
      if (!isNaN(periodEndMs) && periodEndMs < nowMs) {
        checkedCount++;
        try {
          const result = await getCurrentSubscription(doc.id);
          if (result.planId === 'free') {
            downgradedCount++;
          }
        } catch (err: any) {
          logger.error('[checkExpiredSubscriptions] Failed checking subscription for user', {
            uid: doc.id,
            error: err.message,
          });
        }
      }
    }

    logger.info('[checkExpiredSubscriptions] Run complete', {
      totalFound: snap.size,
      expiredChecked: checkedCount,
      downgradedToFree: downgradedCount,
    });
  }),
);
