import type { Env } from "./types";

export const SESSION_COOKIE = "fd_session";
export const OAUTH_COOKIE = "fd_oauth_state";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
export const AUTH_CODE_MAX_AGE_MS = 10 * 60 * 1000;

export const RESERVED_PATHS = new Set([
  "",
  ".well-known",
  "api",
  "authorize",
  "callback",
  "favicon.ico",
  "login",
  "logout",
  "manage",
  "oauth",
  "projects",
  "register",
  "token",
]);

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function assertEnv(env: Env) {
  if (!env.GITHUB_CLIENT_ID) {
    throw new Error("Missing GITHUB_CLIENT_ID");
  }
  if (!env.GITHUB_CLIENT_SECRET) {
    throw new Error("Missing GITHUB_CLIENT_SECRET");
  }
  if (!env.SESSION_SECRET) {
    throw new Error("Missing SESSION_SECRET");
  }
}

export function buildLoginUrl(request: Request): string {
  const url = new URL(request.url);
  return `/login?redirect_to=${encodeURIComponent(`${url.pathname}${url.search}`)}`;
}

export function buildLoginUrlFromPath(path: string): string {
  return `/login?redirect_to=${encodeURIComponent(path)}`;
}

export function safeInternalRedirect(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

export function safeProjectPath(value: string): string | null {
  const decoded = value
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");

  if (!decoded || decoded.startsWith("/") || decoded.includes("..")) {
    return null;
  }

  return decoded;
}

export function sanitizeSlug(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return /^[A-Za-z0-9._-]+$/.test(trimmed) ? trimmed : null;
}

export function sanitizeProjectFileName(value: string | undefined): string | null {
  return value ? safeProjectPath(value.trim()) : null;
}

export function slugifyProjectName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function sanitizeMessage(message: string): string {
  return message.slice(0, 500).trim();
}

export function normalizePathname(value: string): string {
  return value.length > 1 ? value.replace(/\/$/, "") : value;
}

export function humanizeSlug(slug: string): string {
  return slug
    .split(/[-_.]/g)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

export function isValidDomain(domain: string): boolean {
  const domainRegex =
    /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return domainRegex.test(domain) && domain.includes(".") && domain.length <= 253;
}

export function encodePathSegments(path: string): string {
  return path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

export function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function guessContentType(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase() || "";
  switch (extension) {
    case "css":
      return "text/css; charset=utf-8";
    case "gif":
      return "image/gif";
    case "html":
      return "text/html; charset=utf-8";
    case "ico":
      return "image/x-icon";
    case "jpeg":
    case "jpg":
      return "image/jpeg";
    case "js":
    case "mjs":
      return "application/javascript; charset=utf-8";
    case "json":
      return "application/json; charset=utf-8";
    case "md":
      return "text/markdown; charset=utf-8";
    case "png":
      return "image/png";
    case "svg":
      return "image/svg+xml; charset=utf-8";
    case "ts":
    case "tsx":
      return "text/plain; charset=utf-8";
    case "txt":
      return "text/plain; charset=utf-8";
    case "webp":
      return "image/webp";
    case "xml":
      return "application/xml; charset=utf-8";
    case "yaml":
    case "yml":
      return "application/yaml; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

export function chooseEntryFile(files: string[]): string | null {
  const normalized = new Set(files);
  if (normalized.has("index.html")) {
    return "index.html";
  }
  return files.find((file) => file.endsWith(".html")) || files[0] || null;
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return encodeBytesBase64Url(new Uint8Array(digest));
}

export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return encodeBytesBase64Url(bytes);
}

export async function generateBearerToken(
  username: string,
  keyId: string,
  secret: string,
): Promise<string> {
  return sign(`${username}:${keyId}:${Date.now()}`, secret);
}

export async function makeSignedCookie(
  name: string,
  value: unknown,
  maxAge: number,
  env: Env,
): Promise<string> {
  const payload = encodeBase64Url(JSON.stringify(value));
  const signature = await sign(payload, env.SESSION_SECRET);
  return serializeCookie(name, `${payload}.${signature}`, maxAge);
}

export async function readSignedCookie<T>(
  request: Request,
  name: string,
  env: Env,
): Promise<T | null> {
  const value = parseCookies(request.headers.get("Cookie") || "")[name];
  if (!value) {
    return null;
  }

  const [payload, signature] = value.split(".");
  if (!payload || !signature) {
    return null;
  }

  const expected = await sign(payload, env.SESSION_SECRET);
  if (signature !== expected) {
    return null;
  }

  try {
    const decoded = JSON.parse(decodeBase64Url(payload)) as T & { expiresAt?: number };
    if (typeof decoded.expiresAt === "number" && decoded.expiresAt < Date.now()) {
      return null;
    }
    return decoded as T;
  } catch {
    return null;
  }
}

export async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return encodeBytesBase64Url(new Uint8Array(signature));
}

export function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (!name || rest.length === 0) {
      continue;
    }
    cookies[name] = decodeURIComponent(rest.join("="));
  }
  return cookies;
}

export function serializeCookie(name: string, value: string, maxAge: number): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "Secure",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ].join("; ");
}

export function clearCookie(name: string): string {
  return serializeCookie(name, "", 0);
}

export function encodeBase64Url(value: string): string {
  return encodeBytesBase64Url(new TextEncoder().encode(value));
}

export function decodeBase64Url(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const normalized = padded + "=".repeat((4 - (padded.length % 4 || 4)) % 4);
  const binary = atob(normalized);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeBytesBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}

export function json(
  value: unknown,
  status = 200,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      ...(extraHeaders || {}),
    },
  });
}

export function redirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: location },
  });
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

export function isOAuthRoute(pathname: string): boolean {
  return (
    pathname === "/authorize" ||
    pathname === "/callback" ||
    pathname === "/oauth/callback" ||
    pathname === "/token" ||
    pathname === "/register" ||
    pathname.startsWith("/.well-known/")
  );
}
