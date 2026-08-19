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
import { secretService } from "./secrets";
import { firestoreConfigService } from "./firestore-config.service";

export let db: Firestore;
export let auth: Auth;
export { admin };

let _initialized = false;

export const getStorageBucket = (): string | undefined => {
  const fromFirestore = firestoreConfigService.getFirebaseConfig()?.storageBucket;
  const raw =
    fromFirestore ||
    appConfig.firebaseStorageBucket ||
    process.env.FB_STORAGE_BUCKET ||
    process.env.FIREBASE_STORAGE_BUCKET ||
    "";
  const cleaned = raw.replace(/^gs:\/\//, "").trim();
  return cleaned || undefined;
};

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

  const storageBucket = getStorageBucket();

  let adminApp: App;

  if (isCloudRuntime()) {
    adminApp = initializeApp({
      ...(storageBucket && { storageBucket }),
    });
  } else if (localServiceAccount) {
    adminApp = initializeApp({
      credential: cert(localServiceAccount),
      projectId: localServiceAccount.project_id,
      ...(storageBucket && { storageBucket }),
    });
  } else {
    if (!secretService.isInitialized) {
      secretService.initialize();
    }
    const credentials = secretService.getFirebaseCredentials();
    adminApp = initializeApp({
      credential: cert({
        projectId: credentials.projectId,
        clientEmail: credentials.clientEmail,
        privateKey: credentials.privateKey,
      }),
      projectId: credentials.projectId,
      ...(storageBucket && { storageBucket }),
    });
  }

  db = getFirestore(adminApp);
  auth = getAuth(adminApp);

  _initialized = true;
};

export const isStorageConfigured = (): boolean => Boolean(getStorageBucket());
