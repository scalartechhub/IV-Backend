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
    const credentials = secretService.getFirebaseCredentials();
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
