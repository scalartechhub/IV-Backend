/**
 * Companies Service:
 * - Fetches nearest companies using Geoapify Places API directly matching the candidate's currentRole.
 * - Extracts currentRole from users/{uid} document in Firestore.
 * - Sorts companies strictly by nearest distance (km).
 * - Enforces top 20 nearest companies limit.
 * - Persists discovered companies into Firestore companies collection.
 */

import { FieldValue } from 'firebase-admin/firestore';
import type { PracticeDifficultyLabel } from '../../interfaces/practice.interface';
import type { InterviewDifficulty } from '../../interfaces/interview.interface';
import type { UserDoc } from '../../interfaces/user.interface';
import { logger } from '../../shared/logger';
import { ensureAdmin } from '../../utils/callable-auth';
import { companyRef, userRef } from '../../utils/firestore-refs';
import type {
  GeoapifyPlaceProperties,
  NearbyCompanyItem,
  NearbyCompanyQuery,
} from './companies.types';
import { geoapifyClient } from './geoapify.client';


/** Normalizes strings into URL-safe slugs */
export function slugify(text: string): string {
  return (text || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'company';
}

/** Normalizes and removes legal entity suffixes, branch tags, and punctuation */
export function cleanCompanyName(rawName: string): string {
  if (!rawName) return '';
  return rawName
    .replace(/\(.*?\)/g, '')
    .replace(/\b(Pvt|Private|Ltd|Limited|LLC|Inc|Corp|Corporation|GmbH|Co|LLP|PLC)\b\.?/gi, '')
    .replace(/\b(Branch|Unit\s*\d+|Campus|Tower\s*[A-Z\d]+|Block\s*[A-Z\d]+|Office)\b/gi, '')
    .replace(/[-–—,].*$/, '')
    .replace(/[.,/\\-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Generates a deterministic slug for a company */
export function generateCompanySlug(name: string, city?: string): string {
  const base = slugify(name);
  const cityPart = city ? `-${slugify(city)}` : '';
  return `${base}${cityPart}`.slice(0, 60);
}

/** Infers official domain for common corporate employers if Geoapify didn't provide website */
export function inferCompanyDomain(name: string): string {
  const n = name.toLowerCase().trim();
  if (n.includes('tata consultancy') || n.includes('tcs')) return 'tcs.com';
  if (n.includes('infosys')) return 'infosys.com';
  if (n.includes('wipro')) return 'wipro.com';
  if (n.includes('persistent')) return 'persistent.com';
  if (n.includes('cognizant')) return 'cognizant.com';
  if (n.includes('accenture')) return 'accenture.com';
  if (n.includes('capgemini')) return 'capgemini.com';
  if (n.includes('hcl')) return 'hcltech.com';
  if (n.includes('tech mahindra')) return 'techmahindra.com';
  if (n.includes('oracle')) return 'oracle.com';
  if (n.includes('microsoft')) return 'microsoft.com';
  if (n.includes('google') || n.includes('alphabet')) return 'google.com';
  if (n.includes('amazon') || n.includes('aws')) return 'amazon.com';
  if (n.includes('apple')) return 'apple.com';
  if (n.includes('meta') || n.includes('facebook')) return 'meta.com';
  if (n.includes('netflix')) return 'netflix.com';
  if (n.includes('cisco')) return 'cisco.com';
  if (n.includes('ibm')) return 'ibm.com';
  if (n.includes('intel')) return 'intel.com';
  if (n.includes('nvidia')) return 'nvidia.com';
  if (n.includes('deloitte')) return 'deloitte.com';
  if (n.includes('ey ') || n.includes('ernst & young')) return 'ey.com';
  if (n.includes('pwc') || n.includes('pricewaterhouse')) return 'pwc.com';
  if (n.includes('kpmg')) return 'kpmg.com';
  if (n.includes('red hat') || n.includes('redhat')) return 'redhat.com';
  if (n.includes('adobe')) return 'adobe.com';
  if (n.includes('salesforce')) return 'salesforce.com';
  if (n.includes('spotify')) return 'spotify.com';
  if (n.includes('uber')) return 'uber.com';
  if (n.includes('airbnb')) return 'airbnb.com';
  if (n.includes('stripe')) return 'stripe.com';
  if (n.includes('paypal')) return 'paypal.com';
  if (n.includes('linkedin')) return 'linkedin.com';
  if (n.includes('github')) return 'github.com';
  if (n.includes('gitlab')) return 'gitlab.com';
  if (n.includes('atlassian')) return 'atlassian.com';
  if (n.includes('zoho')) return 'zoho.com';
  if (n.includes('swiggy')) return 'swiggy.com';
  if (n.includes('zomato')) return 'zomato.com';
  if (n.includes('flipkart')) return 'flipkart.com';
  if (n.includes('razorpay')) return 'razorpay.com';
  if (n.includes('paytm')) return 'paytm.com';
  if (n.includes('phonepe')) return 'phonepe.com';
  if (n.includes('cred')) return 'cred.club';
  if (n.includes('zerodha')) return 'zerodha.com';
  if (n.includes('jio')) return 'jio.com';
  if (n.includes('airtel')) return 'airtel.in';
  if (n.includes('sap')) return 'sap.com';
  if (n.includes('siemens')) return 'siemens.com';
  if (n.includes('goldman')) return 'goldmansachs.com';
  if (n.includes('jpmorgan') || n.includes('jp morgan') || n.includes('chase')) return 'jpmorganchase.com';
  if (n.includes('morgan stanley')) return 'morganstanley.com';

  const domainMatch = n.match(/[a-z0-9-]+\.(com|in|org|net|io|ai|co|tech)/);
  if (domainMatch) return domainMatch[0];

  const cleaned = n
    .replace(/\b(pvt|private|ltd|limited|technologies|solutions|infotech|services|india|llc|inc|corp)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();

  return cleaned.length >= 3 ? `${cleaned}.com` : '';
}

/** Generates high-res company logo URL using Logo.dev or Simple Icons */
export function getCompanyLogoUrl(name: string, websiteUrl?: string): string {
  let domain = '';
  if (websiteUrl) {
    try {
      const parsed = new URL(websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`);
      domain = parsed.hostname.replace(/^www\./, '');
    } catch {
      domain = websiteUrl.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '').trim();
    }
  }

  if (!domain || !domain.includes('.')) {
    domain = inferCompanyDomain(name);
  }

  if (domain && domain.includes('.')) {
    return `https://img.logo.dev/${encodeURIComponent(domain)}?token=pk_JJFsSCPIQdSpxyNoU6WfjA&size=80&format=png&fallback=404`;
  }

  return `https://cdn.simpleicons.org/${slugify(name)}`;
}

/** Non-hiring or non-corporate place keywords to exclude */
const EXCLUDED_NAME_PATTERNS = [
  'school',
  'college',
  'academy',
  'classes',
  'tuition',
  'vidyalaya',
  'shikshan',
  'kindergarten',
  'preschool',
  'petrol',
  'pump',
  'cng',
  'municipal',
  'panchayat',
  'police',
  'rto office',
  'notary',
  'quarry',
  'mining',
  'cement',
];

/** Selects relevant Geoapify Place categories directly from the candidate's currentRole */
function resolveCategoriesForRole(role: string): string[] {
  const r = role.toLowerCase();
  if (r.includes('doctor') || r.includes('nurse') || r.includes('hospital') || r.includes('clinic') || r.includes('medical') || r.includes('pharma')) {
    return ['healthcare.hospital', 'healthcare.clinic_or_praxis', 'office.company'];
  }
  // Corporate, software, IT, tech, engineering, finance, consulting, design, business
  return [
    'office.company',
    'office.it',
    'office.telecommunication',
    'office.financial',
    'office.consulting',
    'office.logistics',
    'office.architect',
  ];
}

/** Checks if a place is a genuine corporate or workplace entity */
function isGenuineWorkplace(place: GeoapifyPlaceProperties, cleanedName: string, role: string): boolean {
  const nameLower = cleanedName.toLowerCase();
  const addrLower = (place.formatted || '').toLowerCase();
  const cats = (place.categories || []).map((c) => c.toLowerCase());

  // Filter out educational institutes, government service desks, gas stations, etc.
  for (const pattern of EXCLUDED_NAME_PATTERNS) {
    if (nameLower.includes(pattern) || addrLower.includes(pattern)) {
      return false;
    }
  }

  // If candidate is in IT/Software/Engineering/Corporate, exclude clinics or hospitals
  const isMedicalRole = role.toLowerCase().includes('doctor') || role.toLowerCase().includes('nurse') || role.toLowerCase().includes('medical');
  if (!isMedicalRole && (cats.some((c) => c.startsWith('healthcare')) || nameLower.includes('hospital') || nameLower.includes('clinic'))) {
    return false;
  }

  return true;
}

/**
 * Main service method:
 * - Reads currentRole directly from users/{uid} document in Firestore.
 * - Queries Geoapify Places API for nearest workplaces.
 * - Sorts strictly by nearest distance (km).
 * - Returns top 20 nearest companies.
 */
export async function getNearbyCompanies(
  uid: string,
  query: NearbyCompanyQuery,
): Promise<{
  companies: NearbyCompanyItem[];
  total: number;
  role: string;
  domain: string;
  location: string;
}> {
  const db = ensureAdmin();

  // 1. Fetch user document from Firestore to extract currentRole, location, targetCompanies
  let currentRole = 'Software Developer';
  let profileLocation = '';
  let targetCompanies: string[] = [];

  try {
    const userSnap = await userRef(db, uid).get();
    if (userSnap.exists) {
      const user = userSnap.data() as UserDoc | undefined;
      const profile = user?.profile;
      const onboarding = user?.onboarding;

      // Check currentRole directly on users/{uid} document first, then profile, then onboarding
      currentRole =
        user?.currentRole?.trim() ||
        profile?.currentRole?.trim() ||
        onboarding?.selectedRole?.trim() ||
        profile?.targetRole?.trim() ||
        'Software Developer';

      profileLocation = profile?.location?.trim() || '';
      targetCompanies = profile?.targetCompanies || [];

      logger.info('[companies.service] Resolved candidate currentRole from users/{uid}', {
        uid,
        currentRole,
        profileLocation,
      });
    }
  } catch (err) {
    logger.warn('[companies.service] Could not fetch user doc for profile defaults', { err, uid });
  }

  // Effective role priority: query.role (explicit client override) > user.currentRole
  const effectiveRole = (query.role?.trim() || currentRole).trim();
  const radiusKm = query.radiusKm && query.radiusKm > 0 ? query.radiusKm : 25;

  // 2. Resolve Place Categories directly from effectiveRole
  const placeCategories = resolveCategoriesForRole(effectiveRole);

  // 3. Current GPS Location: strictly use user's current coordinates (no other location fallback)
  const lat = query.lat;
  const lon = query.lon;

  if (lat === undefined || lon === undefined || Number.isNaN(lat) || Number.isNaN(lon)) {
    return {
      companies: [],
      total: 0,
      role: effectiveRole,
      domain: effectiveRole,
      location: '',
    };
  }

  let locationLabel = (await geoapifyClient.reverseGeocode(lat, lon)) || '';

  // 4. Query Geoapify Places API around user's current coordinates
  const radiusMeters = radiusKm * 1000;
  const places = await geoapifyClient.fetchNearbyPlaces({
    lat,
    lon,
    radiusMeters,
    categories: placeCategories,
    limit: 50,
  });

  // Fallback to closest place city if reverse geocode didn't return a name
  if (!locationLabel) {
    const firstCity = places.find((p) => Boolean(p.city))?.city;
    locationLabel = firstCity || 'Current Location';
  }

  // 5. Clean, Deduplicate & Score Nearby Companies
  const seenRoots = new Set<string>();
  const scoredItems: NearbyCompanyItem[] = [];

  for (const place of places) {
    const rawName = place.name?.trim() || '';
    if (!rawName) continue;

    const cleanedName = cleanCompanyName(rawName);
    if (!cleanedName || cleanedName.length < 2) continue;

    const rootKey = cleanedName.toLowerCase();
    if (seenRoots.has(rootKey)) continue; // Keep nearest branch only

    // Filter non-corporate / non-hiring entities
    if (!isGenuineWorkplace(place, cleanedName, effectiveRole)) continue;

    seenRoots.add(rootKey);

    const distanceKm =
      place.distance !== undefined
        ? Math.round((place.distance / 1000) * 10) / 10
        : Math.round((radiusKm * 0.4) * 10) / 10;

    const city = place.city || locationLabel || '';
    const slug = generateCompanySlug(cleanedName, city);
    const logoUrl = getCompanyLogoUrl(cleanedName, place.website);

    const difficulty: PracticeDifficultyLabel = distanceKm <= 5 ? 'Hard' : distanceKm <= 15 ? 'Medium' : 'Easy';
    const interviewDiff: InterviewDifficulty = difficulty.toLowerCase() as InterviewDifficulty;

    const item: NearbyCompanyItem = {
      id: slug,
      name: cleanedName,
      slug,
      logoUrl,
      domain: effectiveRole,
      matchingRole: effectiveRole,
      relevanceScore: 92,
      roleFitSummary: `Hiring for ${effectiveRole} roles.`,
      formattedAddress: place.formatted || `${cleanedName}, ${city}`,
      city,
      state: place.state || '',
      country: place.country || 'India',
      distanceKm,
      coordinates: {
        lat: place.lat ?? lat,
        lon: place.lon ?? lon,
      },
      difficulty,
      questionCount: Math.min(Math.max(Math.round(200 - distanceKm * 4), 60), 250),
      durationMin: 30,
      skills: [effectiveRole],
      websiteUrl: place.website,
      isTargetCompany: targetCompanies.some((tc) => tc.toLowerCase() === cleanedName.toLowerCase()),
      active: true,
      quickStartPayload: {
        companyId: slug,
        company: cleanedName,
        mode: 'conversational',
        difficulty: interviewDiff,
        role: effectiveRole,
        durationMinutes: 30,
      },
    };

    scoredItems.push(item);
  }

  // 6. Sort STRICTLY by nearest distance (distanceKm ascending)
  scoredItems.sort((a, b) => a.distanceKm - b.distanceKm);

  // 7. Enforce top 20 nearest companies limit
  const nearest20Companies = scoredItems.slice(0, 20);

  // 8. Persist newly discovered companies to Firestore companies/{id}
  if (nearest20Companies.length > 0) {
    try {
      const batch = db.batch();
      for (let i = 0; i < nearest20Companies.length; i++) {
        const comp = nearest20Companies[i];
        const docRef = companyRef(db, comp.id);
        batch.set(
          docRef,
          {
            name: comp.name,
            slug: comp.slug,
            logoUrl: comp.logoUrl,
            questionCount: comp.questionCount,
            difficulty: comp.difficulty,
            tags: [comp.slug, slugify(effectiveRole)],
            active: true,
            sortOrder: i + 1,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
      await batch.commit();
      logger.info('[companies.service] Committed nearest companies batch to Firestore', {
        count: nearest20Companies.length,
      });
    } catch (batchErr) {
      logger.warn('[companies.service] Batch write to Firestore companies failed', { batchErr });
    }
  }

  return {
    companies: nearest20Companies,
    total: nearest20Companies.length,
    role: effectiveRole,
    domain: effectiveRole,
    location: locationLabel,
  };
}
