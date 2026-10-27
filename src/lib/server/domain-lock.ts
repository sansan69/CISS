/**
 * Per-region host lock.
 *
 * A regional deployment is enrolled with one or more domains. When an allowlist
 * is configured the deployment must refuse every other Host, including preview
 * URLs and direct IP access. An empty/absent allowlist means "not locked" so
 * existing deployments keep working until they are enrolled.
 */
export type HostLockOptions = {
  isDev?: boolean;
};

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Lowercase, host-only form of a Host header or configured domain. */
export function normalizeHost(value: string): string {
  let host = String(value ?? "").trim().toLowerCase();
  if (!host) return "";

  // Tolerate a full URL in configuration by extracting its hostname.
  if (host.includes("://")) {
    try {
      host = new URL(host).hostname;
    } catch {
      return "";
    }
  }

  // Drop a path/query if one was pasted.
  host = host.split("/")[0] ?? host;
  // Drop :port (IPv4/hostname form). Preserve bracketed IPv6 separately.
  if (!host.startsWith("[")) {
    const colon = host.lastIndexOf(":");
    if (colon > -1 && host.indexOf(":") === colon) {
      host = host.slice(0, colon);
    }
  }
  return host.replace(/\.$/, "");
}

function matchesRule(host: string, rule: string): boolean {
  if (rule.startsWith("*.")) {
    const suffix = rule.slice(2);
    if (!suffix) return false;
    return host.endsWith(`.${suffix}`) && host !== suffix;
  }
  return host === rule;
}

export function isHostAllowed(
  hostHeader: string,
  allowedDomains: readonly string[] | null | undefined,
  options: HostLockOptions = {},
): boolean {
  const host = normalizeHost(hostHeader);
  if (!host) return false;

  const normalizedRules = (allowedDomains ?? [])
    .map((rule) => normalizeHost(rule))
    .filter((rule) => rule.length > 0);

  if (normalizedRules.length === 0) return true;

  if (options.isDev && LOOPBACK_HOSTS.has(host)) return true;

  return normalizedRules.some((rule) => matchesRule(host, rule));
}
