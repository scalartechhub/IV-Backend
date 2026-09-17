/**
 * OpenStreetMap Overpass QL Query Builder.
 * Constructs geographic radius queries matching resolved career tags.
 */

import { CareerSearchConfig } from '../../company.types';

export class OsmQueryBuilder {
  private static readonly MAX_TAG_CLAUSES = 10;
  private static readonly DEFAULT_TIMEOUT_SECONDS = 15;

  /**
   * Constructs an Overpass QL query string.
   */
  public buildQuery(
    latitude: number,
    longitude: number,
    radiusMeters: number,
    searchConfig: CareerSearchConfig,
    timeoutSeconds = OsmQueryBuilder.DEFAULT_TIMEOUT_SECONDS
  ): string {
    const lat = Number(latitude).toFixed(6);
    const lon = Number(longitude).toFixed(6);
    const radius = Math.round(radiusMeters);

    const tagClauses = this.buildTagClauses(searchConfig.osmTags, radius, lat, lon);

    return `[out:json][timeout:${timeoutSeconds}];
(
${tagClauses.join('\n')}
);
out center tags;`;
  }

  /**
   * Parses tags into Overpass filter clauses:
   * e.g. 'office=company' -> '  nwr["office"="company"](around:10000,18.520400,73.856700);'
   * e.g. 'craft=*'        -> '  nwr["craft"](around:10000,18.520400,73.856700);'
   */
  private buildTagClauses(
    osmTags: string[],
    radius: number,
    lat: string,
    lon: string
  ): string[] {
    const uniqueTags = Array.from(new Set(osmTags)).slice(0, OsmQueryBuilder.MAX_TAG_CLAUSES);
    const clauses: string[] = [];

    for (const tag of uniqueTags) {
      const trimmed = tag.trim();
      if (!trimmed) continue;

      let filter: string;
      if (trimmed.includes('=')) {
        const [key, value] = trimmed.split('=').map((s) => s.trim());
        if (!key) continue;

        if (value === '*' || !value) {
          filter = `["${this.sanitizeKey(key)}"]`;
        } else {
          filter = `["${this.sanitizeKey(key)}"="${this.sanitizeValue(value)}"]`;
        }
      } else {
        filter = `["${this.sanitizeKey(trimmed)}"]`;
      }

      clauses.push(`  nwr${filter}(around:${radius},${lat},${lon});`);
    }

    if (clauses.length === 0) {
      clauses.push(`  nwr["office"="company"](around:${radius},${lat},${lon});`);
    }

    return clauses;
  }

  private sanitizeKey(key: string): string {
    return key.replace(/[^a-zA-Z0-9_:]/g, '');
  }

  private sanitizeValue(val: string): string {
    return val.replace(/["\\]/g, '');
  }
}

export const osmQueryBuilder = new OsmQueryBuilder();
