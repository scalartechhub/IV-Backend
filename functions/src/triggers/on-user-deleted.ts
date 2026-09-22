/**
 * Trigger: When a user account is deleted from Firebase Authentication,
 * cascade delete all associated data across Firestore and Storage,
 * and cancel any active payment subscriptions.
 */

import * as functions from "firebase-functions/v1";
import { initializeFirebase, db } from "../config/firebase";
import { ensureAdmin, ensureStorage } from "../utils/callable-auth";
import { getRazorpay, isRazorpayConfigured } from "../config/razorpay";
import { COLLECTIONS } from "../shared/constants";
import { logger } from "../shared/logger";
import { withTeamsAlert } from "../shared/with-teams-alert";

export const onUserDeleted = functions
  .region("us-central1")
  .auth.user()
  .onDelete(
    withTeamsAlert("onUserDeleted", async (user) => {
      const uid = user.uid;
      const email = user.email;

      logger.info("[onUserDeleted] User deleted from Auth — starting cascade deletion", {
        uid,
        email,
      });

      // Ensure Firebase Admin & Firestore are properly initialized
      try {
        initializeFirebase();
      } catch (initErr: any) {
        logger.warn("[onUserDeleted] Note on initializeFirebase:", { error: initErr.message });
      }

      const firestore = db || ensureAdmin();

      // 1. Delete user document and all subcollections recursively
      try {
        const userRef = firestore.collection(COLLECTIONS.USERS).doc(uid);
        await firestore.recursiveDelete(userRef);
        logger.info("[onUserDeleted] Deleted user doc and all subcollections", { uid });
      } catch (err: any) {
        logger.error("[onUserDeleted] Error deleting user doc", { uid, error: err.message });
      }

      // 2. Delete all interviews belonging to the user (and their subcollections)
      try {
        const interviewsSnap = await firestore
          .collection(COLLECTIONS.INTERVIEWS)
          .where("userId", "==", uid)
          .get();

        for (const doc of interviewsSnap.docs) {
          await firestore.recursiveDelete(doc.ref);
        }
        logger.info("[onUserDeleted] Deleted user interviews", {
          uid,
          count: interviewsSnap.size,
        });
      } catch (err: any) {
        logger.error("[onUserDeleted] Error deleting interviews", { uid, error: err.message });
      }

      // 3. Cancel active Razorpay subscriptions and delete subscription docs
      try {
        const subsSnap = await firestore
          .collection(COLLECTIONS.SUBSCRIPTIONS)
          .where("userId", "==", uid)
          .get();

        const razorpay = isRazorpayConfigured() ? getRazorpay() : null;

        for (const doc of subsSnap.docs) {
          const subData = doc.data();
          if (
            razorpay &&
            subData?.razorpaySubscriptionId &&
            subData?.status === "active"
          ) {
            try {
              await (razorpay.subscriptions as any).cancel(
                subData.razorpaySubscriptionId,
                false
              );
              logger.info("[onUserDeleted] Cancelled Razorpay subscription", {
                uid,
                subId: subData.razorpaySubscriptionId,
              });
            } catch (cancelErr: any) {
              logger.warn("[onUserDeleted] Note: Could not cancel Razorpay subscription", {
                uid,
                subId: subData.razorpaySubscriptionId,
                error: cancelErr.message,
              });
            }
          }
          await doc.ref.delete();
        }
        logger.info("[onUserDeleted] Deleted subscription records", {
          uid,
          count: subsSnap.size,
        });
      } catch (err: any) {
        logger.error("[onUserDeleted] Error processing subscriptions", { uid, error: err.message });
      }

      // 4. Delete payment history records
      try {
        const paymentsSnap = await firestore
          .collection(COLLECTIONS.PAYMENTS)
          .where("userId", "==", uid)
          .get();

        if (!paymentsSnap.empty) {
          const batch = firestore.batch();
          paymentsSnap.docs.forEach((doc) => batch.delete(doc.ref));
          await batch.commit();
        }
        logger.info("[onUserDeleted] Deleted payment records", {
          uid,
          count: paymentsSnap.size,
        });
      } catch (err: any) {
        logger.error("[onUserDeleted] Error deleting payments", { uid, error: err.message });
      }

      // 5. Delete candidate invitations
      try {
        const invitesSnap = await firestore
          .collection("interview_invitations")
          .where("candidateUid", "==", uid)
          .get();

        if (!invitesSnap.empty) {
          const batch = firestore.batch();
          invitesSnap.docs.forEach((doc) => batch.delete(doc.ref));
          await batch.commit();
        }
      } catch (err: any) {
        logger.warn("[onUserDeleted] Note: Error cleaning interview_invitations", {
          uid,
          error: err.message,
        });
      }

      // 6. Delete user notifications
      try {
        const notifsSnap = await firestore
          .collection(COLLECTIONS.NOTIFICATIONS)
          .where("userId", "==", uid)
          .get();

        if (!notifsSnap.empty) {
          const batch = firestore.batch();
          notifsSnap.docs.forEach((doc) => batch.delete(doc.ref));
          await batch.commit();
        }
      } catch (err: any) {
        logger.warn("[onUserDeleted] Note: Error cleaning notifications", {
          uid,
          error: err.message,
        });
      }

      // 7. Delete Storage files (resumes, audio recordings, profile photos)
      try {
        const storage = ensureStorage();
        const bucket = storage.bucket();
        await Promise.allSettled([
          bucket.deleteFiles({ prefix: `users/${uid}/`, force: true }),
          bucket.deleteFiles({ prefix: `resumes/${uid}/`, force: true }),
          bucket.deleteFiles({ prefix: `interviews/${uid}/`, force: true }),
        ]);
        logger.info("[onUserDeleted] Cleaned up user files from Storage", { uid });
      } catch (err: any) {
        logger.warn("[onUserDeleted] Note: Error cleaning Storage files", {
          uid,
          error: err.message,
        });
      }

      logger.info("[onUserDeleted] Cascade deletion completed successfully", { uid });
    })
  );
