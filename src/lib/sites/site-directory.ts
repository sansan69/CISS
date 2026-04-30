import type { ManagedSite } from "@/types/location";

function normalizeToken(value?: string | null) {
  return (value ?? "").trim().toLowerCase();
}

function normalizeClientKey(value?: string | null) {
  return normalizeToken(value)
    .replace(/[’']/g, "'")
    .replace(/'s\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function siteBelongsToClient(
  site: Pick<ManagedSite, "clientId" | "clientName"> | { clientId?: string | null; clientName?: string | null },
  clientId?: string,
  clientName?: string,
) {
  const siteClientId = normalizeToken(site.clientId);
  const siteClientName = normalizeToken(site.clientName);
  const expectedClientId = normalizeToken(clientId);
  const expectedClientName = normalizeToken(clientName);
  const siteClientKey = normalizeClientKey(site.clientName);
  const expectedClientKey = normalizeClientKey(clientName);

  if (expectedClientId && siteClientId && siteClientId === expectedClientId) {
    return true;
  }

  if (expectedClientName && siteClientName && siteClientName === expectedClientName) {
    return true;
  }

  if (expectedClientKey && siteClientKey && siteClientKey === expectedClientKey) {
    return true;
  }

  return false;
}

export function sortSitesByName<T extends Pick<ManagedSite, "siteName">>(sites: T[]) {
  return [...sites].sort((a, b) => a.siteName.localeCompare(b.siteName));
}
