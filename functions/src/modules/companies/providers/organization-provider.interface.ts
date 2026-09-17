/**
 * Location provider abstraction for finding organizations.
 * Allows seamless integration of future providers (Google Places, TomTom, HERE, etc.).
 */

import { CareerSearchConfig, RawNearbyOrganization } from '../company.types';

export interface OrganizationLocationProvider {
  searchNearby(
    latitude: number,
    longitude: number,
    radius: number,
    searchConfig: CareerSearchConfig
  ): Promise<RawNearbyOrganization[]>;
}
