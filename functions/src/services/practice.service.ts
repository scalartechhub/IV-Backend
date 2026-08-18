/**
 * Practice catalog for /practice UI — companies + recommended session templates.
 * Falls back to built-in defaults when Firestore catalogs are empty (dev-friendly).
 */

import type {
  CompanyDoc,
  PracticeCategoryDoc,
  PracticeTemplateDoc,
} from '../interfaces/practice.interface';
import { AppError } from '../shared/utils';
import { ensureAdmin } from '../utils/callable-auth';
import {
  companiesCol,
  companyRef,
  practiceCategoriesCol,
  practiceTemplateRef,
  practiceTemplatesCol,
  userRef,
} from '../utils/firestore-refs';

export interface PracticeCatalogQuery {
  q?: string;
  categoryId?: string;
}

export interface PracticeCatalogResponse {
  categories: Array<{ id: string; label: string }>;
  companies: Array<{
    id: string;
    name: string;
    questionCount: number;
    difficulty: CompanyDoc['difficulty'];
  }>;
  sessions: Array<{
    id: string;
    category: string;
    durationMin: number;
    title: string;
    questionCount: number;
    difficulty: string;
    xp: number;
  }>;
}

const DEFAULT_CATEGORIES: Array<{ id: string; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'angular', label: 'Angular' },
  { id: 'react', label: 'React' },
  { id: 'node', label: 'Node' },
  { id: 'system-design', label: 'System Design' },
  { id: 'behavioral', label: 'Behavioral' },
  { id: 'qa', label: 'QA' },
  { id: 'manager', label: 'Manager' },
];

const DEFAULT_COMPANIES: Array<CompanyDoc & { id: string }> = [
  {
    id: 'google',
    name: 'Google',
    slug: 'google',
    questionCount: 240,
    difficulty: 'Hard',
    tags: ['google', 'faang'],
    active: true,
    sortOrder: 1,
  },
  {
    id: 'amazon',
    name: 'Amazon',
    slug: 'amazon',
    questionCount: 310,
    difficulty: 'Hard',
    tags: ['amazon', 'faang'],
    active: true,
    sortOrder: 2,
  },
  {
    id: 'microsoft',
    name: 'Microsoft',
    slug: 'microsoft',
    questionCount: 180,
    difficulty: 'Medium',
    tags: ['microsoft'],
    active: true,
    sortOrder: 3,
  },
  {
    id: 'meta',
    name: 'Meta',
    slug: 'meta',
    questionCount: 220,
    difficulty: 'Hard',
    tags: ['meta', 'faang'],
    active: true,
    sortOrder: 4,
  },
  {
    id: 'stripe',
    name: 'Stripe',
    slug: 'stripe',
    questionCount: 90,
    difficulty: 'Hard',
    tags: ['stripe'],
    active: true,
    sortOrder: 5,
  },
  {
    id: 'tcs',
    name: 'TCS',
    slug: 'tcs',
    questionCount: 400,
    difficulty: 'Easy',
    tags: ['tcs'],
    active: true,
    sortOrder: 6,
  },
];

