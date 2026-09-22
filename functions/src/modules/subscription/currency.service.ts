/**
 * Currency service for live dynamic exchange rate conversion.
 * Caches exchange rates in-memory to prevent unnecessary API calls.
 */

import { logger } from "../../shared/logger";

interface ExchangeRateCache {
  inrPerUsd: number;
  lastFetchedAt: number;
}

// Fallback rate if external API is unreachable (user-verified baseline)
const FALLBACK_INR_PER_USD = 95.85;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

let cache: ExchangeRateCache | null = null;

export const getInrPerUsdRate = async (): Promise<number> => {
  const now = Date.now();

  if (cache && now - cache.lastFetchedAt < CACHE_TTL_MS) {
    return cache.inrPerUsd;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000); // 4s timeout

    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Exchange rate API returned status ${res.status}`);
    }

    const data = (await res.json()) as any;
    const inr = Number(data?.rates?.INR);

    if (inr && !isNaN(inr) && inr > 0) {
      cache = {
        inrPerUsd: Number(inr.toFixed(4)),
        lastFetchedAt: now,
      };
      logger.info("[currency-service] Updated live USD/INR exchange rate", { inrPerUsd: cache.inrPerUsd });
      return cache.inrPerUsd;
    }
  } catch (err: any) {
    logger.warn("[currency-service] Could not fetch live exchange rate, using fallback", {
      error: err.message,
      fallback: FALLBACK_INR_PER_USD,
    });
  }

  // If cache exists (even if older than TTL), use it before falling back to static constant
  if (cache) {
    return cache.inrPerUsd;
  }

  return FALLBACK_INR_PER_USD;
};

/**
 * Converts an INR amount to USD rounded to 2 decimal places.
 */
export const convertInrToUsd = (inrAmount: number, inrPerUsd: number): number => {
  if (!inrAmount || inrAmount <= 0) return 0;
  return Number((inrAmount / inrPerUsd).toFixed(2));
};
