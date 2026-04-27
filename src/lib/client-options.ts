export interface BasicClientOption {
  id: string;
  name: string;
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
