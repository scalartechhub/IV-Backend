/**
 * Data contracts and interfaces for Nearby Organization Recommendation API.
 */

export interface NearbyOrganization {
  id: string;
  name: string;
  type: string;
  category: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
  address?: string;
  city?: string;
  postcode?: string;
  phone?: string;
  website?: string;
  osmType: 'node' | 'way' | 'relation';
  osmId: string;
  relevanceScore: number;
  source: 'openstreetmap';
  isTargetCompany?: boolean;
  roleMatch?: boolean;
}

export interface RawNearbyOrganization {
  id: string;
  name: string;
  type: string;
  category: string;
  latitude: number;
  longitude: number;
  address?: string;
  city?: string;
  postcode?: string;
  phone?: string;
  website?: string;
  osmType: 'node' | 'way' | 'relation';
  osmId: string;
  source: 'openstreetmap';
  matchedTags: string[];
}

export interface CareerSearchConfig {
  domainId: string;
  roleId: string;
  targetRole?: string;
  domainLabel: string;
  roleLabel: string;
  categories: string[];
  osmTags: string[];
  keywords: string[];
  domainKeywords: string[];
  roleKeywords: string[];
  targetCompanies?: string[];
}

export interface CareerRoleMapping {
  roleKeywords: string[];
  osmTags: string[];
  categories?: string[];
}

export interface CareerDomainMapping {
  domainKeywords: string[];
  osmTags: string[];
  categories: string[];
  roles: Record<string, CareerRoleMapping>;
}

export interface NearbyOrganizationsRequest {
  latitude: number;
  longitude: number;
  radius?: number;
  limit?: number;
  targetRole?: string;
  domain?: string;
}

export interface NearbyOrganizationsResponseData {
  location: {
    latitude: number;
    longitude: number;
    radius: number;
  };
  career: {
    domainId: string;
    roleId: string;
    targetRole?: string;
    domainLabel?: string;
    roleLabel?: string;
  };
  organizations: NearbyOrganization[];
  total: number;
}


export interface NearbyOrganizationsResponse {
  success: true;
  data: NearbyOrganizationsResponseData;
}

export interface NearbyOrganizationsErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
  };
}
