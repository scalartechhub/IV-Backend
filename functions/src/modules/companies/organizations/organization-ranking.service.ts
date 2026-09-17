/**
 * Organization Ranking Service.
 * Scores organizations by career relevance and proximity, sorts and slices to requested limit.
 */

import { CareerSearchConfig, NearbyOrganization, RawNearbyOrganization } from '../company.types';

export interface RawNearbyOrganizationWithDistance extends RawNearbyOrganization {
  distanceKm: number;
}

export class OrganizationRankingService {
  /**
   * Scores, ranks, and sorts nearby organizations.
   */
  public rankAndSort(
    organizations: RawNearbyOrganizationWithDistance[],
    searchConfig: CareerSearchConfig,
    radiusMeters: number,
    limit = 20
  ): NearbyOrganization[] {
    if (!Array.isArray(organizations) || organizations.length === 0) {
      return [];
    }

    const scored: NearbyOrganization[] = organizations.map((org) => {
      const details = this.calculateFinalScoreWithDetails(org, searchConfig, radiusMeters);

      return {
        id: org.id,
        name: org.name,
        type: org.type,
        category: org.category,
        latitude: org.latitude,
        longitude: org.longitude,
        distanceKm: org.distanceKm,
        address: org.address,
        city: org.city,
        postcode: org.postcode,
        phone: org.phone,
        website: org.website,
        osmType: org.osmType,
        osmId: org.osmId,
        relevanceScore: details.relevanceScore,
        isTargetCompany: details.isTargetCompany,
        roleMatch: details.roleMatch,
        source: 'openstreetmap',
      };
    });

    // Sort: 1. Relevance score (desc) -> 2. Distance (asc) -> 3. Organization name (asc)
    scored.sort((a, b) => {
      if (b.relevanceScore !== a.relevanceScore) {
        return b.relevanceScore - a.relevanceScore;
      }
      if (a.distanceKm !== b.distanceKm) {
        return a.distanceKm - b.distanceKm;
      }
      return a.name.localeCompare(b.name);
    });

    return scored.slice(0, Math.max(1, limit));
  }

  /**
   * Computes application-level relevance score and combines with distance score.
   */
  public calculateFinalScore(
    org: RawNearbyOrganizationWithDistance,
    searchConfig: CareerSearchConfig,
    radiusMeters: number
  ): number {
    return this.calculateFinalScoreWithDetails(org, searchConfig, radiusMeters).relevanceScore;
  }

  public calculateFinalScoreWithDetails(
    org: RawNearbyOrganizationWithDistance,
    searchConfig: CareerSearchConfig,
    radiusMeters: number
  ): { relevanceScore: number; isTargetCompany: boolean; roleMatch: boolean } {
    const { points: relevanceRaw, isTargetCompany, roleMatch } = this.computeRelevancePoints(org, searchConfig);
    const distanceScore = this.computeDistanceScore(org.distanceKm, radiusMeters);

    let finalScore: number;
    if (relevanceRaw <= 0) {
      // Unrelated entity: distance must NOT elevate an irrelevant place
      finalScore = Math.min(15, Math.max(5, Math.round(distanceScore * 0.15)));
    } else {
      // Career-aligned organization: 80% relevance score + 20% proximity bonus
      const clampedRelevance = Math.min(100, Math.max(25, relevanceRaw));
      finalScore = Math.round(clampedRelevance * 0.8 + distanceScore * 0.2);
    }

    return {
      relevanceScore: Math.min(100, Math.max(1, finalScore)),
      isTargetCompany,
      roleMatch,
    };
  }

