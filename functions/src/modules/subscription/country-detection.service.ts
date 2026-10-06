import { Request } from "express";
import geoip from "geoip-lite";
import https from "https";
import { appConfig } from "../../config/app.config";
import { logger } from "../../shared/logger";

export interface DetectedGeoInfo {
  country: string;
  currency: "INR" | "USD";
  clientIp: string;
  source:
  | "cloudflare"
  | "appengine"
  | "geoip"
  | "localhost_public_ip"
  | "timezone"
  | "dev_override"
  | "fallback";
}

let cachedPublicIp: string | null = null;
let cachedPublicIpCountry: string | null = null;

/**
 * Periodically / lazily resolves the host machine's public IP address.
 * Useful for local developers running backend on localhost (::1 / 127.0.0.1)
 * so that their local requests geolocate to their real physical location (e.g. India).
 */
const refreshPublicIp = (): void => {
  try {
    const req = https.get(
      "https://api.ipify.org?format=json",
      { timeout: 3000 },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed?.ip) {
              cachedPublicIp = parsed.ip;
              const geo = geoip.lookup(parsed.ip);
              if (geo?.country) {
                cachedPublicIpCountry = geo.country.toUpperCase();
                logger.info("[CountryDetection] Resolved host public IP geo", {
                  publicIp: cachedPublicIp,
                  country: cachedPublicIpCountry,
                });
              }
            }
          } catch {
            // ignore JSON parse error
          }
        });
      }
    );
    req.on("error", () => { });
    req.on("timeout", () => req.destroy());
  } catch {
    // ignore network error
  }
};

// Prefetch host public IP on startup
refreshPublicIp();
// Refresh every 6 hours
setInterval(refreshPublicIp, 6 * 60 * 60 * 1000).unref();

/**
 * Extracts the real client IP address from the Express request.
 */
export const extractClientIp = (req: Request): string => {
  // 1. Check X-Forwarded-For (can be a comma-separated list of proxies)
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const rawIp = typeof forwarded === "string" ? forwarded : forwarded[0];
    const firstIp = rawIp.split(",")[0].trim();
    if (firstIp) return firstIp;
  }

  // 2. Check X-Real-IP
  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim()) {
    return realIp.trim();
  }

  // 3. Express req.ip (populated when trust proxy is active)
  if (req.ip) {
    return req.ip.replace(/^::ffff:/, "");
  }

  // 4. Socket remote address
  const socketIp = req.socket?.remoteAddress || "";
  return socketIp.replace(/^::ffff:/, "");
};

/**
 * Determines whether an IP is a local/private network address.
 */
export const isPrivateOrLocalIp = (ip: string): boolean => {
  if (!ip || ip === "::1" || ip === "127.0.0.1" || ip === "localhost") return true;
  if (ip.startsWith("10.") || ip.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return true;
  return false;
};

/**
 * Checks whether a timezone identifier corresponds to India (IST).
 */
const isIndianTimezone = (tz?: string): boolean => {
  if (!tz || typeof tz !== "string") return false;
  const lower = tz.trim().toLowerCase();
  return (
    lower === "asia/kolkata" ||
    lower === "asia/calcutta" ||
    lower.includes("kolkata") ||
    lower.includes("calcutta") ||
    lower === "ist"
  );
};

/**
 * Detects the user's country and corresponding payment currency.
 *
 * Rules:
 *  - India (IN) -> INR
 *  - Rest of the World (!= IN) -> USD
 *  - Undetected / Local / Fallback -> USD (safe international standard)
 */
export const detectPaymentCurrency = (req: Request): DetectedGeoInfo => {
  const clientIp = extractClientIp(req);
  const isLocal = isPrivateOrLocalIp(clientIp);

  // 1. Development / Localhost testing override (header or query param)
  if (appConfig.isDevelopment || isLocal) {
    const overrideCountry =
      (req.headers?.["x-override-country"] as string) ||
      (req.query?.testCountry as string) ||
      (req.query?.country as string);
    if (overrideCountry && typeof overrideCountry === "string") {
      const country = overrideCountry.trim().toUpperCase();
      const currency = country === "IN" ? "INR" : "USD";
      return {
        country,
        currency,
        clientIp,
        source: "dev_override",
      };
    }
  }

  // 2. Cloudflare Edge header (CF-IPCountry) — Available in production behind Cloudflare
  const cfCountry = req.headers["cf-ipcountry"];
  if (typeof cfCountry === "string" && cfCountry.trim() && cfCountry !== "XX" && cfCountry !== "T1") {
    const country = cfCountry.trim().toUpperCase();
    const currency = country === "IN" ? "INR" : "USD";
    return {
      country,
      currency,
      clientIp,
      source: "cloudflare",
    };
  }

  // 3. Google Cloud / App Engine / Cloud Functions edge header (X-Appengine-Country)
  const aeCountry = req.headers["x-appengine-country"];
  if (typeof aeCountry === "string" && aeCountry.trim() && aeCountry !== "ZZ") {
    const country = aeCountry.trim().toUpperCase();
    const currency = country === "IN" ? "INR" : "USD";
    return {
      country,
      currency,
      clientIp,
      source: "appengine",
    };
  }

  // 4. IP Geolocation lookup via geoip-lite for real public client IPs
  if (clientIp && !isLocal) {
    try {
      const geo = geoip.lookup(clientIp);
      if (geo?.country) {
        const country = geo.country.toUpperCase();
        const currency = country === "IN" ? "INR" : "USD";
        return {
          country,
          currency,
          clientIp,
          source: "geoip",
        };
      }
    } catch (err) {
      logger.warn("[CountryDetection] geoip-lite lookup failed", { clientIp, error: String(err) });
    }
  }

  // 5. Localhost / Private IP Resolution (e.g. testing locally from India on localhost:4200 / localhost:5000)
  if (isLocal) {
    // 5a. If the machine's external public IP is resolved, use its real geolocation
    if (cachedPublicIpCountry) {
      const currency = cachedPublicIpCountry === "IN" ? "INR" : "USD";
      return {
        country: cachedPublicIpCountry,
        currency,
        clientIp: cachedPublicIp || clientIp,
        source: "localhost_public_ip",
      };
    }

    // 5b. Client timezone header or query param from frontend
    const clientTz =
      (req.headers?.["x-client-timezone"] as string) ||
      (req.query?.tz as string);
    if (isIndianTimezone(clientTz)) {
      return {
        country: "IN",
        currency: "INR",
        clientIp,
        source: "timezone",
      };
    }

    // 5c. Server system timezone fallback
    try {
      const sysTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (isIndianTimezone(sysTz)) {
        return {
          country: "IN",
          currency: "INR",
          clientIp,
          source: "timezone",
        };
      }
    } catch {
      // ignore
    }
  }

  // 6. Safe Fallback: Default to USD
  return {
    country: "US",
    currency: "USD",
    clientIp,
    source: "fallback",
  };
};
