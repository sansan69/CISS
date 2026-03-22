const DEFAULT_TEAM_SLUG = "sansan69s-projects";

export function slugifyRegionName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function getVercelTeamSlug() {
  return (
    process.env.VERCEL_REGION_TEAM_SLUG?.trim() ||
    process.env.VERCEL_TEAM_SLUG?.trim() ||
    DEFAULT_TEAM_SLUG
  );
}

export function buildRegionVercelProjectName(regionName: string, regionCode: string) {
  const regionSlug = slugifyRegionName(regionName);
  const codeSlug = slugifyRegionName(regionCode);
  const base = regionSlug ? `ciss-${regionSlug}` : `ciss-${codeSlug}`;
  const normalized = base.slice(0, 80).replace(/-+$/g, "");

  if (normalized.length >= 6) {
    return normalized;
  }

  return `ciss-${codeSlug || "region"}`;
}

export function buildVercelProjectDashboardUrl(projectName: string, teamSlug = getVercelTeamSlug()) {
  return `https://vercel.com/${teamSlug}/${projectName}`;
}

export function buildVercelProductionUrl(projectName: string, teamSlug = getVercelTeamSlug()) {
  return `https://${projectName}-${teamSlug}.vercel.app`;
}
