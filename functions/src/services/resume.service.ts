/**
 * V2 resume service — upload/analyze + list/active.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import type { ResumeAnalysis, ResumeDoc } from '../interfaces/resume.interface';
import { generateJson } from '../lib/gemini-client';
import { AppError } from '../shared/utils';
import { extractPdfText } from '../shared/utils/pdf';
import { ensureAdmin, ensureStorage } from '../utils/callable-auth';
import { resumeRef, resumesCol } from '../utils/firestore-refs';

const analysisSchema = z.object({
  overallScore: z.number(),
  atsScore: z.number(),
  impactScore: z.number(),
  clarityScore: z.number(),
  keywordMatch: z.object({ score: z.number(), delta: z.number() }),
  quantifiedImpact: z.object({ score: z.number(), delta: z.number() }),
  actionVerbs: z.object({ score: z.number(), delta: z.number() }),
  structureLength: z.object({ score: z.number(), delta: z.number() }),
  percentileVsPeers: z.number(),
  fixesFirst: z.array(
    z.object({
      id: z.string(),
      severity: z.enum(['high', 'medium', 'low']),
      text: z.string(),
    }),
  ),
  workingWell: z.array(z.object({ id: z.string(), text: z.string() })),
  extractedKeywords: z.array(z.string()),
  missingKeywords: z.array(z.string()),
  recommendedSkills: z.array(z.string()),
  recommendedInterviewIds: z.array(z.string()).default([]),
});

function asStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object' && 'text' in item) {
        return String((item as { text: unknown }).text ?? '').trim();
      }
      return '';
    })
    .filter(Boolean);
}

function normalizeFixesFirst(raw: unknown): Array<{
  id: string;
  severity: 'high' | 'medium' | 'low';
  text: string;
}> {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, index) => {
    if (typeof item === 'string') {
      return { id: `fix-${index + 1}`, severity: 'medium' as const, text: item.trim() };
    }
    const obj = (item ?? {}) as {
      id?: unknown;
      severity?: unknown;
      text?: unknown;
    };
    const severity =
      obj.severity === 'high' || obj.severity === 'medium' || obj.severity === 'low'
        ? obj.severity
        : 'medium';
    return {
      id: typeof obj.id === 'string' && obj.id.trim() ? obj.id : `fix-${index + 1}`,
      severity,
      text: String(obj.text ?? '').trim() || 'Improve this section',
    };
  });
}

function normalizeWorkingWell(
  raw: unknown,
): Array<{ id: string; text: string }> {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, index) => {
    if (typeof item === 'string') {
      return { id: `well-${index + 1}`, text: item.trim() };
    }
    const obj = (item ?? {}) as { id?: unknown; text?: unknown };
    return {
      id: typeof obj.id === 'string' && obj.id.trim() ? obj.id : `well-${index + 1}`,
      text: String(obj.text ?? '').trim() || 'Strong point',
    };
  });
}

function normalizeScoreWithDelta(raw: unknown): { score: number; delta: number } {
  if (typeof raw === 'number') return { score: raw, delta: 0 };
  if (raw && typeof raw === 'object') {
    const obj = raw as { score?: unknown; delta?: unknown };
    return {
      score: typeof obj.score === 'number' ? obj.score : 0,
      delta: typeof obj.delta === 'number' ? obj.delta : 0,
    };
  }
  return { score: 0, delta: 0 };
}

/** Coerce common Gemini shape drift before zod validation. */
function normalizeRawAnalysis(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const data = raw as Record<string, unknown>;
  return {
    ...data,
    keywordMatch: normalizeScoreWithDelta(data.keywordMatch),
    quantifiedImpact: normalizeScoreWithDelta(data.quantifiedImpact),
    actionVerbs: normalizeScoreWithDelta(data.actionVerbs),
    structureLength: normalizeScoreWithDelta(data.structureLength),
    fixesFirst: normalizeFixesFirst(data.fixesFirst ?? data.fixSuggestions),
    workingWell: normalizeWorkingWell(data.workingWell),
    extractedKeywords: asStringArray(data.extractedKeywords),
    missingKeywords: asStringArray(data.missingKeywords),
    recommendedSkills: asStringArray(data.recommendedSkills),
    recommendedInterviewIds: asStringArray(data.recommendedInterviewIds),
  };
}

export interface UploadResumeInput {
  storagePath: string;
  fileName: string;
  targetRole: string;
  resumeId?: string;
}

export interface AnalyzeResumeInput {
  fileBuffer: Buffer;
  fileName: string;
  targetRole: string;
  contentType?: string;
}

