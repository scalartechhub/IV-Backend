import { aiService } from '../ai/ai.service';
import { db } from '../../config/firebase';
import { buildJobDescriptionAnalysisPrompt } from './job-description-analysis.prompt';
import type { JobDescription } from '../../interfaces/job-description.interface';
import { AppError } from '../../shared/utils';
import { v4 as uuidv4 } from 'uuid';

export async function createJobDescriptionAnalysis(jdText: string): Promise<JobDescription> {
  if (!jdText || jdText.trim().length < 50) {
    throw new AppError(400, 'Please provide a valid job description text of at least 50 characters.');
  }

  // 1. Construct prompt
  const prompt = buildJobDescriptionAnalysisPrompt(jdText);

  // 2. Call AI service to generate JSON matching the interface
  const parsedData = await aiService.generateJSON<Partial<JobDescription>>(prompt, {
    maxOutputTokens: 4096,
    temperature: 0.2,
  });

  // 3. Ensure defaults and create full object
  const newJdId = uuidv4();
  const now = new Date().toISOString();

  const jd: JobDescription = {
    id: newJdId,
    title: parsedData.title || 'Untitled Job',
    companyName: parsedData.companyName || '',
    companyLogoUrl: parsedData.companyLogoUrl || '',
    companyWebsite: parsedData.companyWebsite || '',
    companyDescription: parsedData.companyDescription || '',
    domain: parsedData.domain || '',
    roleType: parsedData.roleType || '',
    jobType: parsedData.jobType || '',
    workHours: parsedData.workHours || '',
    locationType: parsedData.locationType || '',
    locationName: parsedData.locationName || '',
    salary: parsedData.salary || { min: 0, max: 0, currency: 'USD', period: 'year' },
    noOfOpenings: parsedData.noOfOpenings || 1,
    referralRewardAmount: parsedData.referralRewardAmount || 0,
    referralRewardCurrency: parsedData.referralRewardCurrency || 'USD',
    referralCode: parsedData.referralCode || '',
    status: parsedData.status === 'urgent' ? 'urgent' : 'open',
    requiredSkills: Array.isArray(parsedData.requiredSkills) ? parsedData.requiredSkills : [],
    preferredSkills: Array.isArray(parsedData.preferredSkills) ? parsedData.preferredSkills : [],
    jobSummary: parsedData.jobSummary || '',
    keyResponsibilities: Array.isArray(parsedData.keyResponsibilities) ? parsedData.keyResponsibilities : [],
    requiredQualifications: Array.isArray(parsedData.requiredQualifications) ? parsedData.requiredQualifications : [],
    preferredQualifications: Array.isArray(parsedData.preferredQualifications) ? parsedData.preferredQualifications : [],
    whatWeOffer: Array.isArray(parsedData.whatWeOffer) ? parsedData.whatWeOffer : [],
    hiringProcess: Array.isArray(parsedData.hiringProcess) ? parsedData.hiringProcess : [],
    eligibleLocations: Array.isArray(parsedData.eligibleLocations) ? parsedData.eligibleLocations : [],
    screeningQuestions: Array.isArray(parsedData.screeningQuestions) ? parsedData.screeningQuestions : [],
    source: 'AI_GENERATED',
    postedDate: now,
    createdAt: now,
    updatedAt: now,
  };

  // 4. Save to Firestore (Collection: jobDescription)
  const docRef = db.collection('jobDescription').doc(newJdId);
  await docRef.set(jd);

  // 5. Return the full JD back to caller
  return jd;
}
