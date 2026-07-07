import { secretService, SecretValidationError } from "./config/secrets";
import { initializeFirebase } from "./config/firebase";
import { initializeGemini } from "./config/gemini";

/** Shared startup for local server and Firebase Functions runtime. */
export const bootstrapApplication = (): void => {
  secretService.initialize();
  initializeFirebase();
  initializeGemini();
};

export { SecretValidationError };
