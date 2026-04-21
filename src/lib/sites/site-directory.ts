import type { ManagedSite } from "@/types/location";

function normalizeToken(value?: string | null) {
  return (value ?? "").trim().toLowerCase();
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

  if (expectedClientId && siteClientId && siteClientId === expectedClientId) {
    return true;
  }

  if (expectedClientName && siteClientName && siteClientName === expectedClientName) {
    return true;
  }

  return false;
}

export function sortSitesByName<T extends Pick<ManagedSite, "siteName">>(sites: T[]) {
  return [...sites].sort((a, b) => a.siteName.localeCompare(b.siteName));
}
