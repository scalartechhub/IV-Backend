/**
 * Career domain and role mapping definitions for OpenStreetMap discovery.
 * Supports all career domains across the platform.
 */

import { CareerDomainMapping } from '../company.types';

export const GENERIC_CAREER_MAPPING: CareerDomainMapping = {
  domainKeywords: ['business', 'company', 'office', 'services', 'enterprise', 'consulting'],
  osmTags: ['office=company', 'office=consulting', 'building=office', 'office=commercial'],
  categories: ['business', 'commercial'],
  roles: {},
};

export const CAREER_DOMAIN_MAPPINGS: Record<string, CareerDomainMapping> = {
  'information-technology': {
    domainKeywords: [
      'software',
      'technology',
      'IT',
      'tech',
      'computer',
      'systems',
      'informatics',
      'digital',
      'information technology',
      'IT services',
    ],
    osmTags: ['office=it', 'office=company', 'office=consulting', 'building=office'],
    categories: ['technology', 'software', 'it_services'],
    roles: {
      'it-software-engineer': {
        roleKeywords: ['software', 'software development', 'computer programming', 'systems', 'tech solutions', 'application development'],
        osmTags: ['office=it', 'office=company', 'office=consulting'],
      },
      'it-frontend-developer': {
        roleKeywords: ['frontend', 'web development', 'ui/ux', 'web design', 'software', 'technology', 'web solutions'],
        osmTags: ['office=it', 'office=company', 'office=consulting'],
      },
      'it-backend-developer': {
        roleKeywords: ['backend', 'software development', 'api', 'cloud services', 'database systems', 'technology'],
        osmTags: ['office=it', 'office=company', 'office=consulting'],
      },
      'it-fullstack-developer': {
        roleKeywords: ['full stack', 'web development', 'software engineering', 'internet technologies', 'it solutions'],
        osmTags: ['office=it', 'office=company', 'office=consulting'],
      },
      'it-data-scientist': {
        roleKeywords: ['data science', 'analytics', 'artificial intelligence', 'machine learning', 'data solutions', 'research'],
        osmTags: ['office=it', 'office=research', 'office=consulting'],
      },
      'it-devops-engineer': {
        roleKeywords: ['devops', 'cloud infrastructure', 'hosting', 'datacenter', 'network services', 'system integration'],
        osmTags: ['office=it', 'office=telecommunication', 'office=company'],
      },
      'it-cloud-engineer': {
        roleKeywords: ['cloud', 'cloud services', 'hosting', 'infrastructure', 'server technology', 'it consulting'],
        osmTags: ['office=it', 'office=company', 'office=telecommunication'],
      },
      'it-qa-engineer': {
        roleKeywords: ['quality assurance', 'testing', 'software testing', 'it solutions', 'compliance'],
        osmTags: ['office=it', 'office=company', 'office=consulting'],
      },
      'angular-developer': {
        roleKeywords: ['angular', 'frontend', 'web development', 'software', 'technology', 'software development', 'it services'],
        osmTags: ['office=it', 'office=company', 'office=consulting', 'building=office'],
      },
      'react-developer': {
        roleKeywords: ['react', 'frontend', 'web development', 'software', 'technology', 'web applications', 'it consulting'],
        osmTags: ['office=it', 'office=company', 'office=consulting', 'building=office'],
      },
      'node-js-developer': {
        roleKeywords: ['node', 'backend', 'server', 'software development', 'api services', 'it solutions'],
        osmTags: ['office=it', 'office=company', 'office=consulting', 'building=office'],
      },
    },
  },

  'civil-engineering': {
    domainKeywords: [
      'construction',
      'civil engineering',
      'infrastructure',
      'contractor',
      'builders',
      'developers',
      'real estate',
      'civil',
      'surveying',
    ],
    osmTags: ['office=company', 'office=consulting', 'craft=builder', 'building=office'],
    categories: ['construction', 'engineering', 'infrastructure'],
    roles: {
      'civil-engineer': {
        roleKeywords: ['construction', 'civil engineering', 'infrastructure', 'contractor', 'builders', 'civil works'],
        osmTags: ['office=company', 'office=consulting', 'craft=builder', 'building=office'],
      },
      'structural-engineer': {
        roleKeywords: ['structural engineering', 'structural design', 'building construction', 'consulting engineering'],
        osmTags: ['office=consulting', 'office=company', 'building=office'],
      },
      'site-engineer': {
        roleKeywords: ['site construction', 'contractor', 'project construction', 'building construction'],
        osmTags: ['craft=builder', 'office=company', 'building=office'],
      },
      'architect': {
        roleKeywords: ['architecture', 'architectural design', 'urban planning', 'interior design', 'building design'],
        osmTags: ['office=architect', 'office=company', 'office=consulting'],
      },
    },
  },

  'mechanical-engineering': {
    domainKeywords: [
      'mechanical',
      'engineering',
      'manufacturing',
      'machinery',
      'industrial',
      'fabrication',
      'precision engineering',
      'automation',
    ],
    osmTags: ['office=company', 'office=consulting', 'craft=*', 'building=office'],
    categories: ['mechanical', 'manufacturing', 'industrial'],
    roles: {
      'mechanical-engineer': {
        roleKeywords: ['mechanical engineering', 'machinery', 'manufacturing', 'industrial equipment', 'mechanical design'],
        osmTags: ['office=company', 'office=consulting', 'craft=*'],
      },
      'automotive-engineer': {
        roleKeywords: ['automotive', 'vehicle design', 'powertrain', 'automobile engineering', 'motors'],
        osmTags: ['office=company', 'shop=car_repair', 'office=consulting'],
      },
      'hvac-engineer': {
        roleKeywords: ['hvac', 'refrigeration', 'cooling systems', 'ventilation', 'climate control'],
        osmTags: ['craft=hvac', 'office=company', 'office=consulting'],
      },
    },
  },

  healthcare: {
    domainKeywords: [
      'hospital',
      'clinic',
      'healthcare',
      'medical center',
      'health services',
      'doctor',
      'nursing',
      'wellness',
      'clinical',
    ],
    osmTags: ['amenity=hospital', 'amenity=clinic', 'amenity=doctors', 'amenity=healthcare', 'amenity=nursing_home'],
    categories: ['healthcare', 'medical', 'clinical'],
    roles: {
      nurse: {
        roleKeywords: ['hospital', 'clinic', 'healthcare', 'nursing home', 'medical center', 'patient care', 'healthcare organization'],
        osmTags: ['amenity=hospital', 'amenity=clinic', 'amenity=doctors', 'amenity=healthcare', 'amenity=nursing_home'],
      },
      doctor: {
        roleKeywords: ['hospital', 'clinic', 'medical center', 'specialty clinic', 'health clinic', 'physician'],
        osmTags: ['amenity=hospital', 'amenity=clinic', 'amenity=doctors', 'amenity=healthcare'],
      },
      pharmacist: {
        roleKeywords: ['pharmacy', 'chemist', 'drug store', 'pharmaceutical dispensary', 'medical store'],
        osmTags: ['amenity=pharmacy', 'amenity=hospital', 'amenity=clinic'],
      },
      physiotherapist: {
        roleKeywords: ['physiotherapy', 'rehabilitation center', 'physical therapy', 'sports clinic', 'wellness clinic'],
        osmTags: ['amenity=clinic', 'amenity=healthcare', 'amenity=hospital'],
      },
    },
  },

  finance: {
    domainKeywords: [
      'finance',
      'accounting',
      'financial services',
      'banking',
      'investment',
      'wealth management',
      'taxation',
      'advisory',
      'consulting',
    ],
    osmTags: ['office=accountant', 'office=financial', 'office=consulting', 'amenity=bank'],
    categories: ['finance', 'accounting', 'financial_services'],
    roles: {
      accountant: {
        roleKeywords: ['accounting', 'accountant', 'chartered accountant', 'finance', 'tax consultant', 'consulting', 'audit firm'],
        osmTags: ['office=accountant', 'office=financial', 'office=consulting', 'amenity=bank'],
      },
      'chartered-accountant': {
        roleKeywords: ['chartered accountant', 'ca firm', 'auditing', 'taxation services', 'financial consulting', 'accounting'],
        osmTags: ['office=accountant', 'office=financial', 'office=consulting'],
      },
      'financial-analyst': {
        roleKeywords: ['financial analysis', 'investment', 'capital markets', 'securities', 'asset management', 'financial advisory'],
        osmTags: ['office=financial', 'office=consulting', 'amenity=bank'],
      },
      'tax-consultant': {
        roleKeywords: ['taxation', 'tax consulting', 'gst consultant', 'income tax', 'financial advisory'],
        osmTags: ['office=accountant', 'office=financial', 'office=consulting'],
      },
    },
  },

  education: {
    domainKeywords: [
      'school',
      'college',
      'university',
      'education',
      'academy',
      'institute',
      'learning center',
      'training center',
    ],
    osmTags: ['amenity=school', 'amenity=college', 'amenity=university', 'amenity=kindergarten', 'office=educational_institution'],
    categories: ['education', 'academic', 'training'],
    roles: {
      teacher: {
        roleKeywords: ['school', 'college', 'university', 'training institute', 'education center', 'high school', 'academy'],
        osmTags: ['amenity=school', 'amenity=college', 'amenity=university', 'amenity=kindergarten'],
      },
      professor: {
        roleKeywords: ['university', 'college', 'higher education', 'institute of technology', 'research academy'],
        osmTags: ['amenity=university', 'amenity=college'],
      },
      counselor: {
        roleKeywords: ['guidance academy', 'career counseling', 'coaching institute', 'educational consultancy'],
        osmTags: ['amenity=college', 'office=educational_institution', 'office=consulting'],
      },
    },
  },

  law: {
    domainKeywords: ['law', 'legal', 'advocate', 'law firm', 'solicitor', 'attorney', 'litigation', 'legal advisory'],
    osmTags: ['office=lawyer', 'office=legal', 'office=consulting', 'amenity=courthouse'],
    categories: ['legal', 'law_firm'],
    roles: {
      lawyer: {
        roleKeywords: ['law firm', 'legal services', 'advocate', 'attorney', 'solicitor', 'legal consultants', 'corporate law'],
        osmTags: ['office=lawyer', 'office=legal', 'office=consulting'],
      },
      'legal-advisor': {
        roleKeywords: ['legal advisory', 'corporate counsel', 'compliance services', 'legal consultant'],
        osmTags: ['office=lawyer', 'office=legal', 'office=consulting'],
      },
      paralegal: {
        roleKeywords: ['law firm', 'legal aid', 'notary services', 'legal documentation'],
        osmTags: ['office=lawyer', 'office=legal'],
      },
    },
  },

  marketing: {
    domainKeywords: ['marketing', 'advertising', 'digital marketing', 'branding', 'media', 'creative agency', 'public relations'],
    osmTags: ['office=advertising_agency', 'office=company', 'office=consulting', 'office=media'],
    categories: ['marketing', 'advertising', 'digital_media'],
    roles: {
      'marketing-executive': {
        roleKeywords: ['marketing agency', 'advertising', 'promotions', 'brand consultancy', 'digital marketing'],
        osmTags: ['office=advertising_agency', 'office=company', 'office=consulting'],
      },
      'digital-marketing-specialist': {
        roleKeywords: ['digital marketing', 'seo agency', 'social media agency', 'performance marketing', 'creative agency'],
        osmTags: ['office=advertising_agency', 'office=company', 'office=it'],
      },
      'brand-manager': {
        roleKeywords: ['brand consulting', 'advertising firm', 'marketing communication', 'creative design'],
        osmTags: ['office=advertising_agency', 'office=consulting', 'office=company'],
      },
    },
  },

  sales: {
    domainKeywords: ['sales', 'commercial', 'business development', 'trading', 'distribution', 'merchandising'],
    osmTags: ['office=company', 'office=commercial', 'office=consulting'],
    categories: ['sales', 'commercial'],
    roles: {
      'sales-executive': {
        roleKeywords: ['corporate sales', 'commercial office', 'trading company', 'distribution center', 'business solutions'],
        osmTags: ['office=company', 'office=commercial', 'office=consulting'],
      },
      'sales-manager': {
        roleKeywords: ['commercial headquarters', 'regional sales office', 'enterprise sales', 'distribution'],
        osmTags: ['office=company', 'office=commercial'],
      },
    },
  },

  'human-resources': {
    domainKeywords: ['human resources', 'recruitment', 'staffing', 'talent acquisition', 'HR consulting', 'manpower'],
    osmTags: ['office=employment_agency', 'office=consulting', 'office=company'],
    categories: ['human_resources', 'recruitment'],
    roles: {
      hr: {
        roleKeywords: ['recruitment agency', 'staffing solutions', 'HR consultancy', 'talent acquisition', 'manpower services'],
        osmTags: ['office=employment_agency', 'office=consulting', 'office=company'],
      },
      'talent-acquisition': {
        roleKeywords: ['executive search', 'headhunters', 'placement agency', 'staffing firm', 'recruitment solutions'],
        osmTags: ['office=employment_agency', 'office=consulting'],
      },
    },
  },

  hospitality: {
    domainKeywords: ['hotel', 'resort', 'hospitality', 'restaurant', 'tourism', 'catering', 'guest house'],
    osmTags: ['tourism=hotel', 'amenity=restaurant', 'amenity=cafe', 'office=travel_agent'],
    categories: ['hospitality', 'tourism', 'accommodation'],
    roles: {
      'hotel-manager': {
        roleKeywords: ['hotel', 'resort', 'hospitality group', 'luxury hotel', 'boutique hotel', 'guest services'],
        osmTags: ['tourism=hotel', 'office=company'],
      },
      chef: {
        roleKeywords: ['restaurant', 'fine dining', 'hotel restaurant', 'culinary center', 'catering company'],
        osmTags: ['amenity=restaurant', 'tourism=hotel'],
      },
    },
  },

  pharma: {
    domainKeywords: ['pharmaceutical', 'biotechnology', 'clinical research', 'drugs', 'life sciences', 'medicines'],
    osmTags: ['amenity=pharmacy', 'office=company', 'amenity=laboratory', 'industrial=pharmaceutical'],
    categories: ['pharmaceutical', 'biotech', 'life_sciences'],
    roles: {
      pharmacist: {
        roleKeywords: ['pharmacy', 'retail pharmacy', 'hospital pharmacy', 'dispensary', 'chemist'],
        osmTags: ['amenity=pharmacy', 'amenity=hospital'],
      },
      biotechnologist: {
        roleKeywords: ['biotech laboratory', 'clinical research', 'pharmaceutical research', 'life sciences institute'],
        osmTags: ['office=company', 'amenity=laboratory'],
      },
    },
  },

  architecture: {
    domainKeywords: ['architecture', 'interior design', 'urban design', 'planning', 'landscape architecture'],
    osmTags: ['office=architect', 'office=company', 'office=consulting'],
    categories: ['architecture', 'design'],
    roles: {
      architect: {
        roleKeywords: ['architectural firm', 'architecture studio', 'interior design firm', 'building design consultancy'],
        osmTags: ['office=architect', 'office=company', 'office=consulting'],
      },
      'interior-designer': {
        roleKeywords: ['interior design studio', 'home decor consulting', 'commercial interior firm'],
        osmTags: ['office=architect', 'office=company'],
      },
    },
  },

  'banking-insurance': {
    domainKeywords: ['bank', 'banking', 'insurance', 'life insurance', 'general insurance', 'mutual funds'],
    osmTags: ['amenity=bank', 'office=insurance', 'office=financial'],
    categories: ['banking', 'insurance'],
    roles: {
      banker: {
        roleKeywords: ['commercial bank', 'retail bank', 'financial institution', 'credit society', 'bank branch'],
        osmTags: ['amenity=bank', 'office=financial'],
      },
      'insurance-agent': {
        roleKeywords: ['insurance agency', 'life insurance branch', 'general insurance office', 'insurance broker'],
        osmTags: ['office=insurance', 'office=financial'],
      },
    },
  },

  retail: {
    domainKeywords: ['retail', 'supermarket', 'department store', 'shopping', 'store', 'consumer goods'],
    osmTags: ['shop=supermarket', 'shop=department_store', 'shop=mall', 'office=company'],
    categories: ['retail', 'shopping'],
    roles: {
      'store-manager': {
        roleKeywords: ['supermarket', 'retail store', 'department store', 'shopping center', 'brand outlet'],
        osmTags: ['shop=supermarket', 'shop=department_store', 'shop=mall'],
      },
    },
  },

  media: {
    domainKeywords: ['media', 'journalism', 'news', 'broadcasting', 'publishing', 'film', 'television', 'entertainment'],
    osmTags: ['office=media', 'office=newspaper', 'office=company'],
    categories: ['media', 'journalism', 'publishing'],
    roles: {
      journalist: {
        roleKeywords: ['newspaper office', 'news channel', 'media house', 'publishing firm', 'digital media portal'],
        osmTags: ['office=media', 'office=newspaper'],
      },
    },
  },

  logistics: {
    domainKeywords: ['logistics', 'supply chain', 'freight', 'transport', 'shipping', 'cargo', 'courier', 'warehouse'],
    osmTags: ['office=logistics', 'office=company'],
    categories: ['logistics', 'supply_chain', 'transport'],
    roles: {
      'logistics-manager': {
        roleKeywords: ['logistics company', 'freight forwarder', 'cargo services', 'supply chain office', 'courier center'],
        osmTags: ['office=logistics', 'office=company'],
      },
    },
  },

  agriculture: {
    domainKeywords: ['agriculture', 'farming', 'agritech', 'agro', 'horticulture', 'fertilizer', 'seeds'],
    osmTags: ['shop=agrarian', 'office=company'],
    categories: ['agriculture', 'farming'],
    roles: {
      agronomist: {
        roleKeywords: ['agritech company', 'agricultural research', 'seed corporation', 'farming cooperative', 'fertilizer company'],
        osmTags: ['shop=agrarian', 'office=company'],
      },
    },
  },

  manufacturing: {
    domainKeywords: ['manufacturing', 'factory', 'industrial', 'production', 'fabrication', 'assembly'],
    osmTags: ['office=company', 'craft=*'],
    categories: ['manufacturing', 'industrial'],
    roles: {
      'plant-manager': {
        roleKeywords: ['manufacturing plant', 'industrial factory', 'production facility', 'fabrication unit'],
        osmTags: ['office=company', 'craft=*'],
      },
    },
  },

  telecommunications: {
    domainKeywords: ['telecommunications', 'telecom', 'cellular', 'broadband', 'wireless', 'network operations'],
    osmTags: ['office=telecommunication', 'office=it', 'office=company'],
    categories: ['telecommunications', 'network'],
    roles: {
      'telecom-engineer': {
        roleKeywords: ['telecom operator', 'network solutions', 'fiber optic provider', 'cellular provider', 'telecom equipment'],
        osmTags: ['office=telecommunication', 'office=it', 'office=company'],
      },
    },
  },

  energy: {
    domainKeywords: ['energy', 'power', 'solar', 'electricity', 'renewable energy', 'utilities'],
    osmTags: ['office=energy_supplier', 'office=company'],
    categories: ['energy', 'utilities', 'power'],
    roles: {
      'solar-engineer': {
        roleKeywords: ['solar energy company', 'renewable energy provider', 'power solutions', 'clean energy'],
        osmTags: ['office=energy_supplier', 'office=company'],
      },
    },
  },

  'real-estate': {
    domainKeywords: ['real estate', 'property', 'realtor', 'housing', 'builders', 'land development'],
    osmTags: ['office=estate_agent', 'office=company', 'office=consulting'],
    categories: ['real_estate', 'property'],
    roles: {
      'real-estate-agent': {
        roleKeywords: ['real estate agency', 'property consultant', 'realtor firm', 'property management'],
        osmTags: ['office=estate_agent', 'office=company'],
      },
    },
  },

  science: {
    domainKeywords: ['science', 'research', 'scientific laboratory', 'r&d', 'analytics'],
    osmTags: ['amenity=laboratory', 'office=research', 'office=company'],
    categories: ['science', 'research'],
    roles: {
      'research-scientist': {
        roleKeywords: ['research institute', 'scientific laboratory', 'testing lab', 'r&d center'],
        osmTags: ['amenity=laboratory', 'office=research', 'office=company'],
      },
    },
  },

  automotive: {
    domainKeywords: ['automotive', 'automobile', 'car', 'vehicles', 'motors', 'dealership'],
    osmTags: ['shop=car_repair', 'shop=car', 'office=company'],
    categories: ['automotive', 'vehicles'],
    roles: {
      'automotive-technician': {
        roleKeywords: ['car service center', 'automotive workshop', 'authorized car dealership', 'vehicle repair'],
        osmTags: ['shop=car_repair', 'shop=car'],
      },
    },
  },

  'public-safety': {
    domainKeywords: ['police', 'fire protection', 'public safety', 'emergency services', 'security'],
    osmTags: ['amenity=police', 'amenity=fire_station', 'office=government'],
    categories: ['public_safety', 'emergency'],
    roles: {
      'police-officer': {
        roleKeywords: ['police station', 'police commissioner office', 'law enforcement', 'traffic police'],
        osmTags: ['amenity=police', 'office=government'],
      },
    },
  },

  government: {
    domainKeywords: ['government', 'public sector', 'municipal corporation', 'civic administration', 'ministry'],
    osmTags: ['office=government', 'amenity=townhall', 'building=public'],
    categories: ['government', 'public_administration'],
    roles: {
      'civil-servant': {
        roleKeywords: ['government department', 'district collector office', 'municipal corporation', 'administrative service'],
        osmTags: ['office=government', 'amenity=townhall'],
      },
    },
  },
};

