/**
 * Normalizes raw OpenStreetMap Overpass elements into standard organization records.
 */

import { CareerSearchConfig, RawNearbyOrganization } from '../company.types';
import { OverpassElement } from '../providers/osm/osm.types';

export class OrganizationNormalizerService {
  /**
   * Normalizes an array of Overpass elements.
   */
  public normalizeMany(
    elements: OverpassElement[],
    searchConfig: CareerSearchConfig
  ): RawNearbyOrganization[] {
    if (!Array.isArray(elements)) {
      return [];
    }

    const organizations: RawNearbyOrganization[] = [];

    for (const element of elements) {
      const normalized = this.normalizeElement(element, searchConfig);
      if (normalized) {
        organizations.push(normalized);
      }
    }

    return organizations;
  }

  /**
   * Normalizes a single Overpass node/way/relation element.
   * Returns null if coordinates or name are missing.
   */
  public normalizeElement(
    element: OverpassElement,
    searchConfig: CareerSearchConfig
  ): RawNearbyOrganization | null {
    if (!element || !element.tags) {
      return null;
    }

    const tags = element.tags;

    // Exclude non-workplace elements (residential buildings, public utilities, street furniture)
    const buildingTag = (tags.building || '').toLowerCase();
    if (['apartments', 'residential', 'house', 'detached', 'bungalow', 'shed', 'garage', 'garages'].includes(buildingTag)) {
      return null;
    }

    const amenityTag = (tags.amenity || '').toLowerCase();
    if (['atm', 'bench', 'parking', 'parking_space', 'fuel', 'toilets', 'post_box', 'waste_basket', 'drinking_water', 'vending_machine'].includes(amenityTag)) {
      return null;
    }

    // 1. Resolve Organization Name (Priority: name -> official_name -> brand -> operator)
    const rawName = tags.name || tags.official_name || tags.brand || tags.operator;
    const name = (rawName || '').trim();
    if (!name || name.length < 2) {
      return null;
    }

    // Filter out names that are residential / generic infrastructure / pure numbers
    if (
      /^(flat|gate|block|wing|tower|entry|exit|lift|parking|shed|plot|house|society|apartments|villa|residency|chawl)\s+[0-9a-z]/i.test(name) ||
      /^(block|tower|wing)\s+[a-z0-9]+$/i.test(name) ||
      /^\d+$/.test(name)
    ) {
      return null;
    }

    // 2. Resolve Coordinates
    let lat: number | undefined;
    let lon: number | undefined;

    if (element.type === 'node') {
      lat = element.lat;
      lon = element.lon;
    } else {
      lat = element.center?.lat ?? element.lat;
      lon = element.center?.lon ?? element.lon;
    }

    if (lat === undefined || lon === undefined || isNaN(lat) || isNaN(lon)) {
      return null;
    }

    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return null;
    }

    // 3. Resolve Address details
    const housenumber = (tags['addr:housenumber'] || '').trim();
    const street = (tags['addr:street'] || '').trim();
    const address = [housenumber, street].filter(Boolean).join(' ') || undefined;
    const city = tags['addr:city']?.trim() || undefined;
    const postcode = tags['addr:postcode']?.trim() || undefined;

    // 4. Contact details
    const phone = (tags.phone || tags['contact:phone'] || tags['contact:mobile'] || '').trim() || undefined;
    const website = (tags.website || tags['contact:website'] || tags.url || '').trim() || undefined;

    // 5. Organization Type & Category
    const type = this.resolveOrganizationType(tags);
    const category = searchConfig.categories[0] || 'business';

    // 6. Matched OSM tags for relevance scoring
    const matchedTags = this.extractMatchedTags(tags, searchConfig.osmTags);

    return {
      id: `${element.type}-${element.id}`,
      name,
      type,
      category,
      latitude: lat,
      longitude: lon,
      address,
      city,
      postcode,
      phone,
      website,
      osmType: element.type,
      osmId: String(element.id),
      source: 'openstreetmap',
      matchedTags,
    };
  }

  private resolveOrganizationType(tags: Record<string, string>): string {
    if (tags.office) return tags.office;
    if (tags.amenity) return tags.amenity;
    if (tags.craft) return tags.craft;
    if (tags.shop) return tags.shop;
    if (tags.industrial) return tags.industrial;
    if (tags.building && tags.building !== 'yes') return tags.building;
    return 'company';
  }

  private extractMatchedTags(tags: Record<string, string>, targetTags: string[]): string[] {
    const matched: string[] = [];

    for (const target of targetTags) {
      const [key, val] = target.split('=').map((s) => s.trim());
      if (!key) continue;

      if (tags[key]) {
        if (!val || val === '*' || tags[key].toLowerCase() === val.toLowerCase()) {
          matched.push(`${key}=${tags[key]}`);
        }
      }
    }

    return Array.from(new Set(matched));
  }
}

export const organizationNormalizerService = new OrganizationNormalizerService();
