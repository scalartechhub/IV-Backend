/**
 * Migrates legacy multi-collection data into embedded interview documents.
 *
 * Usage:
 *   npm run migrate:embedded          # dry-run (default)
 *   npm run migrate:embedded -- --apply
 *   npm run migrate:embedded -- --verify
 */
import "dotenv/config";
import { appConfig } from "../src/config/app.config";
import { secretService, SecretValidationError } from "../src/config/secrets";
import { initializeFirebase } from "../src/config/firebase";
import { migrationService } from "../src/modules/migration/migration.service";

const apply = process.argv.includes("--apply");
const verify = process.argv.includes("--verify");

try {
  secretService.initialize();
  initializeFirebase();
} catch (error) {
  if (error instanceof SecretValidationError) {
    console.error(error.message);
  } else if (error instanceof Error) {
    console.error("Startup failed:", error.message);
  }
  process.exit(1);
}

const run = async (): Promise<void> => {
  console.log(`Environment: ${appConfig.nodeEnv}`);

  if (verify) {
    const verification = await migrationService.verifyMigration();
    console.log("Verification:", JSON.stringify(verification, null, 2));
    return;
  }

  const result = await migrationService.migrateAll(apply);
  console.log(JSON.stringify(result, null, 2));

  if (!apply) {
    console.log("No changes written. Re-run with --apply to execute.");
  }
};

run().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
