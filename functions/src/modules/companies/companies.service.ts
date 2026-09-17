/**
 * Companies Service Orchestrator.
 * Coordinates user career retrieval, caching, Overpass querying, distance calculation, deduplication, and ranking.
 */

import { db } from '../../config/firebase';
import { logger } from '../../shared/logger';
import {
  NearbyOrganization,
  NearbyOrganizationsRequest,
  NearbyOrganizationsResponseData,
} from './company.types';
import { careerAiResolver, CareerAiResolver } from './career/career-ai.resolver';
import { calculateDistanceKm } from './geo/geo.util';
import {
  organizationCacheService,
  OrganizationCacheService,
} from './organizations/organization-cache.service';
import {
  organizationDeduplicatorService,
  OrganizationDeduplicatorService,
} from './organizations/organization-deduplicator.service';
import {
  organizationRankingService,
  OrganizationRankingService,
  RawNearbyOrganizationWithDistance,
} from './organizations/organization-ranking.service';
import { osmProvider } from './providers/osm/osm.provider';
import { OrganizationLocationProvider } from './providers/organization-provider.interface';

export class OnboardingIncompleteError extends Error {
  public readonly code = 'ONBOARDING_INCOMPLETE';
  constructor(message = 'Complete onboarding before requesting nearby organizations.') {
    super(message);
    this.name = 'OnboardingIncompleteError';
  }
}

export class CompaniesService {
  constructor(
    private readonly provider: OrganizationLocationProvider = osmProvider,
    private readonly aiResolver: CareerAiResolver = careerAiResolver,
    private readonly rankingService: OrganizationRankingService = organizationRankingService,
    private readonly deduplicator: OrganizationDeduplicatorService = organizationDeduplicatorService,
    private readonly cacheService: OrganizationCacheService = organizationCacheService
  ) {}

  public async getNearbyOrganizations(
    uid: string,
    params: NearbyOrganizationsRequest
  ): Promise<NearbyOrganizationsResponseData> {
    const startTime = Date.now();
    const radius = params.radius ?? 25000;
    const limit = params.limit ?? 20;
    const { latitude, longitude } = params;

    // 1. Fetch user career from Firestore (or request overrides)
    const userCareer = await this.getUserCareer(uid, params);
    const { domainId, roleId, targetRole, domainLabel, roleLabel, targetCompanies } = userCareer;

    logger.info('[CompaniesService] Processing nearby organizations request', {
      uid,
      domainId,
      roleId,
      targetRole,
      latitude,
      longitude,
      radius,
      limit,
    });

    // 2. Check cache
    const cacheKey = this.cacheService.generateKey(
      latitude,
      longitude,
      radius,
      domainId,
      roleId,
      targetRole
    );
    const cached = this.cacheService.get(cacheKey);
    if (cached) {
      logger.info('[CompaniesService] Cache hit', { cacheKey, count: cached.length });
      const sliced = cached.slice(0, limit);
      return {
        location: { latitude, longitude, radius },
        career: { domainId, roleId, targetRole, domainLabel, roleLabel },
        organizations: sliced,
        total: sliced.length,
      };
    }

    // 3. Resolve career using Gen AI (with resilient fallback to static mapping)
    const searchConfig = await this.aiResolver.resolveCareerWithAi({
      domainId,
      roleId,
      targetRole,
      domainLabel,
      roleLabel,
    });

    if (targetCompanies && targetCompanies.length > 0) {
      searchConfig.targetCompanies = targetCompanies;
    }


    // 4. Query organization location provider
    const rawOrganizations = await this.provider.searchNearby(
      latitude,
      longitude,
      radius,
      searchConfig
    );

    // 5. Calculate distance for each organization using Haversine
    const maxAllowedKm = (radius / 1000) * 1.2; // 20% tolerance beyond radius
    const withDistance: RawNearbyOrganizationWithDistance[] = [];

    for (const org of rawOrganizations) {
      const distanceKm = calculateDistanceKm(latitude, longitude, org.latitude, org.longitude);
      if (distanceKm <= maxAllowedKm) {
        withDistance.push({
          ...org,
          distanceKm,
        });
      }
    }

    // 6. Deduplicate by OSM ID and fuzzy name + proximity
    const deduplicated = this.deduplicator.deduplicate(withDistance);

    // 7. Relevance scoring, distance weighting, and ranking
    const ranked = this.rankingService.rankAndSort(
      deduplicated,
      searchConfig,
      radius,
      limit
    );

    // 8. Cache the ranked organizations
    this.cacheService.set(cacheKey, ranked);

    const executionTimeMs = Date.now() - startTime;
    logger.info('[CompaniesService] Request completed successfully', {
      uid,
      domainId,
      roleId,
      resultCount: ranked.length,
      executionTimeMs,
    });

    return {
      location: { latitude, longitude, radius },
      career: { domainId, roleId, targetRole, domainLabel, roleLabel },
      organizations: ranked,
      total: ranked.length,
    };
  }

  /**
   * Reads user document from Firestore users/{uid}.
   * Extracts domainId, roleId, targetRole, and targetCompanies (with request body overrides if provided).
   */
  public async getUserCareer(
    uid: string,
    params?: NearbyOrganizationsRequest
  ): Promise<{
    domainId: string;
    roleId: string;
    targetRole?: string;
    domainLabel?: string;
    roleLabel?: string;
    targetCompanies?: string[];
  }> {
    if (!uid || !uid.trim()) {
      throw new OnboardingIncompleteError('Authenticated user ID missing.');
    }

    const docSnap = await db.collection('users').doc(uid).get();
    if (!docSnap.exists) {
      throw new OnboardingIncompleteError('Complete onboarding before requesting nearby organizations.');
    }

    const data = docSnap.data();
    const current = data?.onboardingCatalog?.current;
    const profile = data?.profile;
    const goal = data?.onboardingCatalog?.goal;

    const domainId =
      params?.domain?.trim() ||
      current?.domainId?.trim() ||
      profile?.currentRole?.trim() ||
      data?.currentRole?.trim();

    const roleId =
      current?.roleId?.trim() ||
      profile?.targetRole?.trim() ||
      params?.targetRole?.trim() ||
      data?.targetRole?.trim();

    const targetRole =
      params?.targetRole?.trim() ||
      current?.targetRole?.trim() ||
      profile?.targetRole?.trim() ||
      goal?.targetRoleIds?.[0]?.trim() ||
      data?.onboarding?.selectedRole?.trim() ||
      data?.targetRole?.trim() ||
      roleId;

    const targetCompanies = [
      ...(Array.isArray(goal?.targetCompanies) ? goal.targetCompanies : []),
      ...(typeof data?.targetCompanies === 'string'
        ? data.targetCompanies.split(',').map((s: string) => s.trim())
        : []),
      ...(Array.isArray(data?.onboarding?.targetCompanies) ? data.onboarding.targetCompanies : []),
      ...(Array.isArray(data?.targetCompanies) ? data.targetCompanies : []),
    ].filter(Boolean);

    if (!domainId || !roleId) {
      throw new OnboardingIncompleteError('Complete onboarding before requesting nearby organizations.');
    }

    return {
      domainId,
      roleId,
      targetRole,
      domainLabel: current?.domainLabel || current?.domainId || domainId,
      roleLabel: current?.roleLabel || current?.targetRole || targetRole || roleId,
      targetCompanies,
    };
  }
}


export const companiesService = new CompaniesService();
