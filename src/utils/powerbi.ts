/** Shared Power BI utilities */

export function isValidPowerBIUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && (
      parsed.hostname.includes('powerbi.com') ||
      parsed.hostname.includes('app.powerbi.com') ||
      parsed.hostname.includes('report.powerbi.com')
    );
  } catch { return false; }
}
