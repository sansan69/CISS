export type ClientPortalContext = {
  isClientPortal: boolean;
  host: string;
  subdomain: string | null;
  rootDomain: string;
};

const DEFAULT_ROOT_DOMAIN = "cisskerala.site";
const CLIENT_PORTAL_AUTH_DOMAIN = "clients.cisskerala.app";

function normalizeHost(host: string | null | undefined) {
  return String(host ?? "")
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");
}

export function getRootDomain() {
  return (
    process.env.NEXT_PUBLIC_ROOT_DOMAIN?.trim().toLowerCase() ||
    process.env.ROOT_DOMAIN?.trim().toLowerCase() ||
    DEFAULT_ROOT_DOMAIN
  );
}

export function slugifyPortalSubdomain(value: string) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function normalizeClientLoginId(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9._-]+/g, "")
    .slice(0, 40);
}

function normalizeClientPortalAccountToken(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 40);
}

export function looksLikeEmail(value: string | null | undefined) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? "").trim());
}

export function buildClientPortalAuthEmail(
  clientId: string | null | undefined,
  loginId: string | null | undefined,
) {
  const normalizedClientId = normalizeClientPortalAccountToken(clientId);
  const normalizedLoginId = normalizeClientLoginId(loginId);

  if (!normalizedClientId || !normalizedLoginId) {
    return null;
  }

  return `${normalizedLoginId}--${normalizedClientId}@${CLIENT_PORTAL_AUTH_DOMAIN}`;
}

export function getClientPortalContext(hostInput: string | null | undefined): ClientPortalContext {
  const host = normalizeHost(hostInput);
  const rootDomain = getRootDomain();

  if (!host || host === "localhost" || host.endsWith(".localhost")) {
    return {
      isClientPortal: false,
      host,
      subdomain: null,
      rootDomain,
    };
  }

  if (host === rootDomain || host === `www.${rootDomain}`) {
    return {
      isClientPortal: false,
      host,
      subdomain: null,
      rootDomain,
    };
  }

  if (host.endsWith(`.${rootDomain}`)) {
    const subdomain = host.slice(0, -(`.${rootDomain}`.length));
    if (subdomain && subdomain !== "www") {
      return {
        isClientPortal: true,
        host,
        subdomain,
        rootDomain,
      };
    }
  }

  return {
    isClientPortal: false,
    host,
    subdomain: null,
    rootDomain,
  };
}

export function buildClientPortalUrl(subdomain: string | null | undefined) {
  const normalized = slugifyPortalSubdomain(subdomain ?? "");
  if (!normalized) return null;
  return `https://${normalized}.${getRootDomain()}`;
}
