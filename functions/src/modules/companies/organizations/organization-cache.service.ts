/**
 * Lightweight in-memory cache abstraction with TTL and coordinate grid rounding.
 * Can be swapped with Redis in the future without changing business logic.
 */

import { NearbyOrganization } from '../company.types';

interface CacheEntry {
  data: NearbyOrganization[];
  expiresAt: number;
}

export class OrganizationCacheService {
  private static readonly DEFAULT_TTL_MS = 20 * 60 * 1000; // 20 minutes
  private readonly store = new Map<string, CacheEntry>();

  /**
   * Generates a coordinate-rounded cache key.
   * Rounding coordinates to 2 decimal places (~1.1 km grid) prevents redundant external calls for minor GPS movements.
   */
  public generateKey(
    latitude: number,
    longitude: number,
    radius: number,
    domainId: string,
    roleId: string,
    targetRole?: string
  ): string {
    const latRounded = Number(latitude).toFixed(2);
    const lonRounded = Number(longitude).toFixed(2);
    const rad = Math.round(radius);
    const dom = (domainId || 'generic').toLowerCase().trim();
    const rol = (roleId || 'generic').toLowerCase().trim();
    const tr = (targetRole || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '');

    return `nearby:${latRounded}:${lonRounded}:${rad}:${dom}:${rol}:${tr}`;
  }


  public get(key: string): NearbyOrganization[] | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    return entry.data;
  }

  public set(
    key: string,
    data: NearbyOrganization[],
    ttlMs = OrganizationCacheService.DEFAULT_TTL_MS
  ): void {
    this.cleanExpired();
    this.store.set(key, {
      data,
      expiresAt: Date.now() + ttlMs,
    });
  }

  public clear(): void {
    this.store.clear();
  }

  private cleanExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }
}

export const organizationCacheService = new OrganizationCacheService();
