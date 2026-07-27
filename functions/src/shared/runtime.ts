/**
 * True when running on Firebase Functions / Cloud Run (function name in K_SERVICE)
 * or the Functions emulator — those hosts mount routes at `/` (the function URL
 * already includes the service name).
 *
 * Render and other plain Node hosts must keep the `/api` prefix. Render may set
 * cloud-like env vars; never treat RENDER as Firebase Functions.
 */
export const isCloudRuntime = (): boolean => {
  if (process.env.RENDER === 'true' || Boolean(process.env.RENDER_SERVICE_ID)) {
    return false;
  }
  return Boolean(process.env.K_SERVICE) || Boolean(process.env.FUNCTIONS_EMULATOR);
};

