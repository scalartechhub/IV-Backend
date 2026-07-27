// Practice catalog — companies + templates for /practice UI
import type { Timestamp } from 'firebase-admin/firestore';
import type { InterviewDifficulty, InterviewMode } from './interview.interface';

export type PracticeDifficultyLabel = 'Easy' | 'Medium' | 'Hard';

/** Path: companies/{companyId} */
export interface CompanyDoc {
  name: string;
  slug: string;
  logoUrl?: string;
  questionCount: number;
  difficulty: PracticeDifficultyLabel;
  tags: string[];
  active: boolean;
  sortOrder: number;
  updatedAt?: Timestamp;
}

/** Defaults applied when starting an interview from a template */
export interface PracticeTemplateConfigDefaults {
  topic: string;
  company?: string;
  skills: string[];
  technologies: string[];
  difficulty: InterviewDifficulty;
  durationMinutes: number;
}

/** Path: practiceTemplates/{templateId} */
export interface PracticeTemplateDoc {
  title: string;
  categoryId: string;
  categoryLabel: string;
  durationMin: number;
  questionCount: number;
  difficulty: InterviewDifficulty;
  xpRewardHint: number;
  mode: InterviewMode;
  configDefaults: PracticeTemplateConfigDefaults;
  tags: string[];
  active: boolean;
  sortOrder: number;
  recommendedForRoles?: string[];
  updatedAt?: Timestamp;
}

/** Path: practiceCategories/{categoryId} — optional remote tabs */
export interface PracticeCategoryDoc {
  label: string;
  sortOrder: number;
  active: boolean;
}
