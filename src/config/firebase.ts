import { initializeApp, cert, App } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";
import { getAuth, Auth } from "firebase-admin/auth";
import { appConfig } from "./app.config";
import { secretService } from "./secrets";

export let db: Firestore;
export let auth: Auth;

let _storageBucket: string | undefined;
let _initialized = false;

export const initializeFirebase = (): void => {
  if (_initialized) return;

  const credentials = secretService.getFirebaseCredentials();
  const rawBucket = appConfig.firebaseStorageBucket;
  _storageBucket = rawBucket?.replace(/^gs:\/\//, "");

  const adminApp: App = initializeApp({
    credential: cert({
      projectId: credentials.projectId,
      clientEmail: credentials.clientEmail,
      privateKey: credentials.privateKey,
    }),
    projectId: credentials.projectId,
    ...(_storageBucket && { storageBucket: _storageBucket }),
  });

  db = getFirestore(adminApp);
  auth = getAuth(adminApp);
  _initialized = true;
};

export const isStorageConfigured = (): boolean => Boolean(_storageBucket);
