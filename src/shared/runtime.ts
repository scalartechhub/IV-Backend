/** True when running on Firebase Functions, Cloud Run, or the Functions emulator. */
export const isCloudRuntime = (): boolean =>
  Boolean(process.env.K_SERVICE) || Boolean(process.env.FUNCTIONS_EMULATOR);
