import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import * as admin from "firebase-admin";

import {
  App,
  ServiceAccount,
  cert,
  initializeApp
} from "firebase-admin/app";
import { Auth, getAuth } from "firebase-admin/auth";
import { Firestore, getFirestore } from "firebase-admin/firestore";

import { isCloudRuntime } from "../shared/runtime";
import { appConfig } from "./app.config";

export let db: Firestore;
export let auth: Auth;
export { admin };

let _storageBucket: string | undefined;
let _initialized = false;

const findServiceAccountPath = (): string | null => {
  const configured = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (configured && existsSync(configured)) return configured;

  const candidates = [
    resolve(process.cwd(), "firebase-service-account.json"),
    resolve(process.cwd(), "../firebase-service-account.json"),
    resolve(__dirname, "../../firebase-service-account.json"),
    resolve(__dirname, "../../../firebase-service-account.json"),
  ];

  for (const filePath of candidates) {
    if (existsSync(filePath)) return filePath;
  }

  return null;
};

const localServiceAccountPath = findServiceAccountPath();
const useLocalServiceAccount = Boolean(localServiceAccountPath);

const localServiceAccount:
  | (ServiceAccount & { project_id?: string })
  | undefined = useLocalServiceAccount && localServiceAccountPath
  ? JSON.parse(readFileSync(localServiceAccountPath, "utf-8"))
  : undefined;

export const initializeFirebase = (): void => {
  if (_initialized) {
    return;
  }

  _storageBucket = appConfig.firebaseStorageBucket?.replace(/^gs:\/\//, "");

  let adminApp: App;

  if (isCloudRuntime()) {
    adminApp = initializeApp({
      ...(_storageBucket && { storageBucket: _storageBucket }),
    });
  } else {
    const credentials = {
      projectId:
        process.env.FIREBASE_PROJECT_ID?.trim() ||
        process.env.GCLOUD_PROJECT?.trim() ||
        "",
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL?.trim() || "",
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.trim().replace(/\\n/g, "\n") || "",
    };

    if (!credentials.projectId || !credentials.clientEmail || !credentials.privateKey) {
      throw new Error(
        "Firebase credentials not found. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY."
      );
    }

    adminApp = initializeApp({
      credential: localServiceAccount
        ? cert(localServiceAccount)
        : cert({
            projectId: credentials.projectId,
            clientEmail: credentials.clientEmail,
            privateKey: credentials.privateKey,
          }),
      projectId: localServiceAccount?.project_id ?? credentials.projectId,
      ...(_storageBucket && { storageBucket: _storageBucket }),
    });
  }

  db = getFirestore(adminApp);
  auth = getAuth(adminApp);

  _initialized = true;
};

export const isStorageConfigured = (): boolean => Boolean(_storageBucket);
