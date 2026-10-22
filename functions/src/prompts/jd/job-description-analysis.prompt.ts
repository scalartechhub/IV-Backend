export function buildJobDescriptionAnalysisPrompt(jdText: string): string {
  return `You are an expert HR and recruitment AI assistant.
Your task is to parse, analyze, and extract structured information from the provided raw Job Description text.

Instructions:
1. Extract the information into a strict JSON format matching the schema below.
2. Ensure you capture arrays for responsibilities, skills, and qualifications.
3. Clean up the text, remove markdown from the actual field values (do not use asterisks or dashes in array items).
4. For salary, attempt to extract a min, max, currency, and period. If not found, use sensible defaults (min: 0, max: 0, currency: 'USD', period: 'year').
5. Set "noOfOpenings" to 1 unless specified.
6. Determine if the status should be 'open' or 'urgent' based on the text. Default to 'open'.
7. For the fields "whatWeOffer", "hiringProcess", "eligibleLocations", and "screeningQuestions", try to extract if present, otherwise return empty arrays.

=== JOB DESCRIPTION TEXT ===
${jdText}
=== END OF TEXT ===

Output pure JSON matching the following TypeScript interface. DO NOT wrap the JSON in markdown blocks like \`\`\`json. Return only the raw JSON string.

interface JobSalary {
  min: number;
  max: number;
  currency: 'USD' | 'INR' | string;
  period?: 'LPA' | 'hour' | 'month' | 'year' | string;
}

interface JobScreeningQuestion {
  questionText: string;
  type: 'numeric' | 'text' | 'choice';
  placeholder: string;
  options?: string[];
  required?: boolean;
}

interface JobHiringStep {
  stepNumber: number;
  title: string;
  subtitle: string;
  duration: string;
  description: string;
  iconName?: string;
}

interface RegionLocationGroup {
  region: string;
  countries: string[];
}

interface JobDescription {
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
}
`;
}
