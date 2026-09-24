const configuredUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;

function resolveSiteUrl() {
  if (!configuredUrl) return new URL("http://127.0.0.1:3000");
  return new URL(configuredUrl.includes("://") ? configuredUrl : `https://${configuredUrl}`);
}

export const siteUrl = resolveSiteUrl();