/**
 * Domain alias mapping for common variations.
 */
export const DOMAIN_ALIASES: Record<string, string> = {
  technology: 'information-technology',
  it: 'information-technology',
  software: 'information-technology',
  engineering: 'civil-engineering',
  construction: 'civil-engineering',
  accounting: 'finance',
  accountancy: 'finance',
  banking: 'banking-insurance',
  insurance: 'banking-insurance',
  medical: 'healthcare',
  medicine: 'healthcare',
  teaching: 'education',
  legal: 'law',
  hr: 'human-resources',
  pharma: 'pharma',
  pharmaceuticals: 'pharma',
};

/**
 * Role alias mapping to standard keys.
 */
export const ROLE_ALIASES: Record<string, string> = {
  'angular-developer': 'angular-developer',
  'react-developer': 'react-developer',
  'node-js-developer': 'node-js-developer',
  'software-engineer': 'it-software-engineer',
  'frontend-developer': 'it-frontend-developer',
  'backend-developer': 'it-backend-developer',
  'fullstack-developer': 'it-fullstack-developer',
  'full-stack-developer': 'it-fullstack-developer',
  'civil-engineer': 'civil-engineer',
  nurse: 'nurse',
  doctor: 'doctor',
  accountant: 'accountant',
  'chartered-accountant': 'chartered-accountant',
  teacher: 'teacher',
  professor: 'professor',
  lawyer: 'lawyer',
  architect: 'architect',
  pharmacist: 'pharmacist',
  'hotel-manager': 'hotel-manager',
  'sales-executive': 'sales-executive',
  'marketing-executive': 'marketing-executive',
  hr: 'hr',
};
