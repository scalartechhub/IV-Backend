/**
 * OpenStreetMap Overpass API Provider.
 * Queries Overpass API with resilience, automatic fallback endpoints, and timeouts.
 */

import { CareerSearchConfig, RawNearbyOrganization } from '../../company.types';
import { logger } from '../../../../shared/logger';
import { OrganizationLocationProvider } from '../organization-provider.interface';

import { osmQueryBuilder, OsmQueryBuilder } from './osm.query-builder';
import {
  organizationNormalizerService,
  OrganizationNormalizerService,
} from '../../organizations/organization-normalizer.service';
import { OverpassResponse } from './osm.types';

export class OsmProvider implements OrganizationLocationProvider {
  private static readonly DEFAULT_TIMEOUT_MS = 15000;
  private static readonly MAX_ATTEMPTS_PER_ENDPOINT = 2;

  constructor(
    private readonly queryBuilder: OsmQueryBuilder = osmQueryBuilder,
    private readonly normalizer: OrganizationNormalizerService = organizationNormalizerService
  ) {}

  public async searchNearby(
    latitude: number,
    longitude: number,
    radius: number,
    searchConfig: CareerSearchConfig
  ): Promise<RawNearbyOrganization[]> {
    const query = this.queryBuilder.buildQuery(latitude, longitude, radius, searchConfig);
    const endpoints = this.getEndpoints();

    let lastError: Error | null = null;
    const startTime = Date.now();

    for (const endpoint of endpoints) {
      for (let attempt = 1; attempt <= OsmProvider.MAX_ATTEMPTS_PER_ENDPOINT; attempt++) {
        try {
          logger.info(`[OsmProvider] Querying Overpass endpoint`, {
            endpoint,
            attempt,
            domainId: searchConfig.domainId,
            roleId: searchConfig.roleId,
          });

          const elements = await this.executeOverpassQuery(endpoint, query);
          const executionTimeMs = Date.now() - startTime;

          logger.info(`[OsmProvider] Query successful`, {
            endpoint,
            attempt,
            rawCount: elements.length,
            executionTimeMs,
          });

          return this.normalizer.normalizeMany(elements, searchConfig);
        } catch (err: unknown) {
          lastError = err instanceof Error ? err : new Error(String(err));
          logger.warn(`[OsmProvider] Attempt ${attempt} failed on endpoint ${endpoint}`, {
            error: lastError.message,
          });

          // Short backoff before next attempt on same endpoint
          if (attempt < OsmProvider.MAX_ATTEMPTS_PER_ENDPOINT) {
            await this.sleep(300);
          }
        }
      }
    }

    logger.error(`[OsmProvider] All Overpass endpoints failed`, {
      error: lastError?.message,
      executionTimeMs: Date.now() - startTime,
    });

    throw new Error('External organization provider temporarily unavailable.');
  }

  private async executeOverpassQuery(endpoint: string, query: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OsmProvider.DEFAULT_TIMEOUT_MS);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'User-Agent': 'AIInterviewer/1.0 (NearbyCompanyService)',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Overpass HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as OverpassResponse;
      if (!data || !Array.isArray(data.elements)) {
        throw new Error('Invalid response structure from Overpass API');
      }

      return data.elements;
    } finally {
      clearTimeout(timeout);
    }
  }

  private getEndpoints(): string[] {
    const primary =
      process.env.OSM_OVERPASS_URL ||
      process.env.OVERPASS_API_URL ||
      'https://overpass-api.de/api/interpreter';

    const fallback =
      process.env.OSM_OVERPASS_FALLBACK_URL ||
      process.env.OVERPASS_FALLBACK_API_URL ||
      'https://overpass.kumi.systems/api/interpreter';

    return Array.from(new Set([primary, fallback])).filter(Boolean);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const osmProvider = new OsmProvider();