  private computeRelevancePoints(
    org: RawNearbyOrganizationWithDistance,
    searchConfig: CareerSearchConfig
  ): { points: number; isTargetCompany: boolean; roleMatch: boolean } {
    let points = 0;
    const nameLower = org.name.toLowerCase();
    const typeLower = org.type.toLowerCase();
    const catLower = org.category.toLowerCase();

    // 0. User's Target Company match (+45 points)
    let isTargetCompany = false;
    if (searchConfig.targetCompanies && searchConfig.targetCompanies.length > 0) {
      for (const tc of searchConfig.targetCompanies) {
        const cleanTc = tc.trim().toLowerCase();
        if (cleanTc.length >= 2 && (nameLower.includes(cleanTc) || cleanTc.includes(nameLower))) {
          points += 45;
          isTargetCompany = true;
          break;
        }
      }
    }

    // 1. Role exact keyword match (+50)
    let hasRoleExact = false;
    for (const kw of searchConfig.roleKeywords) {
      const lowerKw = kw.toLowerCase();
      if (this.containsWholePhrase(nameLower, lowerKw) || this.containsWholePhrase(typeLower, lowerKw)) {
        points += 50;
        hasRoleExact = true;
        break;
      }
    }

    // 2. Role partial keyword match (+30, if not exact)
    let hasRolePartial = false;
    if (!hasRoleExact) {
      for (const kw of searchConfig.roleKeywords) {
        const words = kw.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
        const matchWord = words.find((w) => nameLower.includes(w) || typeLower.includes(w));
        if (matchWord) {
          points += 30;
          hasRolePartial = true;
          break;
        }
      }
    }

    const roleMatch = hasRoleExact || hasRolePartial;

    // 3. Domain keyword match (+20)
    for (const kw of searchConfig.domainKeywords) {
      const lowerKw = kw.toLowerCase();
      if (nameLower.includes(lowerKw) || typeLower.includes(lowerKw) || catLower.includes(lowerKw)) {
        points += 20;
        break;
      }
    }

    // 4. Relevant OSM category / tag match (+20)
    if (org.matchedTags && org.matchedTags.length > 0) {
      points += 20;
    } else if (searchConfig.categories.some((c) => c.toLowerCase() === catLower)) {
      points += 20;
    }

    // 5. Organization name label match (+20)
    const roleLabelLower = searchConfig.roleLabel.toLowerCase();
    const domainLabelLower = searchConfig.domainLabel.toLowerCase();
    if (nameLower.includes(roleLabelLower) || nameLower.includes(domainLabelLower)) {
      points += 20;
    }

    // 6. Corporate / Tech entity keyword indicators in company name (+20)
    const techCorporateKeywords = [
      'software', 'tech', 'technologies', 'technology', 'systems', 'solutions',
      'infotech', 'digital', 'labs', 'analytics', 'consulting', 'services',
      'data', 'cloud', 'cyber', 'robotics', 'ai', 'interactive', 'media',
      'enterprises', 'global', 'ventures', 'innovations', 'studios'
    ];
    for (const kw of techCorporateKeywords) {
      if (this.containsWholePhrase(nameLower, kw)) {
        points += 20;
        break;
      }
    }

    // 7. Verified Corporate Presence (Legitimate companies have websites and contact info)
    if (org.website && org.website.trim().length > 4) {
      points += 15;
    }
    if (org.phone && org.phone.trim().length > 4) {
      points += 5;
    }

    // 8. Proximity bonus (<= 2 km: +10, <= 5 km: +5)
    if (org.distanceKm <= 2) {
      points += 10;
    } else if (org.distanceKm <= 5) {
      points += 5;
    }

    // 9. Negative penalties
    if (
      (typeLower === 'government' || typeLower === 'townhall' || typeLower === 'embassy') &&
      !searchConfig.domainId.includes('government') &&
      !searchConfig.domainId.includes('public-safety')
    ) {
      points -= 35;
    }

    if (
      (typeLower === 'supermarket' || typeLower === 'convenience' || typeLower === 'bakery' || typeLower === 'laundry' || typeLower === 'hairdresser' || typeLower === 'clothes') &&
      (searchConfig.domainId.includes('technology') || searchConfig.domainId.includes('it'))
    ) {
      points -= 40;
    }

    return { points, isTargetCompany, roleMatch };
  }


  private computeDistanceScore(distanceKm: number, radiusMeters: number): number {
    const radiusKm = Math.max(1, radiusMeters / 1000);
    const distanceFraction = Math.min(1, distanceKm / radiusKm);
    return Math.round(100 * (1 - distanceFraction));
  }

  private containsWholePhrase(text: string, phrase: string): boolean {
    if (!phrase || !text) return false;
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(^|\\W)${escaped}(\\W|$)`, 'i');
    return regex.test(text);
  }
}

export const organizationRankingService = new OrganizationRankingService();
