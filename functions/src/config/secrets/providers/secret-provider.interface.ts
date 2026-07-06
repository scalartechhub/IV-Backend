import type { AppSecrets } from "../secret.types";

/**
 * Pluggable secret source. Swap implementations for cloud secret managers
 * (GCP Secret Manager, AWS Secrets Manager, Azure Key Vault) without
 * changing business logic or SecretService consumers.
 */
export interface SecretProvider {
  load(): AppSecrets;
}
