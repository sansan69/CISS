export type TcsCategory = "adhoc" | "permanent";

/** Legacy records remain unclassified; stale categories on other clients are ignored. */
export function parseTcsCategory(clientName: unknown, value: unknown): TcsCategory | null {
  if (typeof clientName !== "string" || clientName.trim().toUpperCase() !== "TCS") return null;
  return value === "adhoc" || value === "permanent" ? value : null;
}

/** General editing may remove a stale category, but never assigns a category. */
export function withTcsCategoryClientCleanup<T extends Record<string, unknown>>(
  previousClientName: unknown,
  update: T,
  deletionValue: unknown,
): T & { tcsCategory?: unknown } {
  if (parseTcsCategory(previousClientName, "adhoc") &&
      typeof update.clientName === "string" &&
      !parseTcsCategory(update.clientName, "adhoc")) {
    return { ...update, tcsCategory: deletionValue };
  }
  return update;
}
