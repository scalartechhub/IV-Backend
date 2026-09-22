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

const getTargetProjectId = (): string | undefined => {
  return (
    process.env.FB_PROJECT_ID ||
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    ""
  ).trim() || undefined;
};

const findServiceAccountPath = (targetProjectId?: string): string | null => {
  const configured = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (configured && existsSync(configured)) return configured;

  const searchDirs = [
    process.cwd(),
    resolve(process.cwd(), ".."),
    resolve(__dirname, "../../"),
    resolve(__dirname, "../../../"),
  ];

  const searchFilenames: string[] = [];
  if (targetProjectId) {
    searchFilenames.push(
      `firebase-service-account.${targetProjectId}.json`,
      `service-account.${targetProjectId}.json`
    );
    if (targetProjectId === "interview-89e09" || targetProjectId.includes("dev")) {
      searchFilenames.push(
        "firebase-service-account.dev.json",
        "service-account.dev.json"
      );
    }
  }
  searchFilenames.push("firebase-service-account.json", "service-account.json");

  for (const dir of searchDirs) {
    for (const name of searchFilenames) {
      const filePath = resolve(dir, name);
      if (existsSync(filePath)) {
        try {
          const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
          const saProjectId = parsed.projectId ?? parsed.project_id;
          if (!targetProjectId || !saProjectId || saProjectId === targetProjectId) {
            return filePath;
          }
        } catch {
          // ignore
        }
      }
    }
  }

  return null;
};

export const initializeFirebase = (): void => {
  if (_initialized) {
    return;
  }

  const storageBucket = getStorageBucket();
  const targetProjectId = getTargetProjectId();

  let adminApp: App;

  if (isCloudRuntime()) {
    adminApp = initializeApp({
      ...(targetProjectId && { projectId: targetProjectId }),
      ...(storageBucket && { storageBucket }),
    });
  } else {
    const serviceAccountPath = findServiceAccountPath(targetProjectId);
    const serviceAccount = serviceAccountPath
      ? (JSON.parse(readFileSync(serviceAccountPath, "utf-8")) as ServiceAccount & {
          project_id?: string;
        })
      : undefined;

    if (serviceAccount) {
      const saProjectId = serviceAccount.project_id || targetProjectId;
      console.log(
        `[Firebase] Initialized with service account (${serviceAccountPath}) for project: ${saProjectId}`
      );
      adminApp = initializeApp({
        credential: cert(serviceAccount),
        projectId: saProjectId,
        ...(storageBucket && { storageBucket }),
      });
    } else {
      if (!secretService.isInitialized) {
        secretService.initialize();
      }
      const credentials = secretService.getFirebaseCredentials();
      const effectiveProjectId = credentials.projectId || targetProjectId;

      if (credentials.clientEmail && credentials.privateKey) {
        adminApp = initializeApp({
          credential: cert({
            projectId: effectiveProjectId,
            clientEmail: credentials.clientEmail,
            privateKey: credentials.privateKey,
          }),
          projectId: effectiveProjectId,
          ...(storageBucket && { storageBucket }),
        });
      } else {
        adminApp = initializeApp({
          ...(effectiveProjectId && { projectId: effectiveProjectId }),
          ...(storageBucket && { storageBucket }),
        });
      }
    }
  }

  db = getFirestore(adminApp);
  db.settings({ ignoreUndefinedProperties: true });
  auth = getAuth(adminApp);

  _initialized = true;
};

export const isStorageConfigured = (): boolean => Boolean(getStorageBucket());
