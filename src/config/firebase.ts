import { initializeApp, cert, ServiceAccount } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

const serviceAccount = require("../../firebase-service-account.json") as ServiceAccount;

const adminApp = initializeApp({ credential: cert(serviceAccount) });

export const db = getFirestore(adminApp);
export const auth = getAuth(adminApp);
