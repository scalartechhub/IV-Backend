/**
 * Gen AI Career Organization Resolver.
 * Uses Gemini AI to dynamically deduce the most accurate OpenStreetMap Overpass tags,
 * categories, and search/ranking keywords based on the user's specific target role and domain.
 */

import { generateJson } from '../../../library/gemini-client';
import { logger } from '../../../shared/logger';
import { CareerSearchConfig } from '../company.types';
import { careerOrganizationResolver } from './career-organization.resolver';

interface AiCareerMappingResult {
  domainLabel: string;
  roleLabel: string;
  categories: string[];
  osmTags: string[];
  roleKeywords: string[];
  domainKeywords: string[];
}

interface CacheEntry {
  config: CareerSearchConfig;
  expiresAt: number;
}

export class CareerAiResolver {
  private static readonly TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
  private readonly cache = new Map<string, CacheEntry>();

  /**
   * Resolves a user's domain, role, and target role into an OpenStreetMap search config using Gemini AI.
   * If Gemini is unavailable, falls back to the deterministic careerOrganizationResolver.
   */
  public async resolveCareerWithAi(params: {
    domainId: string;
    roleId: string;
    targetRole?: string;
    domainLabel?: string;
    roleLabel?: string;
  }): Promise<CareerSearchConfig> {
    const { domainId, roleId, targetRole } = params;
    const effectiveTargetRole = (targetRole || roleId || '').trim();

    const cacheKey = `${domainId.toLowerCase()}:${roleId.toLowerCase()}:${effectiveTargetRole.toLowerCase()}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      logger.debug('[CareerAiResolver] Cache hit for career search config', { cacheKey });
      return cached.config;
    }

    try {
      logger.info('[CareerAiResolver] Generating dynamic OSM search config via Gemini AI', {
        domainId,
        roleId,
        effectiveTargetRole,
      });

      const aiResult = await this.callGeminiForOsmMapping(
        domainId,
        roleId,
        effectiveTargetRole,
        params.domainLabel,
        params.roleLabel
      );

      const resolvedConfig: CareerSearchConfig = {
        domainId,
        roleId,
        targetRole: effectiveTargetRole,
        domainLabel: aiResult.domainLabel || params.domainLabel || domainId,
        roleLabel: aiResult.roleLabel || effectiveTargetRole || roleId,
        categories: aiResult.categories && aiResult.categories.length > 0 ? aiResult.categories : ['company'],
        osmTags: this.sanitizeOsmTags(aiResult.osmTags),
        keywords: Array.from(
          new Set([...(aiResult.roleKeywords || []), ...(aiResult.domainKeywords || [])])
        ),
        domainKeywords: aiResult.domainKeywords || [],
        roleKeywords: aiResult.roleKeywords || [effectiveTargetRole],
      };

      this.cache.set(cacheKey, {
        config: resolvedConfig,
        expiresAt: Date.now() + CareerAiResolver.TTL_MS,
      });

      return resolvedConfig;
    } catch (err: unknown) {
      logger.warn('[CareerAiResolver] Gemini resolution failed, falling back to static mapping', {
        error: err instanceof Error ? err.message : String(err),
        domainId,
        roleId,
      });

      // Fallback seamlessly to static resolver
      const fallbackConfig = careerOrganizationResolver.resolve(domainId, roleId);
      if (effectiveTargetRole) {
        fallbackConfig.targetRole = effectiveTargetRole;
        if (!fallbackConfig.roleKeywords.includes(effectiveTargetRole)) {
          fallbackConfig.roleKeywords.unshift(effectiveTargetRole);
        }
      }
      return fallbackConfig;
    }
  }

  private async callGeminiForOsmMapping(
    domainId: string,
    roleId: string,
    targetRole: string,
    domainLabel?: string,
    roleLabel?: string
  ): Promise<AiCareerMappingResult> {
    const systemInstruction = `You are an expert GIS and OpenStreetMap (OSM) taxonomy specialist for a career-focused nearby company recommendation engine.
Given a user's career domain, role, and target role, your job is to determine the best OpenStreetMap Overpass key-value tags and search keywords to find physical companies, businesses, offices, and institutions near the user where people with this career work.

OpenStreetMap Overpass uses key-value tags such as:
- office=it, office=company, office=consulting, office=financial, office=accountant, office=lawyer, office=architect, office=advertising_agency, office=employment_agency, office=telecommunication, office=estate_agent, office=research, office=energy_supplier, office=logistics, office=government, office=commercial, office=educational_institution
- building=office, building=commercial
- amenity=hospital, amenity=clinic, amenity=doctors, amenity=pharmacy, amenity=school, amenity=college, amenity=university, amenity=bank, amenity=courthouse, amenity=laboratory, amenity=coworking_space
- craft=builder, craft=hvac, craft=*
- industrial=factory, industrial=manufacturing, industrial=pharmaceutical
- tourism=hotel, amenity=restaurant
- shop=car_repair, shop=supermarket

Rules:
1. Provide 4 to 8 of the most effective, real OpenStreetMap tags in "key=value" format (or "key=*" for wildcards). Always include practical broad tags like "office=company" and "building=office" if relevant so physical workplaces are discovered.
2. Provide 8 to 15 relevant ranking keywords for the role and target role (e.g. software, web development, IT services, tech, solutions).
3. Provide 4 to 8 domain-level keywords.
4. Provide 2 to 4 clean category names (e.g. technology, software, it_services).

Return ONLY a JSON object matching:
{
  "domainLabel": string,
  "roleLabel": string,
  "categories": string[],
  "osmTags": string[],
  "roleKeywords": string[],
  "domainKeywords": string[]
}`;

    const userPrompt = JSON.stringify({
      domainId,
      domainLabel: domainLabel || domainId,
      roleId,
      roleLabel: roleLabel || roleId,
      targetRole: targetRole || roleLabel || roleId,
    });

    return await generateJson<AiCareerMappingResult>({
      systemInstruction,
      userPrompt,
      temperature: 0.2,
      maxOutputTokens: 2048,
    });
  }

  private sanitizeOsmTags(tags: string[]): string[] {
    if (!Array.isArray(tags) || tags.length === 0) {
      return ['office=company', 'building=office'];
    }

    const cleaned = tags
      .map((t) => (t || '').trim())
      .filter((t) => t.includes('=') && !t.includes(' '));

    return cleaned.length > 0 ? Array.from(new Set(cleaned)) : ['office=company', 'building=office'];
  }
}

export const careerAiResolver = new CareerAiResolver();
