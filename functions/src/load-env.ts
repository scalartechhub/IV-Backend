/**
 * Application environment initializer.
 *
 * NOTE: Configuration is loaded dynamically from Firestore's `config` collection
 * during application bootstrap. Local .env files are NOT loaded.
 *
 * APP_ENV specifies the target environment:
 *   - 'dev' | 'development' (default) -> Target project: interview-89e09
 *   - 'prod' | 'production'           -> Target project: interview-prod-dd24f
 */
const rawEnv = (process.env.APP_ENV || process.env.NODE_ENV || "").trim().toLowerCase();

if (rawEnv === "prod" || rawEnv === "production") {
  process.env.APP_ENV = "production";
} else {
  process.env.APP_ENV = "dev";
}

console.log(
  `[EnvLoader] Active APP_ENV=${process.env.APP_ENV} (Configuration sourced exclusively from Firestore config)`
);
