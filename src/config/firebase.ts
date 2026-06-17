import { readFileSync } from "fs";
import { resolve } from "path";
import { initializeApp, cert, ServiceAccount } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

const serviceAccountPath =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ??
  resolve(__dirname, "../../firebase-service-account.json");

const serviceAccount = JSON.parse(
  readFileSync(serviceAccountPath, "utf-8")
) as ServiceAccount & { project_id: string };

const rawBucket = process.env.FIREBASE_STORAGE_BUCKET;
const storageBucket = rawBucket?.replace(/^gs:\/\//, "");

const adminApp = initializeApp({
  credential: cert(serviceAccount),
  projectId: serviceAccount.project_id,
  ...(storageBucket && { storageBucket }),
});

export const isStorageConfigured = (): boolean => Boolean(storageBucket);

export const db = getFirestore(adminApp);
export const auth = getAuth(adminApp);
