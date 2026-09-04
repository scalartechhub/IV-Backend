/**
 * Resilient HTTP client for Geoapify Places & Geocoding APIs using Node 22 global fetch.
 */

import { appConfig } from '../../config/app.config';
import { logger } from '../../shared/logger';
import type {
  GeoapifyGeocodeResponse,
  GeoapifyGeocodeResult,
  GeoapifyPlaceProperties,
  GeoapifyPlacesResponse,
} from './companies.types';

const GEOAPIFY_BASE_URL = 'https://api.geoapify.com';
const TIMEOUT_MS = 8000;

export class GeoapifyClient {
  private getApiKey(): string {
    const key = appConfig.geoapifyApiKey || process.env.GEOAPIFY_API_KEY || '';
    if (!key) {
      logger.warn('[geoapify-client] GEOAPIFY_API_KEY is not configured in appConfig or environment');
    }
    return key.trim();
  }

  /**
   * Geocodes a text location (city, neighborhood, postal code) to coordinates.
   */
  async geocodeText(query: string): Promise<GeoapifyGeocodeResult | null> {
    const apiKey = this.getApiKey();
    if (!apiKey || !query?.trim()) return null;

    const url = new URL(`${GEOAPIFY_BASE_URL}/v1/geocode/search`);
    url.searchParams.set('text', query.trim());
    url.searchParams.set('limit', '1');
    url.searchParams.set('apiKey', apiKey);

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!response.ok) {
        logger.warn('[geoapify-client] Geocoding request failed', {
          status: response.status,
          statusText: response.statusText,
          query,
        });
        return null;
      }

      const data = (await response.json()) as GeoapifyGeocodeResponse;
      const feature = data.features?.[0];
      if (!feature) return null;

      const props = feature.properties;
      const coords = feature.geometry?.coordinates;
      const lon = coords?.[0] ?? props?.lon;
      const lat = coords?.[1] ?? props?.lat;

      if (lat === undefined || lon === undefined) return null;

      return {
        lat,
        lon,
        formatted: props?.formatted || query,
        city: props?.city,
        state: props?.state,
        country: props?.country,
      };
    } catch (err) {
      logger.warn('[geoapify-client] Geocoding request error', { err, query });
      return null;
    }
  }

  /**
   * Queries nearby commercial places / corporate offices from Geoapify Places API.
   * Geoapify circle filter format: circle:longitude,latitude,radius_in_meters
   */
  async fetchNearbyPlaces(params: {
    lat: number;
    lon: number;
    radiusMeters: number;
    categories: string[];
    limit?: number;
  }): Promise<GeoapifyPlaceProperties[]> {
    const apiKey = this.getApiKey();
    if (!apiKey) return [];

    const { lat, lon, radiusMeters, categories, limit = 50 } = params;
    const INVALID_CATEGORIES = new Set([
      'service.company',
      'commercial.workplace',
      'commercial.office',
      'commercial.industrial',
      'office.ngo',
    ]);
    const validCategories = categories.filter((c) => c && !INVALID_CATEGORIES.has(c.trim()));
    const cleanCategories = validCategories.length > 0 ? validCategories.join(',') : 'office.it,office.company,office';

    const url = new URL(`${GEOAPIFY_BASE_URL}/v2/places`);
    url.searchParams.set('categories', cleanCategories);
    url.searchParams.set('filter', `circle:${lon},${lat},${radiusMeters}`);
    url.searchParams.set('bias', `proximity:${lon},${lat}`);
    url.searchParams.set('limit', Math.min(limit, 50).toString());
    url.searchParams.set('apiKey', apiKey);

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!response.ok) {
        logger.warn('[geoapify-client] Places request failed', {
          status: response.status,
          statusText: response.statusText,
          lat,
          lon,
          categories: cleanCategories,
        });
        return [];
      }

      const data = (await response.json()) as GeoapifyPlacesResponse;
      const features = data.features || [];

      return features
        .map((f) => {
          const props = f.properties || {};
          const coords = f.geometry?.coordinates;
          return {
            ...props,
            lon: props.lon ?? coords?.[0],
            lat: props.lat ?? coords?.[1],
          };
        })
        .filter((p) => Boolean(p.name?.trim()));
    } catch (err) {
      logger.warn('[geoapify-client] Places request error', { err, lat, lon });
      return [];
    }
  }

  /**
   * Reverse geocodes coordinates (latitude, longitude) into a human-readable location name
   * (e.g. "Kasba Peth, Pune" or "Pune, Maharashtra").
   */
  async reverseGeocode(lat: number, lon: number): Promise<string | null> {
    const apiKey = this.getApiKey();
    if (!apiKey || lat === undefined || lon === undefined) return null;

    const url = new URL(`${GEOAPIFY_BASE_URL}/v1/geocode/reverse`);
    url.searchParams.set('lat', lat.toString());
    url.searchParams.set('lon', lon.toString());
    url.searchParams.set('apiKey', apiKey);

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!response.ok) {
        logger.warn('[geoapify-client] Reverse geocoding request failed', {
          status: response.status,
          statusText: response.statusText,
          lat,
          lon,
        });
        return null;
      }

      const data = (await response.json()) as GeoapifyGeocodeResponse;
      const feature = data.features?.[0];
      if (!feature?.properties) return null;

      const props = feature.properties;
      const city = props.city || props.county || props.district;
      const suburb = props.suburb;
      const state = props.state;

      if (suburb && city && suburb.toLowerCase() !== city.toLowerCase()) {
        return `${suburb}, ${city}`;
      }
      if (city) {
        return state && state.toLowerCase() !== city.toLowerCase() ? `${city}, ${state}` : city;
      }
      return props.formatted || null;
    } catch (err) {
      logger.warn('[geoapify-client] Reverse geocoding error', { err, lat, lon });
      return null;
    }
  }
}

export const geoapifyClient = new GeoapifyClient();
