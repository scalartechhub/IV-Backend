/**
 * Geographic calculation utilities using Haversine formula.
 */

const EARTH_RADIUS_KM = 6371;

/**
 * Calculates great-circle distance between two GPS coordinates using Haversine formula.
 * @returns Distance in kilometers, rounded to 2 decimal places.
 */
export function calculateDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  if (lat1 === lat2 && lon1 === lon2) {
    return 0;
  }

  const toRad = (degree: number) => (degree * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const lat1Rad = toRad(lat1);
  const lat2Rad = toRad(lat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = EARTH_RADIUS_KM * c;

  return Math.round(distance * 100) / 100;
}

/**
 * Checks if two coordinate pairs are within a given proximity threshold (in meters).
 */
export function areLocationsClose(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  thresholdMeters = 100
): boolean {
  const distanceKm = calculateDistanceKm(lat1, lon1, lat2, lon2);
  return distanceKm * 1000 <= thresholdMeters;
}
