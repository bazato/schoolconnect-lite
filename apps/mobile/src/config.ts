export function isDemoMode(value: string | undefined) {
  return value === 'true';
}

export function resolveApiUrl(configuredUrl: string | undefined, platform: string, browserLocation?: { hostname?: string }): string {
  if (configuredUrl !== undefined) return configuredUrl;
  const browserHost = platform === 'web' ? browserLocation?.hostname ?? 'localhost' : 'localhost';
  return `http://${browserHost}:3000/api/v1`;
}