async function runAtsAnalysis(
  extractedText: string,
  targetRole: string,
): Promise<ResumeAnalysis> {
  const rawAnalysis = await generateJson<unknown>({
    systemInstruction: `You are an ATS resume analyzer. Respond ONLY with valid JSON.
Required shape:
{
  "overallScore": number,
  "atsScore": number,
  "impactScore": number,
  "clarityScore": number,
  "keywordMatch": { "score": number, "delta": number },
  "quantifiedImpact": { "score": number, "delta": number },
  "actionVerbs": { "score": number, "delta": number },
  "structureLength": { "score": number, "delta": number },
  "percentileVsPeers": number,
  "fixesFirst": [ { "id": "fix-1", "severity": "high"|"medium"|"low", "text": string } ],
  "workingWell": [ { "id": "well-1", "text": string } ],
  "extractedKeywords": string[],
  "missingKeywords": string[],
  "recommendedSkills": string[],
  "recommendedInterviewIds": string[]
}
IMPORTANT: fixesFirst and workingWell MUST be arrays of objects, never plain strings.`,
    userPrompt: JSON.stringify({
      targetRole,
      resumeText: extractedText.slice(0, 40_000),
    }),
  });

  const validated = analysisSchema.safeParse(normalizeRawAnalysis(rawAnalysis));
  if (!validated.success) {
    throw new AppError(
      502,
      `Invalid resume analysis from Gemini: ${validated.error.message}`,
    );
  }

  return {
    ...validated.data,
    extractedText: extractedText.slice(0, 100_000),
  };
}

async function activateResumeDoc(
  uid: string,
  newId: string,
  fields: {
    fileName: string;
    storagePath: string;
    targetRole: string;
    analysis: ResumeAnalysis;
  },
): Promise<void> {
  const db = ensureAdmin();

  await db.runTransaction(async (tx) => {
    // All reads must happen before any writes (Firestore transaction rule).
    const [activeSnap, existingVersions] = await Promise.all([
      tx.get(resumesCol(db, uid).where('isActive', '==', true)),
      tx.get(resumesCol(db, uid)),
    ]);
    const version = existingVersions.size + 1;

    for (const doc of activeSnap.docs) {
      if (doc.id !== newId) {
        tx.update(doc.ref, { isActive: false });
      }
    }

    const doc: ResumeDoc = {
      fileName: fields.fileName,
      storagePath: fields.storagePath,
      version,
      isActive: true,
      uploadedAt: FieldValue.serverTimestamp() as never,
      targetRole: fields.targetRole,
      analysis: fields.analysis,
      aiReviewedAt: FieldValue.serverTimestamp() as never,
      analysisStatus: 'completed',
    };

    tx.set(resumeRef(db, uid, newId), doc);
  });
}

/**
 * Analyze a resume already in Storage (client uploaded first).
 */
export async function uploadResume(uid: string, input: UploadResumeInput) {
  const db = ensureAdmin();
  const storage = ensureStorage();
  const { storagePath, fileName, targetRole, resumeId } = input;

  if (!storagePath.startsWith(`resumes/${uid}/`)) {
    throw new AppError(403, 'storagePath must be under resumes/{uid}/.');
  }

  const bucket = storage.bucket();
  const [buffer] = await bucket.file(storagePath).download();
  const { text: extractedText } = await extractPdfText(buffer);
  const analysis = await runAtsAnalysis(extractedText, targetRole);
  const newId = resumeId ?? db.collection('_').doc().id;

  await activateResumeDoc(uid, newId, {
    fileName,
    storagePath,
    targetRole,
    analysis,
  });

  return { resumeId: newId, analysisStatus: 'completed' as const, analysis };
}

/**
 * Multipart PDF resume analysis: upload to Storage + ATS scorecard + activate.
 * Architecture path: resumes/{uid}/{resumeId}.pdf + users/{uid}/resumes/{resumeId}
 */
export async function analyzeResume(uid: string, input: AnalyzeResumeInput) {
  if (!input.fileBuffer?.length) {
    throw new AppError(400, 'Resume PDF file is required.');
  }

  const db = ensureAdmin();
  const storage = ensureStorage();
  const newId = db.collection('_').doc().id;
  const storagePath = `resumes/${uid}/${newId}.pdf`;

  const bucket = storage.bucket();
  await bucket.file(storagePath).save(input.fileBuffer, {
    contentType: input.contentType ?? 'application/pdf',
    metadata: {
      metadata: {
        uploadedBy: uid,
        originalFileName: input.fileName,
      },
    },
  });

  const { text: extractedText } = await extractPdfText(input.fileBuffer);
  const analysis = await runAtsAnalysis(extractedText, input.targetRole);

  await activateResumeDoc(uid, newId, {
    fileName: input.fileName,
    storagePath,
    targetRole: input.targetRole,
    analysis,
  });

  return {
    resumeId: newId,
    storagePath,
    analysisStatus: 'completed' as const,
    analysis,
  };
}

export async function listResumes(uid: string) {
  const db = ensureAdmin();
  const snap = await resumesCol(db, uid).orderBy('uploadedAt', 'desc').get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getActiveResume(uid: string) {
  const db = ensureAdmin();
  const snap = await resumesCol(db, uid)
    .where('isActive', '==', true)
    .limit(1)
    .get();
  if (snap.empty) throw new AppError(404, 'No active resume found.');
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}