const DEFAULT_TEMPLATES: Array<PracticeTemplateDoc & { id: string }> = [
  {
    id: 'rxjs-state',
    title: 'RxJS + State Management Deep Dive',
    categoryId: 'angular',
    categoryLabel: 'Angular',
    durationMin: 25,
    questionCount: 8,
    difficulty: 'medium',
    xpRewardHint: 0, // XP rewards disabled app-wide
    mode: 'conversational',
    configDefaults: {
      topic: 'RxJS + State Management',
      skills: ['rxjs', 'state-management', 'angular'],
      technologies: ['Angular', 'RxJS', 'NgRx'],
      difficulty: 'medium',
      durationMinutes: 25,
    },
    tags: ['angular', 'rxjs', 'state'],
    active: true,
    sortOrder: 1,
    recommendedForRoles: ['Angular Developer', 'Frontend Developer'],
  },
  {
    id: 'frontend-scale',
    title: 'Design a URL Shortener',
    categoryId: 'system-design',
    categoryLabel: 'System Design',
    durationMin: 40,
    questionCount: 5,
    difficulty: 'hard',
    xpRewardHint: 0, // XP rewards disabled app-wide
    mode: 'system_design',
    configDefaults: {
      topic: 'Design a URL Shortener',
      skills: ['system-design', 'scalability', 'caching'],
      technologies: ['HTTP', 'Redis', 'Databases'],
      difficulty: 'hard',
      durationMinutes: 40,
    },
    tags: ['system-design', 'url-shortener'],
    active: true,
    sortOrder: 2,
  },
  {
    id: 'behavioral-failure',
    title: 'Tell me about a time you failed',
    categoryId: 'behavioral',
    categoryLabel: 'Behavioral',
    durationMin: 15,
    questionCount: 6,
    difficulty: 'easy',
    xpRewardHint: 0, // XP rewards disabled app-wide
    mode: 'behavioral',
    configDefaults: {
      topic: 'Behavioral — failure and recovery',
      skills: ['communication', 'self-awareness'],
      technologies: [],
      difficulty: 'easy',
      durationMinutes: 15,
    },
    tags: ['behavioral', 'soft-skills'],
    active: true,
    sortOrder: 3,
  },
  {
    id: 'frontend-performance',
    title: 'Rendering, hydration & performance',
    categoryId: 'angular',
    categoryLabel: 'Frontend',
    durationMin: 30,
    questionCount: 10,
    difficulty: 'medium',
    xpRewardHint: 0, // XP rewards disabled app-wide
    mode: 'conversational',
    configDefaults: {
      topic: 'Rendering, hydration & performance',
      skills: ['performance', 'ssr', 'rendering'],
      technologies: ['Angular', 'SSR', 'Web Vitals'],
      difficulty: 'medium',
      durationMinutes: 30,
    },
    tags: ['frontend', 'performance'],
    active: true,
    sortOrder: 4,
  },
  {
    id: 'leadership-team',
    title: 'Managing under-performers',
    categoryId: 'manager',
    categoryLabel: 'Leadership',
    durationMin: 20,
    questionCount: 5,
    difficulty: 'medium',
    xpRewardHint: 0, // XP rewards disabled app-wide
    mode: 'behavioral',
    configDefaults: {
      topic: 'Managing under-performers',
      skills: ['leadership', 'coaching', 'conflict'],
      technologies: [],
      difficulty: 'medium',
      durationMinutes: 20,
    },
    tags: ['leadership', 'manager'],
    active: true,
    sortOrder: 5,
  },
  {
    id: 'apis-tradeoffs',
    title: 'REST vs GraphQL trade-offs',
    categoryId: 'node',
    categoryLabel: 'APIs',
    durationMin: 25,
    questionCount: 7,
    difficulty: 'medium',
    xpRewardHint: 0, // XP rewards disabled app-wide
    mode: 'conversational',
    configDefaults: {
      topic: 'REST vs GraphQL trade-offs',
      skills: ['apis', 'graphql', 'rest'],
      technologies: ['Node.js', 'GraphQL', 'REST'],
      difficulty: 'medium',
      durationMinutes: 25,
    },
    tags: ['apis', 'node', 'graphql'],
    active: true,
    sortOrder: 6,
  },
];

function titleCaseDifficulty(d: string): string {
  return d.charAt(0).toUpperCase() + d.slice(1).toLowerCase();
}

function matchesQuery(
  haystack: string,
  q: string | undefined,
): boolean {
  if (!q) return true;
  return haystack.toLowerCase().includes(q.trim().toLowerCase());
}

/**
 * Load practice catalog for the Practice page.
 */
