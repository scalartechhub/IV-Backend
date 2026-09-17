/**
 * Dynamic Career Organization Resolver.
 * Maps user domainId and roleId into rich search configurations for OpenStreetMap.
 */

import { CareerSearchConfig } from '../company.types';
import {
  CAREER_DOMAIN_MAPPINGS,
  DOMAIN_ALIASES,
  GENERIC_CAREER_MAPPING,
  ROLE_ALIASES,
} from './career-organization.mapping';

export class CareerOrganizationResolver {
  /**
   * Resolves a user's domain and role to OpenStreetMap search configuration.
   * Handles exact roles, alias roles, domain-level fallbacks, and generic fallbacks.
   */
  public resolve(rawDomainId: string, rawRoleId: string): CareerSearchConfig {
    const domainId = this.normalizeKey(rawDomainId);
    const roleId = this.normalizeKey(rawRoleId);

    // 1. Resolve canonical domain key
    let canonicalDomainKey = DOMAIN_ALIASES[domainId] || domainId;

    // If domain isn't directly known, check if role hints at a known domain
    if (!CAREER_DOMAIN_MAPPINGS[canonicalDomainKey]) {
      const canonicalRoleKey = ROLE_ALIASES[roleId] || roleId;
      for (const [domKey, domConfig] of Object.entries(CAREER_DOMAIN_MAPPINGS)) {
        if (domConfig.roles[canonicalRoleKey] || domConfig.roles[roleId]) {
          canonicalDomainKey = domKey;
          break;
        }
      }
    }

    const domainMapping = CAREER_DOMAIN_MAPPINGS[canonicalDomainKey];

    // 2. If domain is known:
    if (domainMapping) {
      const canonicalRoleKey = ROLE_ALIASES[roleId] || roleId;
      let roleMapping = domainMapping.roles[canonicalRoleKey] || domainMapping.roles[roleId];

      // If not directly found in this domain, check prefix or partial match (e.g. "it-frontend-developer" for "frontend-developer")
      if (!roleMapping) {
        for (const [rKey, rConfig] of Object.entries(domainMapping.roles)) {
          if (rKey.includes(roleId) || roleId.includes(rKey)) {
            roleMapping = rConfig;
            break;
          }
        }
      }

      if (roleMapping) {
        // Full role-level match
        const osmTags = Array.from(new Set([...roleMapping.osmTags, ...domainMapping.osmTags]));
        const keywords = Array.from(
          new Set([...roleMapping.roleKeywords, ...domainMapping.domainKeywords])
        );
        const categories = Array.from(
          new Set([...(roleMapping.categories || []), ...domainMapping.categories])
        );

        return {
          domainId: rawDomainId,
          roleId: rawRoleId,
          domainLabel: this.toHumanLabel(canonicalDomainKey),
          roleLabel: this.toHumanLabel(roleId),
          categories,
          osmTags,
          keywords,
          domainKeywords: domainMapping.domainKeywords,
          roleKeywords: roleMapping.roleKeywords,
        };
      }

      // Role unknown -> Domain-level fallback
      return {
        domainId: rawDomainId,
        roleId: rawRoleId,
        domainLabel: this.toHumanLabel(canonicalDomainKey),
        roleLabel: this.toHumanLabel(roleId),
        categories: domainMapping.categories,
        osmTags: domainMapping.osmTags,
        keywords: domainMapping.domainKeywords,
        domainKeywords: domainMapping.domainKeywords,
        roleKeywords: [roleId.replace(/[-_]/g, ' ')],
      };
    }

    // 3. Unknown domain and unknown role -> Generic business search fallback
    return {
      domainId: rawDomainId,
      roleId: rawRoleId,
      domainLabel: this.toHumanLabel(domainId),
      roleLabel: this.toHumanLabel(roleId),
      categories: GENERIC_CAREER_MAPPING.categories,
      osmTags: GENERIC_CAREER_MAPPING.osmTags,
      keywords: GENERIC_CAREER_MAPPING.domainKeywords,
      domainKeywords: [domainId.replace(/[-_]/g, ' ')],
      roleKeywords: [roleId.replace(/[-_]/g, ' ')],
    };
  }

  private normalizeKey(key: string): string {
    return (key || '')
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, '-');
  }

  private toHumanLabel(slug: string): string {
    return slug
      .split(/[-_]/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}

export const careerOrganizationResolver = new CareerOrganizationResolver();
