export interface BasicClientOption {
  id: string;
  name: string;
}

export interface ClientOptionWithGuardCount extends BasicClientOption {
  activeGuardCount?: number;
}

export function isClientPortalEnabled(client: { portalEnabled?: unknown }) {
  return client.portalEnabled !== false;
}

export function isClientEnrollmentEnabled(client: {
  portalEnabled?: unknown;
  enrollmentEnabled?: unknown;
}) {
  return isClientPortalEnabled(client) && client.enrollmentEnabled !== false;
}

export function dedupeClientOptions<T extends BasicClientOption>(clients: T[]): T[] {
  const seenNames = new Set<string>();

  return clients.flatMap((client) => {
    const normalizedName = client.name.trim();
    if (!normalizedName) {
      return [];
    }

    const key = normalizedName.toLowerCase();
    if (seenNames.has(key)) {
      return [];
    }

    seenNames.add(key);
    return [{ ...client, name: normalizedName }];
  });
}

export function sortClientOptionsByActiveGuardCount<T extends ClientOptionWithGuardCount>(
  clients: T[],
): T[] {
  return [...clients].sort((a, b) => {
    const countDifference = (b.activeGuardCount ?? 0) - (a.activeGuardCount ?? 0);
    if (countDifference !== 0) {
      return countDifference;
    }

    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}
