/**
 * Zod schemas for resume onboarding plan validation.
 */

import { z } from 'zod';

const prioritySchema = z.enum(['High', 'Medium', 'Low']);
const skillLevelSchema = z.enum(['Beginner', 'Intermediate', 'Advanced', 'Expert']);
const resourceTypeSchema = z.enum([
  'Official Docs',
  'Course',
  'Book',
  'YouTube',
  'Practice Platform',
  'GitHub',
]);

export const careerPathTopicSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  priority: prioritySchema,
  estimatedHours: z.number(),
  completed: z.boolean(),
  order: z.number(),
});

export const recommendedCompanySchema = z.object({
  name: z.string().min(1),
  website: z.string().min(1),
  reason: z.string().min(1),
  skills: z.array(z.string().min(1)).min(2).max(5),
  priority: z.number(),
});

export const recommendedSessionSkillSchema = z.object({
  name: z.string().min(1),
  subskills: z.array(z.string().min(1)).min(2).max(5),
});

export const skillGapItemSchema = z.object({
  name: z.string().min(1),
  currentLevel: skillLevelSchema,
  targetLevel: skillLevelSchema,
  priority: prioritySchema,
  reason: z.string().min(1),
  estimatedHours: z.number(),
});

export const learningRoadmapWeekSchema = z.object({
  week: z.number(),
  title: z.string().min(1),
  topics: z.array(z.string()),
  hours: z.number(),
  goal: z.string().min(1),
  checkpoint: z.string().min(1),
  mockInterview: z.string().min(1),
});

export const interviewPrepCategorySchema = z.object({
  category: z.string().min(1),
  questionsCount: z.number(),
  priority: prioritySchema,
  recommendation: z.string().min(1),
});

export const recommendedProjectSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  skills: z.array(z.string()),
  estimatedHours: z.number(),
  priority: prioritySchema,
});

export const recommendedCertificationSchema = z.object({
  name: z.string().min(1),
  provider: z.string().min(1),
  reason: z.string().min(1),
  priority: prioritySchema,
});

export const recommendedResourceSchema = z.object({
  title: z.string().min(1),
  type: resourceTypeSchema,
  url: z.string().optional(),
  reason: z.string().min(1),
});

export const marketReadinessScoreSchema = z.object({
  overallScore: z.number().min(0).max(100),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  hiringReadiness: z.string().min(1),
  expectedSalaryBand: z.string().optional(),
});

export const nextActionSchema = z.object({
  order: z.number(),
  action: z.string().min(1),
  priority: prioritySchema,
  estimatedHours: z.number().optional(),
});

export const resumeOnboardingPlanSchema = z.object({
  careerPath: z.array(careerPathTopicSchema).min(10).max(30),
  recommendedCompanies: z.array(recommendedCompanySchema).min(1).max(10),
  recommendedSessions: z.array(recommendedSessionSkillSchema).min(1).max(10),
  skillGapAnalysis: z.array(skillGapItemSchema).min(5),
  learningRoadmap: z.array(learningRoadmapWeekSchema).min(4).max(8),
  interviewPreparation: z.array(interviewPrepCategorySchema).min(5),
  recommendedInterviewTracks: z.array(z.string()).min(1),
  recommendedLearningTechnologies: z.array(z.string().min(1)).min(3).max(12),
  resumeStrengthSummary: z.string().min(1),
  priorityPreparationAreas: z.array(z.string()).min(1),
  estimatedPreparationWeeks: z.number().min(1).max(52),
  confidencePrediction: z.number().min(0).max(100),
  industryRecommendation: z.string().min(1),
  jobRoleRecommendation: z.string().min(1),
  experienceLevelPrediction: z.string().min(1),
  resumeCompleteness: z.number().min(0).max(100),
  marketReadinessScore: marketReadinessScoreSchema,
  recommendedProjects: z.array(recommendedProjectSchema).min(3).max(10),
  recommendedCertifications: z.array(recommendedCertificationSchema).min(1).max(5),
  recommendedResources: z.array(recommendedResourceSchema).min(1),
  nextActions: z.array(nextActionSchema).min(1).max(10),
});

export type ResumeOnboardingPlanParsed = z.infer<typeof resumeOnboardingPlanSchema>;
