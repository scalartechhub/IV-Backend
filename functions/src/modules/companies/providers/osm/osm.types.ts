/**
 * Type definitions for OpenStreetMap Overpass API responses and queries.
 */

export interface OverpassElementCenter {
  lat: number;
  lon: number;
}

export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number | string;
  lat?: number;
  lon?: number;
  center?: OverpassElementCenter;
  tags?: Record<string, string>;
}

export interface OverpassResponse {
  version?: number;
  generator?: string;
  osm3s?: {
    timestamp_osm_base?: string;
    copyright?: string;
  };
  elements: OverpassElement[];
}
