import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../config/firebase";
import { COLLECTIONS, CODING_SUBCOLLECTIONS } from "../../shared/constants";
import type {
  CodingProblemDoc,
  CodingProblemSecretsDoc,
  CodingTestCase,
} from "./coding.types";
import { AppError } from "../../shared/utils";

const generatedProblemsRef = (uid: string) =>
  db.collection(COLLECTIONS.USERS).doc(uid).collection(CODING_SUBCOLLECTIONS.GENERATED_PROBLEMS);

const generatedSecretsRef = (uid: string) =>
  db
    .collection(COLLECTIONS.USERS)
    .doc(uid)
    .collection(CODING_SUBCOLLECTIONS.GENERATED_PROBLEM_SECRETS);

export const saveGeneratedProblem = async (
  uid: string,
  problem: CodingProblemDoc,
  hiddenTests: CodingTestCase[]
): Promise<void> => {
  const { id, ...rest } = problem;
  await generatedProblemsRef(uid)
    .doc(id)
    .set({
      ...rest,
      source: "ai_profile",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

  await generatedSecretsRef(uid).doc(id).set({
    problemId: id,
    hiddenTests,
    createdAt: FieldValue.serverTimestamp(),
  });
};

export const listGeneratedProblems = async (uid: string): Promise<CodingProblemDoc[]> => {
  const snap = await generatedProblemsRef(uid).limit(50).get();
  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as CodingProblemDoc)
    .sort((a, b) => (b.order ?? 0) - (a.order ?? 0));
};

export const getGeneratedProblemById = async (
  uid: string,
  problemId: string
): Promise<CodingProblemDoc | null> => {
  const snap = await generatedProblemsRef(uid).doc(problemId).get();
  if (!snap.exists) {
    return null;
  }
  return { id: snap.id, ...snap.data() } as CodingProblemDoc;
};

export const getGeneratedProblemSecrets = async (
  uid: string,
  problemId: string
): Promise<CodingProblemSecretsDoc | null> => {
  const snap = await generatedSecretsRef(uid).doc(problemId).get();
  if (!snap.exists) {
    return null;
  }
  return snap.data() as CodingProblemSecretsDoc;
};

export const saveSubmission = async (
  uid: string,
  submissionId: string,
  payload: Record<string, unknown>
): Promise<void> => {
  await db
    .collection(COLLECTIONS.USERS)
    .doc(uid)
    .collection(CODING_SUBCOLLECTIONS.SUBMISSIONS)
    .doc(submissionId)
    .set({
      ...payload,
      submittedAt: FieldValue.serverTimestamp(),
    });
};

export const getSubmissionById = async (
  uid: string,
  submissionId: string
): Promise<Record<string, unknown> | null> => {
  const snap = await db
    .collection(COLLECTIONS.USERS)
    .doc(uid)
    .collection(CODING_SUBCOLLECTIONS.SUBMISSIONS)
    .doc(submissionId)
    .get();
  if (!snap.exists) {
    return null;
  }
  return { id: snap.id, ...snap.data() };
};

export const getIdempotentResult = async (
  uid: string,
  idempotencyKey: string
): Promise<Record<string, unknown> | null> => {
  const snap = await db
    .collection(COLLECTIONS.USERS)
    .doc(uid)
    .collection(CODING_SUBCOLLECTIONS.IDEMPOTENCY)
    .doc(idempotencyKey)
    .get();
  if (!snap.exists) {
    return null;
  }
  const data = snap.data() as { result?: Record<string, unknown> } | undefined;
  return data?.result ?? null;
};

export const saveIdempotentResult = async (
  uid: string,
  idempotencyKey: string,
  result: Record<string, unknown>
): Promise<void> => {
  await db
    .collection(COLLECTIONS.USERS)
    .doc(uid)
    .collection(CODING_SUBCOLLECTIONS.IDEMPOTENCY)
    .doc(idempotencyKey)
    .set({
      result,
      createdAt: FieldValue.serverTimestamp(),
    });
};

export const upsertProgress = async (
  uid: string,
  problemId: string,
  payload: Record<string, unknown>
): Promise<void> => {
  await db
    .collection(COLLECTIONS.USERS)
    .doc(uid)
    .collection(CODING_SUBCOLLECTIONS.PROGRESS)
    .doc(problemId)
    .set(
      {
        problemId,
        ...payload,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
};

export const getProgressForUser = async (
  uid: string
): Promise<Map<string, { status: string }>> => {
  const snap = await db
    .collection(COLLECTIONS.USERS)
    .doc(uid)
    .collection(CODING_SUBCOLLECTIONS.PROGRESS)
    .get();

  const map = new Map<string, { status: string }>();
  snap.docs.forEach((doc) => {
    const data = doc.data();
    map.set(doc.id, { status: String(data.status ?? "attempted") });
  });
  return map;
};

/** Resolve an AI-generated problem owned by this candidate. */
export const assertProblemExists = async (
  uid: string,
  problemId: string
): Promise<CodingProblemDoc> => {
  const problem = await getGeneratedProblemById(uid, problemId);
  if (!problem || problem.isActive === false) {
    throw new AppError(404, "Problem not found");
  }
  return problem;
};

export const getTestsForRun = (
  problem: CodingProblemDoc,
  customInput?: string
): CodingTestCase[] => {
  if (customInput !== undefined && customInput.trim() !== "") {
    return [{ input: customInput, expectedOutput: "" }];
  }
  return problem.publicTests ?? [];
};

export const getTestsForSubmit = async (
  uid: string,
  problem: CodingProblemDoc
): Promise<CodingTestCase[]> => {
  const secrets = await getGeneratedProblemSecrets(uid, problem.id);
  const hidden = secrets?.hiddenTests ?? [];
  return [...(problem.publicTests ?? []), ...hidden];
};

/** Public API shape — never includes hiddenTests. */
export const toPublicProblem = (problem: CodingProblemDoc): CodingProblemDoc => problem;
