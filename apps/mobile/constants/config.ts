/**
 * API base URL.
 * In production builds, always use the hardcoded domain regardless of env vars.
 * In dev, allow EXPO_PUBLIC_API_URL override for local testing.
 */
const PRODUCTION_URL = "https://askarthur.au";

export const API_URL: string = __DEV__
  ? (process.env.EXPO_PUBLIC_API_URL ?? PRODUCTION_URL)
  : PRODUCTION_URL;
