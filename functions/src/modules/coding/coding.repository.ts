import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../config/firebase";
import { COLLECTIONS, CODING_SUBCOLLECTIONS } from "../../shared/constants";
import type {
  CodingProblemDoc,
  CodingProblemSecretsDoc,
  CodingTestCase,
} from "./coding.types";
import { AppError } from "../../shared/utils";

export const getProblemById = async (problemId: string): Promise<CodingProblemDoc | null> => {
  const snap = await db.collection(COLLECTIONS.CODING_PROBLEMS).doc(problemId).get();
  if (!snap.exists) {
    return null;
  }
  return { id: snap.id, ...snap.data() } as CodingProblemDoc;
};

export const getProblemSecrets = async (
  problemId: string
): Promise<CodingProblemSecretsDoc | null> => {
  const snap = await db.collection(COLLECTIONS.CODING_PROBLEM_SECRETS).doc(problemId).get();
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

export const assertProblemExists = async (problemId: string): Promise<CodingProblemDoc> => {
  const problem = await getProblemById(problemId);
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
  problem: CodingProblemDoc
): Promise<CodingTestCase[]> => {
  const secrets = await getProblemSecrets(problem.id);
  const hidden = secrets?.hiddenTests ?? [];
  return [...(problem.publicTests ?? []), ...hidden];
};
