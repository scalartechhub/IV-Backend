/**
 * Subscription authorization middleware.
 * Use as Express middleware to protect routes that require a paid subscription
 * or specific plan features.
 */

import { Request, Response, NextFunction } from "express";
import { db } from "../config/firebase";
import { PLAN_IDS, PLAN_FEATURES, type BillingPlanId, type PlanFeatureKey } from "../constants/payment.constants";
import { COLLECTIONS } from "../shared/constants";
import { AppError } from "../shared/utils";
import { resolveEffectivePlanTier } from "../modules/subscription/feature-access.service";

const usersCol = () => db.collection(COLLECTIONS.USERS);

/**
 * Middleware factory: requires user to have at minimum the specified plan tier.
 * Usage: `router.post('/start', requireSubscription('pro'), handler)`
 *
 * Pass no argument to require any active subscription (including free).
 */
export const requireSubscription = (minimumPlan?: BillingPlanId) => {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = req.user?.uid;
      if (!uid) {
        next(new AppError(401, "Authentication required."));
        return;
      }

      const userDoc = await usersCol().doc(uid).get();
      const tier = resolveEffectivePlanTier(userDoc.data() || {});

      if (!minimumPlan) {
        next();
        return;
      }

      const tierRank: Record<string, number> = {
        [PLAN_IDS.FREE]: 0,
        [PLAN_IDS.PRO]: 1,
        [PLAN_IDS.ELITE]: 2,
        [PLAN_IDS.ENTERPRISE]: 2,
      };

      const userRank = tierRank[tier] ?? 0;
      const requiredRank = tierRank[minimumPlan] ?? 0;

      if (userRank < requiredRank) {
        next(
          new AppError(
            403,
            `This feature requires the ${minimumPlan.charAt(0).toUpperCase() + minimumPlan.slice(1)} plan or above. Please upgrade.`
          )
        );
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
};

/**
 * Middleware factory: requires a specific plan feature to be enabled.
 * Usage: `router.post('/company-prep', requireFeature('companyPreparation'), handler)`
 */
export const requireFeature = (feature: PlanFeatureKey) => {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const uid = req.user?.uid;
      if (!uid) {
        next(new AppError(401, "Authentication required."));
        return;
      }

      const userDoc = await usersCol().doc(uid).get();
      const tier = resolveEffectivePlanTier(userDoc.data() || {});
      const features = PLAN_FEATURES[tier as keyof typeof PLAN_FEATURES] || PLAN_FEATURES[PLAN_IDS.FREE];

      const featureValue = features[feature];

      if (featureValue === false) {
        next(
          new AppError(403, "This feature is not available on your current plan. Please upgrade to access it.")
        );
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
};