export async function getPracticeCatalog(
  uid: string,
  opts: PracticeCatalogQuery = {},
): Promise<PracticeCatalogResponse> {
  const db = ensureAdmin();
  const q = opts.q?.trim();
  const categoryId = opts.categoryId && opts.categoryId !== 'all'
    ? opts.categoryId
    : undefined;

  const emptyQuery = { empty: true, docs: [] as never[] };

  const [companiesSnap, templatesSnap, categoriesSnap, userSnap] =
    await Promise.all([
      companiesCol(db)
        .where('active', '==', true)
        .orderBy('sortOrder', 'asc')
        .get()
        .catch(() => emptyQuery),
      practiceTemplatesCol(db)
        .where('active', '==', true)
        .orderBy('sortOrder', 'asc')
        .get()
        .catch(() => emptyQuery),
      practiceCategoriesCol(db)
        .where('active', '==', true)
        .orderBy('sortOrder', 'asc')
        .get()
        .catch(() => null),
      userRef(db, uid).get(),
    ]);

  const targetRole = userSnap.data()?.profile?.targetRole ?? '';

  const categories: Array<{ id: string; label: string }> =
    categoriesSnap && !categoriesSnap.empty
      ? [
          { id: 'all', label: 'All' },
          ...categoriesSnap.docs.map((d) => {
            const data = d.data() as PracticeCategoryDoc;
            return { id: d.id, label: data.label };
          }),
        ]
      : DEFAULT_CATEGORIES;

  const companiesRaw =
    companiesSnap.empty
      ? DEFAULT_COMPANIES
      : companiesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as CompanyDoc) }));

  const templatesRaw =
    templatesSnap.empty
      ? DEFAULT_TEMPLATES
      : templatesSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as PracticeTemplateDoc),
        }));

  // Light personalization: templates matching target role float first
  const sortedTemplates = [...templatesRaw].sort((a, b) => {
    const aMatch = targetRole
      ? (a.recommendedForRoles ?? []).some((r) =>
          r.toLowerCase().includes(targetRole.toLowerCase()) ||
          targetRole.toLowerCase().includes(r.toLowerCase()),
        )
      : false;
    const bMatch = targetRole
      ? (b.recommendedForRoles ?? []).some((r) =>
          r.toLowerCase().includes(targetRole.toLowerCase()) ||
          targetRole.toLowerCase().includes(r.toLowerCase()),
        )
      : false;
    if (aMatch === bMatch) return a.sortOrder - b.sortOrder;
    return aMatch ? -1 : 1;
  });

  const companies = companiesRaw
    .filter((c) =>
      matchesQuery(`${c.name} ${c.difficulty} ${c.tags.join(' ')}`, q),
    )
    .map((c) => ({
      id: c.id,
      name: c.name,
      questionCount: c.questionCount,
      difficulty: c.difficulty,
    }));

  const sessions = sortedTemplates
    .filter((t) => {
      if (categoryId && t.categoryId !== categoryId) return false;
      return matchesQuery(
        `${t.title} ${t.categoryLabel} ${t.difficulty} ${t.tags.join(' ')}`,
        q,
      );
    })
    .map((t) => ({
      id: t.id,
      category: t.categoryLabel,
      durationMin: t.durationMin,
      title: t.title,
      questionCount: t.questionCount,
      difficulty: titleCaseDifficulty(t.difficulty),
      xp: t.xpRewardHint,
    }));

  return { categories, companies, sessions };
}

export async function getCompany(companyId: string): Promise<CompanyDoc & { id: string }> {
  const db = ensureAdmin();
  const snap = await companyRef(db, companyId).get();
  if (snap.exists) {
    return { id: snap.id, ...(snap.data() as CompanyDoc) };
  }
  const fallback = DEFAULT_COMPANIES.find((c) => c.id === companyId);
  if (!fallback) throw new AppError(404, 'Company not found.');
  return fallback;
}

export async function getPracticeTemplate(
  templateId: string,
): Promise<PracticeTemplateDoc & { id: string }> {
  const db = ensureAdmin();
  const snap = await practiceTemplateRef(db, templateId).get();
  if (snap.exists) {
    return { id: snap.id, ...(snap.data() as PracticeTemplateDoc) };
  }
  const fallback = DEFAULT_TEMPLATES.find((t) => t.id === templateId);
  if (!fallback) throw new AppError(404, 'Practice template not found.');
  return fallback;
}
