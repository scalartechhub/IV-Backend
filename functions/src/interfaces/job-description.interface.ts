export interface JobSalary {
  min: number;
  max: number;
  currency: 'USD' | 'INR' | string;
  period?: 'LPA' | 'hour' | 'month' | 'year' | string;
}

export interface JobScreeningQuestion {
  id: string;
  questionText: string;
  type: 'numeric' | 'text' | 'choice';
  placeholder: string;
  options?: string[];
  required?: boolean;
}

export interface JobHiringStep {
  stepNumber: number;
  title: string;
  subtitle: string;
  duration: string;
  description: string;
  iconName?: string;
}

export interface RegionLocationGroup {
  region: string;
  countries: string[];
}

export interface JobDescription {
  id?: string;
  title: string;
  companyName: string;
  companyLogoUrl?: string;
  companyWebsite?: string;
  companyDescription?: string;
  domain: string;
  roleType: string;
  jobType: string;
  workHours: string;
  locationType: string;
  locationName: string;
  salary: JobSalary;
  noOfOpenings: number;
  referralRewardAmount: number;
  referralRewardCurrency?: 'USD' | 'INR' | string;
  referralCode?: string;
  postedDate: string;
  status: 'open' | 'urgent' | 'closed';
  requiredSkills: string[];
  preferredSkills?: string[];
  jobSummary: string;
  keyResponsibilities: string[];
  requiredQualifications: string[];
  preferredQualifications: string[];
  whatWeOffer: { title: string; description: string; icon: string }[];
  hiringProcess: JobHiringStep[];
  eligibleLocations: RegionLocationGroup[];
  screeningQuestions: JobScreeningQuestion[];

  // Optional new extensions
  companyId?: string;
  domainId?: string;
  roleId?: string;
  isUrgent?: boolean;
  source?: 'MANUAL' | 'AI_GENERATED' | 'IMPORTED';
  
  // Metadata
  createdAt?: string;
  updatedAt?: string;
}
