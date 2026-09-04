import type { PracticeDifficultyLabel } from '../../interfaces/practice.interface';
import type { InterviewDifficulty, InterviewMode } from '../../interfaces/interview.interface';


/** Pre-configured payload allowing 1-tap interview launch from mobile / frontend */
export interface QuickStartPayload {
  companyId: string;
  company: string;
  mode: InterviewMode;
  difficulty: InterviewDifficulty;
  role: string;
  durationMinutes: number;
}

/** Query parameters accepted by GET /v2/companies/nearby */
export interface NearbyCompanyQuery {
  lat?: number;
  lon?: number;
  city?: string;
  radiusKm?: number;
  role?: string;
}

/** An enriched nearby company item matching web & mobile data contracts */
export interface NearbyCompanyItem {
  id: string;
  name: string;
  slug: string;
  logoUrl: string;
  domain: string;
  matchingRole: string;
  relevanceScore: number;
  roleFitSummary: string;
  formattedAddress: string;
  city: string;
  state: string;
  country: string;
  distanceKm: number;
  coordinates: {
    lat: number;
    lon: number;
  };
  difficulty: PracticeDifficultyLabel;
  questionCount: number;
  durationMin: number;
  skills: string[];
  websiteUrl?: string;
  isTargetCompany: boolean;
  active: boolean;
  quickStartPayload: QuickStartPayload;
}

/** Comprehensive AI interview preparation guide */
export interface CompanyPrepGuide {
  companyId: string;
  companyName: string;
  domain: string;
  candidateRole: string;
  experienceLevel: string;
  overview?: string;
  interviewRounds: Array<{
    roundNumber: number;
    name: string;
    focus: string;
    durationMin: number;
  }>;
  keyCompetencies: string[];
  culturalValues: string[];
  sampleQuestions: Array<{
    question: string;
    category: string;
    difficulty: string;
  }>;
  recommendedInterviewMode: InterviewMode;
  recommendedDifficulty: InterviewDifficulty;
  suggestedTechnologies: string[];
  generatedAt?: string;
}

/** Raw Geoapify place properties */
export interface GeoapifyPlaceProperties {
  place_id?: string;
  name?: string;
  categories?: string[];
  country?: string;
  country_code?: string;
  state?: string;
  city?: string;
  street?: string;
  postcode?: string;
  formatted?: string;
  address_line1?: string;
  address_line2?: string;
  website?: string;
  contact?: {
    phone?: string;
    email?: string;
  };
  distance?: number;
  lat?: number;
  lon?: number;
  datasource?: {
    sourcename?: string;
    raw?: Record<string, unknown>;
  };
}

export interface GeoapifyFeature {
  type: string;
  properties: GeoapifyPlaceProperties;
  geometry?: {
    type: string;
    coordinates: [number, number];
  };
}

export interface GeoapifyPlacesResponse {
  type: string;
  features?: GeoapifyFeature[];
}

export interface GeoapifyGeocodeResult {
  lat: number;
  lon: number;
  formatted: string;
  city?: string;
  state?: string;
  country?: string;
}

export interface GeoapifyGeocodeResponse {
  type: string;
  features?: Array<{
    properties?: {
      lat?: number;
      lon?: number;
      formatted?: string;
      city?: string;
      state?: string;
      country?: string;
      suburb?: string;
      county?: string;
      district?: string;
    };
    geometry?: {
      type: string;
      coordinates: [number, number];
    };
  }>;
}
