/**
 * Deduplication service for nearby organizations.
 * Performs primary (OSM ID) and secondary (normalized name + geographic proximity) deduplication.
 */

import { areLocationsClose } from '../geo/geo.util';

export interface DeduplicatableOrganization {
  id: string;
  name: string;
  osmType: string;
  osmId: string;
  latitude: number;
  longitude: number;
  address?: string;
  phone?: string;
  website?: string;
}

export class OrganizationDeduplicatorService {
  private static readonly PROXIMITY_THRESHOLD_METERS = 150;

  /**
   * Deduplicates organizations by OSM ID and fuzzy name within close proximity.
   */
  public deduplicate<T extends DeduplicatableOrganization>(organizations: T[]): T[] {
    if (!Array.isArray(organizations) || organizations.length <= 1) {
      return organizations || [];
    }

    const uniqueByOsmId: T[] = [];
    const seenOsmIds = new Set<string>();

    // 1. Primary deduplication by OSM identifier
    for (const org of organizations) {
      const key = `${org.osmType}:${org.osmId}`;
      if (!seenOsmIds.has(key)) {
        seenOsmIds.add(key);
        uniqueByOsmId.push(org);
      }
    }

    // 2. Secondary deduplication by normalized name + geographic proximity
    const results: T[] = [];

    for (const org of uniqueByOsmId) {
      const normalizedName = this.normalizeName(org.name);
      let isDuplicate = false;

      for (let i = 0; i < results.length; i++) {
        const existing = results[i];
        const existingNormName = this.normalizeName(existing.name);

        if (normalizedName === existingNormName || this.areNamesSimilar(normalizedName, existingNormName)) {
          // Check proximity
          if (
            areLocationsClose(
              org.latitude,
              org.longitude,
              existing.latitude,
              existing.longitude,
              OrganizationDeduplicatorService.PROXIMITY_THRESHOLD_METERS
            )
          ) {
            isDuplicate = true;
            // Prefer the record with more detailed contact/address data
            if (this.richnessScore(org) > this.richnessScore(existing)) {
              results[i] = org;
            }
            break;
          }
        }
      }

      if (!isDuplicate) {
        results.push(org);
      }
    }

    return results;
  }

  /**
   * Normalizes organization name for comparison.
   * Strips legal entities, punctuation, and common noise words.
   */
  public normalizeName(name: string): string {
    return (name || '')
      .toLowerCase()
      .replace(/[\.,\-\/\\()\[\]'"]/g, ' ')
      .replace(
        /\b(pvt|private|ltd|limited|llc|inc|incorporated|corp|corporation|technologies|technology|solutions|services|company|co)\b/g,
        ''
      )
      .replace(/\s+/g, ' ')
      .trim();
  }

  private areNamesSimilar(nameA: string, nameB: string): boolean {
    if (!nameA || !nameB) return false;
    if (nameA === nameB) return true;
    if (nameA.length > 5 && nameB.length > 5) {
      return nameA.startsWith(nameB) || nameB.startsWith(nameA);
    }
    return false;
  }

  private richnessScore(org: DeduplicatableOrganization): number {
    let score = 0;
    if (org.address) score += 2;
    if (org.website) score += 2;
    if (org.phone) score += 1;
    return score;
  }
}

export const organizationDeduplicatorService = new OrganizationDeduplicatorService();
