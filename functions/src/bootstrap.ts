import { secretService, SecretValidationError } from "./config/secrets";
import { initializeFirebase } from "./config/firebase";
import { initializeGemini } from "./config/gemini";
import { firestoreConfigService } from "./config/firestore-config.service";

/** Shared startup for local server and Firebase Functions runtime. */
export const bootstrapApplication = async (): Promise<void> => {
  secretService.initialize();
  initializeFirebase();
  await firestoreConfigService.loadConfigFromFirestore();
  initializeGemini();
};

export { SecretValidationError };

