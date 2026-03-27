var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/durable-objects.ts
import { DurableObject } from "cloudflare:workers";

// src/utils.ts
var SESSION_COOKIE = "fd_session";
var OAUTH_COOKIE = "fd_oauth_state";
var SESSION_MAX_AGE = 60 * 60 * 24 * 30;
var AUTH_CODE_MAX_AGE_MS = 10 * 60 * 1e3;
var RESERVED_PATHS = /* @__PURE__ */ new Set([
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
  "token"
]);
var corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};
function assertEnv(env) {
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
__name(assertEnv, "assertEnv");
function buildLoginUrl(request) {
  const url = new URL(request.url);
  return `/login?redirect_to=${encodeURIComponent(`${url.pathname}${url.search}`)}`;
}
__name(buildLoginUrl, "buildLoginUrl");
function buildLoginUrlFromPath(path) {
  return `/login?redirect_to=${encodeURIComponent(path)}`;
}
__name(buildLoginUrlFromPath, "buildLoginUrlFromPath");
function safeInternalRedirect(value) {
  if (!value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}
__name(safeInternalRedirect, "safeInternalRedirect");
function safeProjectPath(value) {
  const decoded = value.split("/").map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  }).join("/");
  if (!decoded || decoded.startsWith("/") || decoded.includes("..")) {
    return null;
  }
  return decoded;
}
__name(safeProjectPath, "safeProjectPath");
function sanitizeSlug(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return /^[A-Za-z0-9._-]+$/.test(trimmed) ? trimmed : null;
}
__name(sanitizeSlug, "sanitizeSlug");
function sanitizeProjectFileName(value) {
  return value ? safeProjectPath(value.trim()) : null;
}
__name(sanitizeProjectFileName, "sanitizeProjectFileName");
function slugifyProjectName(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
__name(slugifyProjectName, "slugifyProjectName");
function sanitizeMessage(message) {
  return message.slice(0, 500).trim();
}
__name(sanitizeMessage, "sanitizeMessage");
function normalizePathname(value) {
  return value.length > 1 ? value.replace(/\/$/, "") : value;
}
__name(normalizePathname, "normalizePathname");
function humanizeSlug(slug) {
  return slug.split(/[-_.]/g).filter(Boolean).map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(" ");
}
__name(humanizeSlug, "humanizeSlug");
function isValidDomain(domain) {
  const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return domainRegex.test(domain) && domain.includes(".") && domain.length <= 253;
}
__name(isValidDomain, "isValidDomain");
function encodePathSegments(path) {
  return path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}
__name(encodePathSegments, "encodePathSegments");
function formatBytes(value) {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
__name(formatBytes, "formatBytes");
function guessContentType(path) {
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
__name(guessContentType, "guessContentType");
function chooseEntryFile(files) {
  const normalized = new Set(files);
  if (normalized.has("index.html")) {
    return "index.html";
  }
  return files.find((file) => file.endsWith(".html")) || files[0] || null;
}
__name(chooseEntryFile, "chooseEntryFile");
async function generateCodeChallenge(verifier) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );
  return encodeBytesBase64Url(new Uint8Array(digest));
}
__name(generateCodeChallenge, "generateCodeChallenge");
function generateCodeVerifier() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return encodeBytesBase64Url(bytes);
}
__name(generateCodeVerifier, "generateCodeVerifier");
async function generateBearerToken(username, keyId, secret) {
  return sign(`${username}:${keyId}:${Date.now()}`, secret);
}
__name(generateBearerToken, "generateBearerToken");
async function makeSignedCookie(name, value, maxAge, env) {
  const payload = encodeBase64Url(JSON.stringify(value));
  const signature = await sign(payload, env.SESSION_SECRET);
  return serializeCookie(name, `${payload}.${signature}`, maxAge);
}
__name(makeSignedCookie, "makeSignedCookie");
async function readSignedCookie(request, name, env) {
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
    const decoded = JSON.parse(decodeBase64Url(payload));
    if (typeof decoded.expiresAt === "number" && decoded.expiresAt < Date.now()) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}
__name(readSignedCookie, "readSignedCookie");
async function sign(payload, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  );
  return encodeBytesBase64Url(new Uint8Array(signature));
}
__name(sign, "sign");
function parseCookies(cookieHeader) {
  const cookies = {};
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (!name || rest.length === 0) {
      continue;
    }
    cookies[name] = decodeURIComponent(rest.join("="));
  }
  return cookies;
}
__name(parseCookies, "parseCookies");
function serializeCookie(name, value, maxAge) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "Secure",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`
  ].join("; ");
}
__name(serializeCookie, "serializeCookie");
function clearCookie(name) {
  return serializeCookie(name, "", 0);
}
__name(clearCookie, "clearCookie");
function encodeBase64Url(value) {
  return encodeBytesBase64Url(new TextEncoder().encode(value));
}
__name(encodeBase64Url, "encodeBase64Url");
function decodeBase64Url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const normalized = padded + "=".repeat((4 - (padded.length % 4 || 4)) % 4);
  const binary = atob(normalized);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
__name(decodeBase64Url, "decodeBase64Url");
function encodeBytesBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
__name(encodeBytesBase64Url, "encodeBytesBase64Url");
function safeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
__name(safeJson, "safeJson");
function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store"
    }
  });
}
__name(html, "html");
function json(value, status = 200, extraHeaders) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      ...extraHeaders || {}
    }
  });
}
__name(json, "json");
function redirect(location) {
  return new Response(null, {
    status: 302,
    headers: { Location: location }
  });
}
__name(redirect, "redirect");
function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
__name(escapeHtml, "escapeHtml");
function escapeAttribute(value) {
  return escapeHtml(value);
}
__name(escapeAttribute, "escapeAttribute");
function isOAuthRoute(pathname) {
  return pathname === "/authorize" || pathname === "/callback" || pathname === "/oauth/callback" || pathname === "/token" || pathname === "/register" || pathname.startsWith("/.well-known/");
}
__name(isOAuthRoute, "isOAuthRoute");

// src/durable-objects.ts
var GlobalUsersDO = class extends DurableObject {
  static {
    __name(this, "GlobalUsersDO");
  }
  sql;
  constructor(state, env) {
    super(state, env);
    this.sql = state.storage.sql;
    state.blockConcurrencyWhile(async () => {
      this.migrate();
    });
  }
  async upsertGitHubUser(user, githubAccessToken) {
    this.sql.exec(
      `INSERT INTO users (
        username,
        name,
        email,
        avatar_url,
        github_access_token,
        created_at,
        updated_at,
        last_login_at
      ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(username) DO UPDATE SET
        name = excluded.name,
        email = excluded.email,
        avatar_url = excluded.avatar_url,
        github_access_token = excluded.github_access_token,
        updated_at = CURRENT_TIMESTAMP,
        last_login_at = CURRENT_TIMESTAMP`,
      user.login,
      user.name,
      user.email,
      user.avatar_url,
      githubAccessToken
    );
  }
  async getUser(username) {
    const row = this.sql.exec(
      `SELECT
          u.username,
          u.name,
          u.email,
          u.avatar_url,
          u.default_key_id,
          k.account_id AS cloudflare_account_id,
          k.name AS cloudflare_key_name
        FROM users u
        LEFT JOIN cloudflare_keys k ON u.default_key_id = k.id
        WHERE u.username = ?`,
      username
    ).toArray()[0];
    if (!row) {
      return null;
    }
    return {
      username: row.username,
      name: row.name,
      email: row.email,
      avatarUrl: row.avatar_url,
      cloudflareAccountId: row.cloudflare_account_id,
      cloudflareKeyName: row.cloudflare_key_name,
      defaultKeyId: row.default_key_id
    };
  }
  async getCloudflareKeys(username) {
    return this.sql.exec(
      `SELECT id, name, account_id, api_key, created_at, last_used_at
         FROM cloudflare_keys
         WHERE username = ?
         ORDER BY created_at DESC`,
      username
    ).toArray().map((row) => ({
      id: row.id,
      name: row.name,
      accountId: row.account_id,
      apiKey: row.api_key,
      createdAt: row.created_at,
      lastUsed: row.last_used_at
    }));
  }
  async addCloudflareKey(username, key) {
    this.sql.exec(
      `INSERT INTO cloudflare_keys (
        id,
        username,
        name,
        account_id,
        api_key,
        created_at,
        last_used_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      key.id,
      username,
      key.name,
      key.accountId,
      key.apiKey,
      key.createdAt,
      key.lastUsed
    );
    const user = this.sql.exec(
      `SELECT default_key_id FROM users WHERE username = ?`,
      username
    ).toArray()[0];
    if (user && !user.default_key_id) {
      this.sql.exec(
        `UPDATE users
         SET default_key_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE username = ?`,
        key.id,
        username
      );
    }
  }
  async setDefaultCloudflareKey(username, keyId) {
    const existing = this.sql.exec(
      `SELECT id FROM cloudflare_keys WHERE id = ? AND username = ?`,
      keyId,
      username
    ).toArray()[0];
    if (!existing) {
      return false;
    }
    this.sql.exec(
      `UPDATE users
       SET default_key_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE username = ?`,
      keyId,
      username
    );
    return true;
  }
  async removeCloudflareKey(username, keyId) {
    this.sql.exec(
      `DELETE FROM cloudflare_keys WHERE username = ? AND id = ?`,
      username,
      keyId
    );
    this.sql.exec(
      `UPDATE users
       SET default_key_id = CASE WHEN default_key_id = ? THEN NULL ELSE default_key_id END,
           updated_at = CURRENT_TIMESTAMP
       WHERE username = ?`,
      keyId,
      username
    );
    const user = this.sql.exec(
      `SELECT default_key_id FROM users WHERE username = ?`,
      username
    ).toArray()[0];
    if (user && !user.default_key_id) {
      const replacement = this.sql.exec(
        `SELECT id FROM cloudflare_keys WHERE username = ? ORDER BY created_at DESC LIMIT 1`,
        username
      ).toArray()[0];
      if (replacement) {
        this.sql.exec(
          `UPDATE users SET default_key_id = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?`,
          replacement.id,
          username
        );
      }
    }
  }
  async getCloudflareKey(username, keyId) {
    const row = this.sql.exec(
      `SELECT id, name, account_id, api_key, created_at, last_used_at
         FROM cloudflare_keys
         WHERE username = ? AND id = ?`,
      username,
      keyId
    ).toArray()[0];
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      name: row.name,
      accountId: row.account_id,
      apiKey: row.api_key,
      createdAt: row.created_at,
      lastUsed: row.last_used_at
    };
  }
  async touchCloudflareKey(username, keyId) {
    this.sql.exec(
      `UPDATE cloudflare_keys
       SET last_used_at = CURRENT_TIMESTAMP
       WHERE username = ? AND id = ?`,
      username,
      keyId
    );
    await this.setDefaultCloudflareKey(username, keyId);
  }
  async storeAuthCode(code, record) {
    this.purgeExpiredAuthCodes();
    this.sql.exec(
      `INSERT INTO auth_codes (
        code,
        username,
        client_id,
        redirect_uri,
        selected_key_id,
        resource,
        message,
        expires_at,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      code,
      record.username,
      record.clientId,
      record.redirectUri,
      record.selectedKeyId,
      record.resource || null,
      record.message || null,
      new Date(Date.now() + AUTH_CODE_MAX_AGE_MS).toISOString()
    );
  }
  async consumeAuthCode(code) {
    this.purgeExpiredAuthCodes();
    const row = this.sql.exec(
      `SELECT username, client_id, redirect_uri, selected_key_id, resource, message
         FROM auth_codes
         WHERE code = ?`,
      code
    ).toArray()[0];
    if (!row) {
      return null;
    }
    this.sql.exec(`DELETE FROM auth_codes WHERE code = ?`, code);
    return {
      username: row.username,
      clientId: row.client_id,
      redirectUri: row.redirect_uri,
      selectedKeyId: row.selected_key_id,
      resource: row.resource,
      message: row.message
    };
  }
  purgeExpiredAuthCodes() {
    this.sql.exec(`DELETE FROM auth_codes WHERE expires_at <= ?`, (/* @__PURE__ */ new Date()).toISOString());
  }
  migrate() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        name TEXT,
        email TEXT,
        avatar_url TEXT,
        github_access_token TEXT,
        default_key_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        last_login_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS cloudflare_keys (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        name TEXT NOT NULL,
        account_id TEXT NOT NULL,
        api_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_used_at TEXT,
        FOREIGN KEY (username) REFERENCES users(username)
      )
    `);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS auth_codes (
        code TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        client_id TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        selected_key_id TEXT NOT NULL,
        resource TEXT,
        message TEXT,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }
};
var UserProjectsDO = class extends DurableObject {
  static {
    __name(this, "UserProjectsDO");
  }
  envRef;
  sql;
  constructor(state, env) {
    super(state, env);
    this.envRef = env;
    this.sql = state.storage.sql;
    state.blockConcurrencyWhile(async () => {
      this.migrate();
    });
  }
  async listProjects(username) {
    await this.syncProjectsFromR2(username);
    return this.sql.exec(
      `SELECT slug, title, description, entry_file, file_count, synced_at, updated_at
         FROM projects
         ORDER BY updated_at DESC, slug ASC`
    ).toArray().map((row) => ({
      slug: row.slug,
      title: row.title,
      description: row.description,
      entryFile: row.entry_file,
      fileCount: row.file_count,
      syncedAt: row.synced_at,
      updatedAt: row.updated_at
    }));
  }
  async getProject(username, slug) {
    await this.syncProjectFromR2(username, slug);
    const row = this.sql.exec(
      `SELECT slug, title, description, entry_file, file_count, synced_at, updated_at
         FROM projects
         WHERE slug = ?`,
      slug
    ).toArray()[0];
    if (!row) {
      return null;
    }
    return {
      slug: row.slug,
      title: row.title,
      description: row.description,
      entryFile: row.entry_file,
      fileCount: row.file_count,
      syncedAt: row.synced_at,
      updatedAt: row.updated_at
    };
  }
  async chat(username, slug, message) {
    const project = await this.getProject(username, slug);
    if (!project) {
      throw new Error("Project not found");
    }
    this.sql.exec(
      `INSERT INTO chat_messages (project_slug, role, content, created_at)
       VALUES (?, ?, ?, ?)`,
      slug,
      "user",
      message,
      (/* @__PURE__ */ new Date()).toISOString()
    );
    const files = await listProjectFiles(this.envRef, username, slug);
    const assistantMessage = buildAssistantReply(project, files, message);
    this.sql.exec(
      `INSERT INTO chat_messages (project_slug, role, content, created_at)
       VALUES (?, ?, ?, ?)`,
      slug,
      "assistant",
      assistantMessage,
      (/* @__PURE__ */ new Date()).toISOString()
    );
    return {
      reply: assistantMessage,
      messages: await this.getChatMessages(slug)
    };
  }
  async getChatMessages(slug) {
    return this.sql.exec(
      `SELECT role, content, created_at
         FROM chat_messages
         WHERE project_slug = ?
         ORDER BY id ASC
         LIMIT 50`,
      slug
    ).toArray().map((row) => ({
      role: row.role,
      content: row.content,
      createdAt: row.created_at
    }));
  }
  async syncProjectsFromR2(username) {
    const prefix = `${username}/`;
    const slugs = await listProjectSlugs(this.envRef.PROJECTS, prefix);
    if (slugs.length === 0) {
      this.sql.exec(`DELETE FROM projects`);
      return;
    }
    for (const slug of slugs) {
      await this.syncProjectFromR2(username, slug);
    }
    const placeholders = slugs.map(() => "?").join(", ");
    this.sql.exec(`DELETE FROM projects WHERE slug NOT IN (${placeholders})`, ...slugs);
  }
  async syncProjectFromR2(username, slug) {
    const files = await listProjectFiles(this.envRef, username, slug);
    if (files.length === 0) {
      this.sql.exec(`DELETE FROM projects WHERE slug = ?`, slug);
      return;
    }
    const manifest = await readProjectManifest(this.envRef.PROJECTS, username, slug);
    const entryFile = sanitizeProjectFileName(manifest?.entryFile) ?? chooseEntryFile(files.map((file) => file.path));
    const title = manifest?.title?.trim() || humanizeSlug(slug);
    const description = manifest?.description?.trim() || null;
    this.sql.exec(
      `INSERT INTO projects (
        slug,
        title,
        description,
        entry_file,
        file_count,
        synced_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(slug) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        entry_file = excluded.entry_file,
        file_count = excluded.file_count,
        synced_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP`,
      slug,
      title,
      description,
      entryFile,
      files.length
    );
  }
  migrate() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        slug TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        entry_file TEXT,
        file_count INTEGER NOT NULL DEFAULT 0,
        synced_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_slug TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }
};
function buildAssistantReply(project, files, prompt) {
  const sampleFiles = files.slice(0, 5).map((file) => file.path).join(", ") || "none";
  return [
    `Project "${project.title}" is available from R2 with ${files.length} files.`,
    project.entryFile ? `The current preview entry is ${project.entryFile}.` : "There is no preview entry file configured yet.",
    `Sample files: ${sampleFiles}.`,
    `This chat is a placeholder inside the worker, so it does not call a model yet. Your last message was: "${prompt.slice(0, 140)}".`
  ].join(" ");
}
__name(buildAssistantReply, "buildAssistantReply");
async function listProjectSlugs(bucket, prefix) {
  const slugs = /* @__PURE__ */ new Set();
  let cursor;
  do {
    const listing = await bucket.list({ prefix, delimiter: "/", cursor });
    for (const value of listing.delimitedPrefixes || []) {
      const slug = value.slice(prefix.length).replace(/\/$/, "");
      slugs.add(slug);
    }
    for (const object of listing.objects) {
      const relativePath = object.key.slice(prefix.length);
      const slug = relativePath.split("/")[0] || "";
      if (slug) {
        slugs.add(slug);
      }
    }
    cursor = listing.truncated ? listing.cursor : void 0;
  } while (cursor);
  return [...slugs].sort();
}
__name(listProjectSlugs, "listProjectSlugs");
async function listProjectFiles(env, username, slug) {
  const files = [];
  let cursor;
  const prefix = `${username}/${slug}/`;
  do {
    const listing = await env.PROJECTS.list({ prefix, cursor });
    for (const object of listing.objects) {
      const relativePath = object.key.slice(prefix.length);
      if (relativePath) {
        files.push({ path: relativePath, size: object.size });
      }
    }
    cursor = listing.truncated ? listing.cursor : void 0;
  } while (cursor);
  return files;
}
__name(listProjectFiles, "listProjectFiles");
async function readProjectManifest(bucket, username, slug) {
  const object = await bucket.get(`${username}/${slug}/project.json`);
  if (!object) {
    return null;
  }
  try {
    return await object.json();
  } catch {
    return null;
  }
}
__name(readProjectManifest, "readProjectManifest");

// src/env.ts
function getGlobalUsersDO(env) {
  return env.GLOBAL_USERS.get(env.GLOBAL_USERS.idFromName("global-users"));
}
__name(getGlobalUsersDO, "getGlobalUsersDO");
function getUserProjectsDO(env, username) {
  return env.USER_PROJECTS.get(
    env.USER_PROJECTS.idFromName(`projects:${username}`)
  );
}
__name(getUserProjectsDO, "getUserProjectsDO");

// src/render.ts
function renderSignedOutPage() {
  return renderDocument({
    title: "Flaredream App",
    body: `
      <main class="shell shell-center">
        <section class="hero-card">
          <p class="eyebrow">app.flaredream.com</p>
          <h1>One worker now handles login, keys, and your R2-backed projects.</h1>
          <p class="lede">
            Authentication and Cloudflare key management are hosted on this same domain.
            Project files are served from the <code>projects</code> R2 bucket at
            <code>/&#123;githubUsername&#125;/&#123;projectSlug&#125;/&#123;...files&#125;</code>.
          </p>
          <div class="actions">
            <a class="button button-primary" href="/login">Login with GitHub</a>
            <a class="button button-secondary" href="/manage">Manage Cloudflare keys</a>
          </div>
        </section>
      </main>
    `
  });
}
__name(renderSignedOutPage, "renderSignedOutPage");
function renderDashboardPage(user, projects, options = {}) {
  const values = options.createValues || { title: "", slug: "", description: "" };
  const projectCards = projects.map(
    (project) => `
        <article class="project-card">
          <div class="project-card-header">
            <div>
              <h2>${escapeHtml(project.title)}</h2>
              <span class="project-slug">/${escapeHtml(project.slug)}</span>
            </div>
            <div class="project-card-actions">
              <a class="button button-secondary" href="/${encodeURIComponent(project.slug)}">Open</a>
              <form method="POST" action="/projects/${encodeURIComponent(
      project.slug
    )}/delete" onsubmit="return confirm('Delete ${escapeAttribute(
      project.slug
    )}? This removes all project files from R2.');">
                <button class="button button-danger" type="submit">Delete</button>
              </form>
            </div>
          </div>
          <p class="project-description">${project.description ? escapeHtml(project.description) : "No description provided."}</p>
          <div class="project-meta">
            <span>${project.fileCount} files</span>
            <span>${project.entryFile ? `entry: ${escapeHtml(project.entryFile)}` : "no entry file"}</span>
          </div>
        </article>
      `
  ).join("");
  return renderDocument({
    title: "Flaredream Dashboard",
    body: `
      <main class="shell">
        <header class="topbar">
          <div>
            <p class="eyebrow">Flaredream Dashboard</p>
            <h1>Your projects</h1>
          </div>
          <div class="user-pill">
            ${renderAvatar(user)}
            <div>
              <strong>${escapeHtml(user.name || user.username)}</strong>
              <span>@${escapeHtml(user.username)}</span>
            </div>
          </div>
        </header>

        <section class="stats-row">
          <div class="stat-card">
            <span class="stat-label">Projects</span>
            <strong>${projects.length}</strong>
          </div>
          <div class="stat-card">
            <span class="stat-label">Cloudflare Account</span>
            <strong>${escapeHtml(user.cloudflareAccountId || "No default key selected")}</strong>
          </div>
          <div class="stat-card">
            <span class="stat-label">Cloudflare Key</span>
            <strong>${escapeHtml(user.cloudflareKeyName || "No default key selected")}</strong>
          </div>
        </section>

        <section class="dashboard-actions">
          <details class="create-project-details" ${options.createError ? "open" : ""}>
            <summary class="button button-primary">Create Project</summary>
            <div class="create-project-form-wrap">
              ${options.createError ? `<p class="form-error">${escapeHtml(options.createError)}</p>` : ""}
              <form method="POST" action="/projects/create" class="stack-form">
                <label>
                  <span>Title</span>
                  <input name="title" type="text" required value="${escapeAttribute(
      values.title
    )}" placeholder="Portfolio">
                </label>
                <label>
                  <span>Slug</span>
                  <input name="slug" type="text" value="${escapeAttribute(
      values.slug
    )}" placeholder="portfolio">
                </label>
                <label>
                  <span>Description</span>
                  <textarea name="description" rows="3" placeholder="Short project description">${escapeHtml(
      values.description
    )}</textarea>
                </label>
                <button class="button button-primary" type="submit">Create Project</button>
              </form>
            </div>
          </details>
          <a class="button button-secondary" href="/manage">Manage Cloudflare keys</a>
          <a class="button button-secondary" href="/logout">Log out</a>
        </section>

        <section class="grid">
          ${projects.length > 0 ? projectCards : `<section class="empty-state">
                  <h2>No projects found yet</h2>
                  <p>Put files in <code>/${escapeHtml(
      user.username
    )}/&#123;projectSlug&#125;/...</code> or create a starter project.</p>
                </section>`}
        </section>
      </main>
    `
  });
}
__name(renderDashboardPage, "renderDashboardPage");
function renderManagePage(user, keys, error, oauth) {
  const genericTokensUrl = "https://dash.cloudflare.com/?to=/:account/api-tokens";
  const keyItems = keys.map((key) => {
    const isDefault = user.defaultKeyId === key.id;
    const accountTokensUrl = `https://dash.cloudflare.com/?to=/${encodeURIComponent(
      key.accountId
    )}/api-tokens`;
    return `
        <article class="key-card">
          <div class="key-copy">
            <h2>${escapeHtml(key.name)}</h2>
            <p>Account ${escapeHtml(key.accountId)}</p>
            <small>Added ${escapeHtml(new Date(key.createdAt).toLocaleDateString())}</small>
            <small><a class="resource-link inline-link" href="${accountTokensUrl}" target="_blank" rel="noreferrer">Open Cloudflare API tokens for this account</a></small>
          </div>
          <div class="key-actions">
            ${isDefault ? `<span class="status-pill">Default</span>` : `<form method="POST">
                     <input type="hidden" name="action" value="default">
                     <input type="hidden" name="keyId" value="${escapeAttribute(key.id)}">
                     <button class="button button-secondary" type="submit">Set Default</button>
                   </form>`}
            ${oauth?.isOauthFlow ? `<form method="POST">
                     <input type="hidden" name="action" value="select">
                     <input type="hidden" name="keyId" value="${escapeAttribute(key.id)}">
                     <button class="button button-primary" type="submit">Use This Key</button>
                   </form>` : ""}
            <form method="POST">
              <input type="hidden" name="action" value="delete">
              <input type="hidden" name="keyId" value="${escapeAttribute(key.id)}">
              <button class="button button-danger" type="submit">Delete</button>
            </form>
          </div>
        </article>
      `;
  }).join("");
  return renderDocument({
    title: oauth?.isOauthFlow ? "Authorize Cloudflare Access" : "Manage Cloudflare Keys",
    body: `
      <main class="shell shell-manage">
        <header class="topbar">
          <div>
            <p class="eyebrow">${oauth?.isOauthFlow ? "OAuth Authorization" : "Cloudflare Keys"}</p>
            <h1>${oauth?.isOauthFlow ? "Choose a Cloudflare key" : "Manage your Cloudflare keys"}</h1>
            <p class="lede">${oauth?.isOauthFlow ? escapeHtml(
      oauth.message || "Select which Cloudflare API token should be returned to the requesting client."
    ) : "These keys stay attached to your GitHub identity inside the app worker."}</p>
          </div>
          <div class="user-pill">
            ${renderAvatar(user)}
            <div>
              <strong>${escapeHtml(user.name || user.username)}</strong>
              <span>@${escapeHtml(user.username)}</span>
            </div>
          </div>
        </header>

        ${oauth?.isOauthFlow ? `<section class="oauth-details">
                 <strong>Client:</strong> ${escapeHtml(oauth.clientId)}<br>
                 <strong>Redirect URI:</strong> ${escapeHtml(oauth.redirectUri)}
               </section>` : ""}

        ${error ? `<section class="error-box">${escapeHtml(error)}</section>` : ""}

        <section class="manage-layout">
          <section class="panel">
            <div class="panel-header">
              <h2>Saved keys</h2>
              <span>${keys.length}</span>
            </div>
            <div class="keys-stack">
              ${keyItems || `<div class="panel-empty">No keys stored yet. Add one below.</div>`}
            </div>
          </section>

          <section class="panel">
            <div class="panel-header">
              <h2>Add key</h2>
              <span>Validated against Cloudflare</span>
            </div>
            <div class="resource-links">
              <a class="resource-link" href="${genericTokensUrl}" target="_blank" rel="noreferrer">Open Cloudflare API tokens</a>
            </div>
            <p class="field-help">
              Token URL format: <code>${escapeHtml(genericTokensUrl)}</code>
            </p>
            <p class="field-help">
              The account ID is shown in the right sidebar of the Cloudflare dashboard.
            </p>
            <form method="POST" class="stack-form">
              <input type="hidden" name="action" value="add">
              <label>
                <span>Key name</span>
                <input name="name" type="text" required placeholder="Production account token">
              </label>
              <label>
                <span>Account ID</span>
                <input name="accountId" type="text" required placeholder="1234567890abcdef1234567890abcdef">
              </label>
              <label>
                <span>API token</span>
                <input name="apiKey" type="password" required placeholder="Cloudflare API token">
              </label>
              <button class="button button-primary" type="submit">Save key</button>
            </form>
          </section>
        </section>

        <section class="dashboard-actions">
          <a class="button button-secondary" href="/">Back to dashboard</a>
          <a class="button button-secondary" href="/logout">Log out</a>
        </section>
      </main>
    `
  });
}
__name(renderManagePage, "renderManagePage");
function renderProjectPage(user, project, files, messages) {
  const sortedFiles = [...files].sort((left, right) => left.path.localeCompare(right.path));
  const previewPath = project.entryFile ? `/${encodeURIComponent(project.slug)}/files/${encodePathSegments(project.entryFile)}` : null;
  const initialState = {
    slug: project.slug,
    files: sortedFiles,
    messages
  };
  const sidebar = sortedFiles.map(
    (file) => `
        <button class="file-link" data-file-path="${escapeAttribute(file.path)}" type="button">
          <span>${escapeHtml(file.path)}</span>
          <small>${formatBytes(file.size)}</small>
        </button>
      `
  ).join("");
  return renderDocument({
    title: `${project.title} \xB7 Flaredream`,
    body: `
      <main class="shell shell-project">
        <header class="project-topbar">
          <div>
            <a class="back-link" href="/">Back to dashboard</a>
            <h1>${escapeHtml(project.title)}</h1>
            <p class="project-caption">${escapeHtml(project.description || "R2-backed project view")}</p>
          </div>
          <div class="user-pill compact">
            ${renderAvatar(user)}
            <div>
              <strong>@${escapeHtml(user.username)}</strong>
              <span>${project.fileCount} files</span>
            </div>
          </div>
        </header>

        <section class="project-layout">
          <aside class="panel file-panel">
            <div class="panel-header">
              <h2>Files</h2>
              <span>${project.fileCount}</span>
            </div>
            <div class="file-list">
              ${sidebar || `<p class="panel-empty">No files in this project.</p>`}
            </div>
          </aside>

          <section class="panel preview-panel">
            <div class="panel-header">
              <h2>Preview</h2>
              <span>${escapeHtml(project.entryFile || "No entry file")}</span>
            </div>
            ${previewPath ? `<iframe class="preview-frame" src="${escapeAttribute(previewPath)}" title="Project preview"></iframe>` : `<div class="panel-empty">Add an <code>index.html</code> or configure <code>project.json</code> with <code>entryFile</code>.</div>`}
          </section>

          <section class="panel inspector-panel">
            <div class="panel-header">
              <h2>Inspector</h2>
              <span id="inspector-path">Select a file</span>
            </div>
            <pre id="inspector-content" class="code-view">Choose a text file from the list.</pre>
          </section>

          <section class="panel chat-panel">
            <div class="panel-header">
              <h2>Chat</h2>
              <span>Simple placeholder assistant</span>
            </div>
            <div id="chat-log" class="chat-log"></div>
            <form id="chat-form" class="chat-form">
              <textarea id="chat-input" name="message" rows="3" placeholder="Ask about this project"></textarea>
              <button class="button button-primary" type="submit">Send</button>
            </form>
          </section>
        </section>
      </main>
      <script>
        const initialState = ${safeJson(initialState)};
        const textExtensions = new Set(["css","html","js","json","md","svg","ts","txt","tsx","jsx","yml","yaml"]);
        const inspectorPath = document.getElementById("inspector-path");
        const inspectorContent = document.getElementById("inspector-content");
        const chatLog = document.getElementById("chat-log");
        const chatForm = document.getElementById("chat-form");
        const chatInput = document.getElementById("chat-input");

        function escapeHtml(value) {
          return value
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
        }

        function isLikelyTextFile(file) {
          const ext = file.path.includes(".") ? file.path.split(".").pop().toLowerCase() : "";
          return textExtensions.has(ext) || (file.contentType || "").startsWith("text/");
        }

        async function showFile(filePath) {
          inspectorPath.textContent = filePath;
          inspectorContent.textContent = "Loading...";
          const response = await fetch("/" + encodeURIComponent(initialState.slug) + "/files/" + filePath.split("/").map(encodeURIComponent).join("/"));
          inspectorContent.textContent = response.ok ? await response.text() : "Failed to load file.";
        }

        function renderMessages(messages) {
          chatLog.innerHTML = messages.map((message) => {
            return '<article class="chat-message chat-' + message.role + '">' +
              '<strong>' + (message.role === "assistant" ? "Assistant" : "You") + '</strong>' +
              '<p>' + escapeHtml(message.content) + '</p>' +
            '</article>';
          }).join("");
          chatLog.scrollTop = chatLog.scrollHeight;
        }

        document.querySelectorAll(".file-link").forEach((button) => {
          button.addEventListener("click", () => showFile(button.dataset.filePath));
        });

        const firstTextFile = initialState.files.find((file) => isLikelyTextFile(file));
        if (firstTextFile) {
          showFile(firstTextFile.path);
        }

        renderMessages(initialState.messages);

        chatForm.addEventListener("submit", async (event) => {
          event.preventDefault();
          const message = chatInput.value.trim();
          if (!message) return;

          chatInput.value = "";
          const optimistic = [...initialState.messages, { role: "user", content: message }];
          renderMessages(optimistic);

          const response = await fetch("/api/projects/" + encodeURIComponent(initialState.slug) + "/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message })
          });

          if (!response.ok) {
            renderMessages([...optimistic, { role: "assistant", content: "Chat request failed." }]);
            return;
          }

          const data = await response.json();
          initialState.messages = data.messages || [];
          renderMessages(initialState.messages);
        });
      <\/script>
    `
  });
}
__name(renderProjectPage, "renderProjectPage");
function renderAvatar(user) {
  return user.avatarUrl ? `<img alt="" class="avatar" src="${escapeAttribute(user.avatarUrl)}">` : `<div class="avatar avatar-fallback">${escapeHtml(
    user.username.slice(0, 1).toUpperCase()
  )}</div>`;
}
__name(renderAvatar, "renderAvatar");
function renderDocument(input) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(input.title)}</title>
  <style>
    :root {
      --bg: #f3ede2;
      --ink: #17120d;
      --panel: rgba(255, 252, 246, 0.86);
      --panel-border: rgba(23, 18, 13, 0.12);
      --accent: #d04c28;
      --accent-deep: #8a2f17;
      --muted: #66584a;
      --shadow: 0 24px 60px rgba(63, 39, 16, 0.16);
      --radius: 28px;
      --mono: "SFMono-Regular", Menlo, Consolas, monospace;
      --sans: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif;
      --danger: #a43b23;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      font-family: var(--sans);
      background:
        radial-gradient(circle at top left, rgba(208, 76, 40, 0.22), transparent 28%),
        radial-gradient(circle at top right, rgba(212, 153, 75, 0.18), transparent 30%),
        linear-gradient(180deg, #f8f3ea, var(--bg));
      min-height: 100vh;
    }
    a { color: inherit; text-decoration: none; }
    code, pre, textarea, input { font-family: var(--mono); }
    .shell { max-width: 1280px; margin: 0 auto; padding: 36px 20px 48px; }
    .shell-center { display: grid; min-height: 100vh; place-items: center; }
    .shell-project { max-width: 1440px; }
    .shell-manage { max-width: 1180px; }
    .hero-card, .panel, .stat-card, .project-card, .empty-state, .oauth-details, .error-box, .key-card {
      background: var(--panel);
      backdrop-filter: blur(16px);
      border: 1px solid var(--panel-border);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
    }
    .hero-card { max-width: 760px; padding: 40px; }
    .hero-card h1, .topbar h1, .project-topbar h1 { margin: 0; font-size: clamp(2.2rem, 4vw, 4rem); line-height: 0.95; letter-spacing: -0.04em; }
    .eyebrow { margin: 0 0 12px; color: var(--accent-deep); text-transform: uppercase; letter-spacing: 0.14em; font-size: 0.75rem; }
    .lede, .project-caption, .project-description, .panel-empty, .field-help { color: var(--muted); font-size: 1.05rem; line-height: 1.6; }
    .actions, .dashboard-actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 24px; align-items: flex-start; }
    .button {
      display: inline-flex; align-items: center; justify-content: center;
      padding: 12px 18px; border-radius: 999px; font-size: 0.95rem;
      border: 1px solid transparent; transition: transform 140ms ease;
      cursor: pointer; background: white;
    }
    .button:hover { transform: translateY(-1px); }
    .button-primary { background: linear-gradient(135deg, #d04c28, #ef8f39); color: white; }
    .button-secondary { background: rgba(255, 255, 255, 0.6); border-color: rgba(23, 18, 13, 0.12); }
    .button-danger { background: rgba(164, 59, 35, 0.12); color: var(--danger); border-color: rgba(164, 59, 35, 0.16); }
    .topbar, .project-topbar {
      display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 24px;
    }
    .user-pill {
      display: inline-flex; align-items: center; gap: 12px; padding: 10px 14px;
      background: rgba(255, 255, 255, 0.72); border: 1px solid rgba(23, 18, 13, 0.08); border-radius: 999px;
    }
    .user-pill span { display: block; color: var(--muted); font-size: 0.88rem; }
    .compact { align-self: center; }
    .avatar { width: 42px; height: 42px; border-radius: 50%; object-fit: cover; }
    .avatar-fallback {
      display: grid; place-items: center; background: linear-gradient(135deg, #d04c28, #ef8f39); color: white; font-weight: 700;
    }
    .stats-row { display: grid; gap: 14px; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-bottom: 20px; }
    .stat-card { padding: 20px; }
    .stat-card strong { display: block; font-size: 1.2rem; margin-top: 6px; word-break: break-word; }
    .stat-label { color: var(--muted); font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.08em; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-top: 24px; }
    .project-card, .empty-state { padding: 22px; }
    .project-card-header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
    .project-card-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .project-card h2, .panel-header h2, .key-copy h2 { margin: 0; font-size: 1.35rem; }
    .project-slug, .panel-header span, .back-link { color: var(--muted); font-size: 0.9rem; }
    .project-meta { display: flex; justify-content: space-between; gap: 12px; margin-top: 16px; color: var(--muted); font-size: 0.88rem; }
    .create-project-details summary { list-style: none; }
    .create-project-details summary::-webkit-details-marker { display: none; }
    .create-project-form-wrap {
      margin-top: 12px;
      width: min(420px, calc(100vw - 48px));
      padding: 18px;
      background: rgba(255, 255, 255, 0.72);
      border: 1px solid rgba(23, 18, 13, 0.08);
      border-radius: 24px;
      box-shadow: var(--shadow);
    }
    .form-error { margin: 0 0 12px; color: var(--danger); }
    .oauth-details, .error-box { padding: 16px 18px; margin-bottom: 18px; }
    .error-box { border-color: rgba(160, 38, 18, 0.18); background: rgba(208, 76, 40, 0.1); }
    .manage-layout { display: grid; gap: 16px; grid-template-columns: 1.1fr 0.9fr; }
    .keys-stack { display: grid; gap: 12px; }
    .key-card { padding: 18px; display: flex; justify-content: space-between; gap: 16px; }
    .key-copy p, .key-copy small { display: block; margin: 6px 0 0; color: var(--muted); }
    .key-actions { display: flex; flex-direction: column; gap: 10px; align-items: flex-end; }
    .status-pill {
      display: inline-flex; align-items: center; justify-content: center; padding: 8px 12px;
      border-radius: 999px; background: rgba(208, 76, 40, 0.14); color: var(--accent-deep); font-size: 0.82rem;
    }
    .stack-form { display: grid; gap: 12px; }
    .stack-form label { display: grid; gap: 8px; color: var(--muted); }
    .resource-links { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; }
    .resource-link {
      display: inline-flex; padding: 10px 14px; border-radius: 999px;
      background: rgba(255, 255, 255, 0.8); border: 1px solid rgba(23, 18, 13, 0.08);
    }
    .inline-link { padding: 0; border: 0; background: transparent; }
    input, textarea {
      width: 100%; border-radius: 18px; border: 1px solid rgba(23, 18, 13, 0.12);
      padding: 14px; font-size: 0.95rem; background: rgba(255, 255, 255, 0.9);
    }
    .project-layout {
      display: grid; gap: 16px;
      grid-template-columns: minmax(220px, 280px) minmax(0, 1.2fr) minmax(320px, 0.9fr);
      grid-template-areas:
        "files preview inspector"
        "files chat inspector";
    }
    .file-panel { grid-area: files; }
    .preview-panel { grid-area: preview; min-height: 420px; }
    .inspector-panel { grid-area: inspector; }
    .chat-panel { grid-area: chat; }
    .panel { padding: 18px; min-height: 220px; }
    .panel-header { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; margin-bottom: 16px; }
    .file-list { display: flex; flex-direction: column; gap: 8px; max-height: 720px; overflow: auto; }
    .file-link {
      text-align: left; width: 100%; border: 1px solid rgba(23, 18, 13, 0.08);
      background: rgba(255, 255, 255, 0.7); border-radius: 18px; padding: 12px 14px; cursor: pointer;
    }
    .file-link span, .file-link small { display: block; }
    .file-link small { margin-top: 4px; color: var(--muted); }
    .preview-frame { width: 100%; min-height: 520px; border: 1px solid rgba(23, 18, 13, 0.08); border-radius: 20px; background: white; }
    .code-view {
      margin: 0; border-radius: 20px; padding: 16px; min-height: 520px; overflow: auto;
      background: #1d1a17; color: #f5efe7; font-size: 0.88rem; line-height: 1.55; white-space: pre-wrap; word-break: break-word;
    }
    .chat-log { display: flex; flex-direction: column; gap: 10px; min-height: 220px; max-height: 340px; overflow: auto; margin-bottom: 12px; }
    .chat-message { border-radius: 18px; padding: 12px 14px; background: rgba(255, 255, 255, 0.7); border: 1px solid rgba(23, 18, 13, 0.08); }
    .chat-assistant { background: rgba(208, 76, 40, 0.08); }
    .chat-message strong { display: block; margin-bottom: 6px; }
    .chat-message p { margin: 0; color: var(--muted); white-space: pre-wrap; }
    .chat-form { display: grid; gap: 10px; }
    @media (max-width: 1080px) {
      .project-layout {
        grid-template-columns: 1fr;
        grid-template-areas: "preview" "inspector" "chat" "files";
      }
      .manage-layout, .stats-row { grid-template-columns: 1fr; }
      .key-card, .project-card-header { flex-direction: column; }
      .key-actions, .project-card-actions { align-items: stretch; justify-content: stretch; }
    }
    @media (max-width: 720px) {
      .shell { padding: 20px 14px 32px; }
      .topbar, .project-topbar { flex-direction: column; }
      .hero-card, .panel, .project-card, .stat-card, .empty-state, .oauth-details, .error-box, .key-card {
        border-radius: 22px;
      }
      .create-project-form-wrap { width: 100%; }
    }
  </style>
</head>
<body>
  ${input.body}
</body>
</html>`;
}
__name(renderDocument, "renderDocument");

// src/auth.ts
async function getIdentity(request, env) {
  const session = await readSignedCookie(request, SESSION_COOKIE, env);
  if (!session) {
    return null;
  }
  const user = await getGlobalUsersDO(env).getUser(session.githubUsername);
  if (!user) {
    return null;
  }
  return { session, user };
}
__name(getIdentity, "getIdentity");
async function handleAuthorize(request, env) {
  const url = new URL(request.url);
  const clientId = url.searchParams.get("client_id");
  const redirectTo = safeInternalRedirect(url.searchParams.get("redirect_to") || "/");
  const redirectUri = url.searchParams.get("redirect_uri");
  const responseType = url.searchParams.get("response_type") || "code";
  const originalState = url.searchParams.get("state");
  const resource = url.searchParams.get("resource");
  const message = sanitizeMessage(url.searchParams.get("message") || "");
  if (!clientId) {
    const identity2 = await getIdentity(request, env);
    if (identity2) {
      return redirect(redirectTo);
    }
    const state = {
      redirectTo,
      codeVerifier: generateCodeVerifier(),
      resource: resource || void 0,
      message: message || void 0
    };
    return redirectToGitHub(url.origin, env, state);
  }
  if (!isValidDomain(clientId) && clientId !== "localhost") {
    return new Response("Invalid client_id", { status: 400 });
  }
  if (responseType !== "code") {
    return new Response("Unsupported response_type", { status: 400 });
  }
  const effectiveRedirectUri = redirectUri || `https://${clientId}/callback`;
  try {
    const redirectUrl = new URL(effectiveRedirectUri);
    if (redirectUrl.hostname !== clientId) {
      return new Response("Invalid redirect_uri", { status: 400 });
    }
    if (redirectUrl.protocol !== "https:" && clientId !== "localhost") {
      return new Response("Invalid redirect_uri", { status: 400 });
    }
  } catch {
    return new Response("Invalid redirect_uri format", { status: 400 });
  }
  const identity = await getIdentity(request, env);
  if (!identity) {
    const state = {
      redirectTo: `${url.pathname}${url.search}`,
      codeVerifier: generateCodeVerifier(),
      resource: resource || void 0,
      clientId,
      originalState: originalState || void 0,
      redirectUri: effectiveRedirectUri,
      message: message || void 0
    };
    return redirectToGitHub(url.origin, env, state);
  }
  return handleAuthorizeKeySelection(
    request,
    env,
    identity.user,
    clientId,
    effectiveRedirectUri,
    originalState,
    resource,
    message || void 0
  );
}
__name(handleAuthorize, "handleAuthorize");
async function handleCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const oauthState = await readSignedCookie(request, OAUTH_COOKIE, env);
  if (!code || !stateParam || !oauthState) {
    return new Response("Invalid callback", { status: 400 });
  }
  if (stateParam !== encodeBase64Url(JSON.stringify(oauthState))) {
    return new Response("Invalid state", { status: 400 });
  }
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${url.origin}/callback`,
      code_verifier: oauthState.codeVerifier
    })
  });
  const tokenData = await tokenResponse.json().catch(() => null);
  if (!tokenResponse.ok || !tokenData?.access_token) {
    return new Response("Failed to get GitHub access token", { status: 400 });
  }
  const userResponse = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      "User-Agent": "Flaredream"
    }
  });
  if (!userResponse.ok) {
    return new Response("Failed to fetch GitHub user", { status: 400 });
  }
  const user = await userResponse.json();
  const globalUsers = getGlobalUsersDO(env);
  await globalUsers.upsertGitHubUser(user, tokenData.access_token);
  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    await makeSignedCookie(
      SESSION_COOKIE,
      {
        githubUsername: user.login,
        expiresAt: Date.now() + SESSION_MAX_AGE * 1e3
      },
      SESSION_MAX_AGE,
      env
    )
  );
  headers.append("Set-Cookie", clearCookie(OAUTH_COOKIE));
  if (oauthState.clientId && oauthState.redirectUri) {
    const next = new URL(`${url.origin}/authorize`);
    next.searchParams.set("client_id", oauthState.clientId);
    next.searchParams.set("redirect_uri", oauthState.redirectUri);
    next.searchParams.set("response_type", "code");
    if (oauthState.originalState) {
      next.searchParams.set("state", oauthState.originalState);
    }
    if (oauthState.resource) {
      next.searchParams.set("resource", oauthState.resource);
    }
    if (oauthState.message) {
      next.searchParams.set("message", oauthState.message);
    }
    headers.set("Location", next.toString());
    return new Response(null, { status: 302, headers });
  }
  headers.set("Location", oauthState.redirectTo || "/");
  return new Response(null, { status: 302, headers });
}
__name(handleCallback, "handleCallback");
async function handleToken(request, env) {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405, corsHeaders);
  }
  const formData = await request.formData();
  const grantType = formData.get("grant_type")?.toString();
  const code = formData.get("code")?.toString();
  const clientId = formData.get("client_id")?.toString();
  const redirectUri = formData.get("redirect_uri")?.toString();
  const resource = formData.get("resource")?.toString();
  if (grantType !== "authorization_code" || !code || !clientId) {
    return json({ error: "invalid_request" }, 400, corsHeaders);
  }
  const globalUsers = getGlobalUsersDO(env);
  const auth = await globalUsers.consumeAuthCode(code);
  if (!auth) {
    return json({ error: "invalid_grant" }, 400, corsHeaders);
  }
  if (auth.clientId !== clientId) {
    return json({ error: "invalid_grant" }, 400, corsHeaders);
  }
  if (redirectUri && auth.redirectUri !== redirectUri) {
    return json({ error: "invalid_grant" }, 400, corsHeaders);
  }
  if (resource && auth.resource !== resource) {
    return json({ error: "invalid_grant" }, 400, corsHeaders);
  }
  const [user, key] = await Promise.all([
    globalUsers.getUser(auth.username),
    globalUsers.getCloudflareKey(auth.username, auth.selectedKeyId)
  ]);
  if (!user || !key) {
    return json({ error: "invalid_grant" }, 400, corsHeaders);
  }
  await globalUsers.touchCloudflareKey(auth.username, key.id);
  return json(
    {
      access_token: await generateBearerToken(auth.username, key.id, env.SESSION_SECRET),
      token_type: "bearer",
      scope: "user:email",
      github_username: auth.username,
      github_name: user.name,
      github_email: user.email,
      github_avatar_url: user.avatarUrl,
      cloudflare_account_id: key.accountId,
      cloudflare_api_key: key.apiKey,
      cloudflare_key_name: key.name,
      ...auth.message ? { message: auth.message } : {}
    },
    200,
    corsHeaders
  );
}
__name(handleToken, "handleToken");
async function handleRegister(request) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  try {
    const body = await request.json();
    if (!body.redirect_uris || !Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0) {
      return json(
        {
          error: "invalid_client_metadata",
          error_description: "redirect_uris must be a non-empty array"
        },
        400,
        corsHeaders
      );
    }
    const hosts = /* @__PURE__ */ new Set();
    for (const uri of body.redirect_uris) {
      hosts.add(new URL(uri).host);
    }
    if (hosts.size !== 1) {
      return json(
        {
          error: "invalid_client_metadata",
          error_description: "All redirect URIs must have the same host"
        },
        400,
        corsHeaders
      );
    }
    return json(
      {
        client_id: [...hosts][0],
        redirect_uris: body.redirect_uris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code"],
        response_types: ["code"]
      },
      201,
      { ...corsHeaders, "Cache-Control": "no-store", Pragma: "no-cache" }
    );
  } catch {
    return json(
      {
        error: "invalid_client_metadata",
        error_description: "Invalid JSON in request body"
      },
      400,
      corsHeaders
    );
  }
}
__name(handleRegister, "handleRegister");
async function handleManage(request, env) {
  const identity = await getIdentity(request, env);
  if (!identity) {
    return redirect(buildLoginUrlFromPath("/manage"));
  }
  const globalUsers = getGlobalUsersDO(env);
  const currentUrl = new URL(request.url);
  if (request.method === "POST") {
    const formData = await request.formData();
    const result = await applyKeyAction(globalUsers, identity.user.username, formData);
    if (!result.ok) {
      const error = "error" in result ? result.error : "Request failed.";
      const [user2, keys2] = await Promise.all([
        globalUsers.getUser(identity.user.username),
        globalUsers.getCloudflareKeys(identity.user.username)
      ]);
      if (!user2) {
        return redirect(buildLoginUrlFromPath("/manage"));
      }
      return html(renderManagePage(user2, keys2, error), 400);
    }
    if (result.mutated) {
      return redirect(currentUrl.pathname + currentUrl.search);
    }
  }
  const [user, keys] = await Promise.all([
    globalUsers.getUser(identity.user.username),
    globalUsers.getCloudflareKeys(identity.user.username)
  ]);
  if (!user) {
    return redirect(buildLoginUrlFromPath("/manage"));
  }
  return html(renderManagePage(user, keys), 200);
}
__name(handleManage, "handleManage");
function handleLogout(request) {
  const url = new URL(request.url);
  const redirectTo = safeInternalRedirect(url.searchParams.get("redirect_to") || "/");
  const headers = new Headers({ Location: redirectTo });
  headers.append("Set-Cookie", clearCookie(SESSION_COOKIE));
  headers.append("Set-Cookie", clearCookie(OAUTH_COOKIE));
  return new Response(null, { status: 302, headers });
}
__name(handleLogout, "handleLogout");
async function handleAuthorizeKeySelection(request, env, user, clientId, redirectUri, originalState, resource, message) {
  const globalUsers = getGlobalUsersDO(env);
  if (request.method === "POST") {
    const formData = await request.formData();
    const action = formData.get("action")?.toString();
    if (action === "select") {
      const keyId = formData.get("keyId")?.toString();
      if (!keyId) {
        return renderOauthManagePage(globalUsers, user, "Choose a key to continue.", {
          clientId,
          redirectUri,
          state: originalState,
          resource,
          message
        });
      }
      const key = await globalUsers.getCloudflareKey(user.username, keyId);
      if (!key) {
        return renderOauthManagePage(globalUsers, user, "Selected key was not found.", {
          clientId,
          redirectUri,
          state: originalState,
          resource,
          message
        });
      }
      const code = generateCodeVerifier();
      await globalUsers.storeAuthCode(code, {
        username: user.username,
        clientId,
        redirectUri,
        selectedKeyId: keyId,
        resource,
        message
      });
      const target = new URL(redirectUri);
      target.searchParams.set("code", code);
      if (originalState) {
        target.searchParams.set("state", originalState);
      }
      return redirect(target.toString());
    }
    if (action === "add" || action === "delete" || action === "default") {
      const result = await applyKeyAction(globalUsers, user.username, formData);
      let error;
      if (!result.ok && "error" in result) {
        error = result.error;
      }
      if (result.ok && result.mutated) {
        return redirect(request.url);
      }
      return renderOauthManagePage(globalUsers, user, error, {
        clientId,
        redirectUri,
        state: originalState,
        resource,
        message
      });
    }
  }
  return renderOauthManagePage(globalUsers, user, void 0, {
    clientId,
    redirectUri,
    state: originalState,
    resource,
    message
  });
}
__name(handleAuthorizeKeySelection, "handleAuthorizeKeySelection");
async function renderOauthManagePage(globalUsers, user, error, oauth) {
  const [freshUser, keys] = await Promise.all([
    globalUsers.getUser(user.username),
    globalUsers.getCloudflareKeys(user.username)
  ]);
  if (!freshUser) {
    return redirect(buildLoginUrlFromPath("/manage"));
  }
  return html(
    renderManagePage(freshUser, keys, error, {
      ...oauth,
      isOauthFlow: true
    }),
    error ? 400 : 200
  );
}
__name(renderOauthManagePage, "renderOauthManagePage");
async function applyKeyAction(globalUsers, username, formData) {
  const action = formData.get("action")?.toString();
  if (action === "add") {
    const name = formData.get("name")?.toString().trim();
    const accountId = formData.get("accountId")?.toString().trim();
    const apiKey = formData.get("apiKey")?.toString().trim();
    if (!name || !accountId || !apiKey) {
      return { ok: false, mutated: false, error: "Missing required fields." };
    }
    const validation = await validateCloudflareKey(accountId, apiKey);
    if (!validation.ok) {
      return { ok: false, mutated: false, error: validation.error };
    }
    const key = {
      id: crypto.randomUUID(),
      name,
      accountId,
      apiKey,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      lastUsed: null
    };
    await globalUsers.addCloudflareKey(username, key);
    return { ok: true, mutated: true };
  }
  if (action === "delete") {
    const keyId = formData.get("keyId")?.toString();
    if (!keyId) {
      return { ok: false, mutated: false, error: "Missing key selection." };
    }
    await globalUsers.removeCloudflareKey(username, keyId);
    return { ok: true, mutated: true };
  }
  if (action === "default") {
    const keyId = formData.get("keyId")?.toString();
    if (!keyId) {
      return { ok: false, mutated: false, error: "Missing key selection." };
    }
    const changed = await globalUsers.setDefaultCloudflareKey(username, keyId);
    if (!changed) {
      return { ok: false, mutated: false, error: "Key not found." };
    }
    return { ok: true, mutated: true };
  }
  return { ok: true, mutated: false };
}
__name(applyKeyAction, "applyKeyAction");
async function validateCloudflareKey(accountId, apiKey) {
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        }
      }
    );
    if (!response.ok) {
      return { ok: false, error: "Invalid Cloudflare account ID or API token." };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Failed to validate the Cloudflare token." };
  }
}
__name(validateCloudflareKey, "validateCloudflareKey");
async function redirectToGitHub(origin, env, state) {
  const stateParam = encodeBase64Url(JSON.stringify(state));
  const codeChallenge = await generateCodeChallenge(state.codeVerifier);
  const githubUrl = new URL("https://github.com/login/oauth/authorize");
  githubUrl.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  githubUrl.searchParams.set("redirect_uri", `${origin}/callback`);
  githubUrl.searchParams.set("scope", "user:email");
  githubUrl.searchParams.set("state", stateParam);
  githubUrl.searchParams.set("code_challenge", codeChallenge);
  githubUrl.searchParams.set("code_challenge_method", "S256");
  const headers = new Headers({ Location: githubUrl.toString() });
  headers.append(
    "Set-Cookie",
    await makeSignedCookie(
      OAUTH_COOKIE,
      state,
      Math.max(1, Math.floor(AUTH_CODE_MAX_AGE_MS / 1e3)),
      env
    )
  );
  return new Response(null, { status: 302, headers });
}
__name(redirectToGitHub, "redirectToGitHub");

// src/app.ts
var app = {
  async fetch(request, env) {
    assertEnv(env);
    const url = new URL(request.url);
    const pathname = normalizePathname(url.pathname);
    if (request.method === "OPTIONS" && isOAuthRoute(pathname)) {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (pathname === "/favicon.ico") {
      return new Response(null, { status: 204 });
    }
    if (pathname === "/login") {
      const redirectTo = safeInternalRedirect(url.searchParams.get("redirect_to") || "/");
      return redirect(`/authorize?redirect_to=${encodeURIComponent(redirectTo)}`);
    }
    if (pathname === "/authorize") return handleAuthorize(request, env);
    if (pathname === "/callback" || pathname === "/oauth/callback") return handleCallback(request, env);
    if (pathname === "/token") return handleToken(request, env);
    if (pathname === "/register") return handleRegister(request);
    if (pathname === "/logout") return handleLogout(request);
    if (pathname === "/manage") return handleManage(request, env);
    if (pathname === "/.well-known/oauth-authorization-server") {
      return json(
        {
          issuer: url.origin,
          authorization_endpoint: `${url.origin}/authorize`,
          token_endpoint: `${url.origin}/token`,
          registration_endpoint: `${url.origin}/register`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code"],
          code_challenge_methods_supported: ["S256"],
          scopes_supported: ["user:email"],
          token_endpoint_auth_methods_supported: ["none"]
        },
        200,
        corsHeaders
      );
    }
    if (pathname === "/.well-known/oauth-protected-resource") {
      return json(
        {
          resource: url.origin,
          authorization_servers: [url.origin],
          bearer_methods_supported: ["header"],
          resource_documentation: `${url.origin}/manage`
        },
        200,
        corsHeaders
      );
    }
    const identity = await getIdentity(request, env);
    if (pathname === "/projects/create" && request.method === "POST") {
      if (!identity) return redirect(buildLoginUrl(request));
      return handleCreateProject(request, env, identity.user.username, identity.user);
    }
    const deleteMatch = pathname.match(/^\/projects\/([^/]+)\/delete$/);
    if (deleteMatch && request.method === "POST") {
      if (!identity) return redirect(buildLoginUrl(request));
      const slug = sanitizeSlug(deleteMatch[1]);
      if (!slug || RESERVED_PATHS.has(slug)) {
        return new Response("Project not found", { status: 404 });
      }
      const deleted = await deleteProject(env, identity.user.username, slug);
      return deleted ? redirect("/") : new Response("Project not found", { status: 404 });
    }
    if (pathname === "/api/projects" && request.method === "GET") {
      if (!identity) return json({ error: "unauthorized" }, 401);
      const projects = await getUserProjectsDO(env, identity.user.username).listProjects(identity.user.username);
      return json({ projects }, 200);
    }
    const chatMatch = pathname.match(/^\/api\/projects\/([^/]+)\/chat$/);
    if (chatMatch && request.method === "POST") {
      if (!identity) return json({ error: "unauthorized" }, 401);
      const slug = sanitizeSlug(chatMatch[1]);
      if (!slug) return json({ error: "invalid_project" }, 400);
      const body = await request.json().catch(() => null);
      const message = body?.message?.trim();
      if (!message) return json({ error: "message_required" }, 400);
      const projectDO = getUserProjectsDO(env, identity.user.username);
      try {
        const response = await projectDO.chat(identity.user.username, slug, message.slice(0, 2e3));
        return json(response, 200);
      } catch {
        return json({ error: "project_not_found" }, 404);
      }
    }
    if (pathname === "/") {
      if (!identity) return html(renderSignedOutPage(), 200);
      const projects = await getUserProjectsDO(env, identity.user.username).listProjects(identity.user.username);
      return html(renderDashboardPage(identity.user, projects), 200);
    }
    const fileMatch = pathname.match(/^\/([^/]+)\/files\/(.+)$/);
    if (fileMatch) {
      if (!identity) return redirect(buildLoginUrl(request));
      const slug = sanitizeSlug(fileMatch[1]);
      const rawPath = safeProjectPath(fileMatch[2]);
      if (!slug || !rawPath) return new Response("Not found", { status: 404 });
      return serveProjectFile(env, identity.user.username, slug, rawPath);
    }
    const projectMatch = pathname.match(/^\/([^/]+)$/);
    if (projectMatch) {
      const slug = sanitizeSlug(projectMatch[1]);
      if (!slug || RESERVED_PATHS.has(slug)) {
        return new Response("Not found", { status: 404 });
      }
      if (!identity) return redirect(buildLoginUrl(request));
      const projectDO = getUserProjectsDO(env, identity.user.username);
      const project = await projectDO.getProject(identity.user.username, slug);
      if (!project) return new Response("Project not found", { status: 404 });
      const [files, messages] = await Promise.all([
        listProjectFiles2(env, identity.user.username, slug),
        projectDO.getChatMessages(slug)
      ]);
      return html(renderProjectPage(identity.user, project, files, messages), 200);
    }
    return new Response("Not found", { status: 404 });
  }
};
var app_default = app;
async function handleCreateProject(request, env, username, user) {
  const formData = await request.formData();
  const values = {
    title: formData.get("title")?.toString() || "",
    slug: formData.get("slug")?.toString() || "",
    description: formData.get("description")?.toString() || ""
  };
  const title = values.title.trim();
  const description = values.description.trim();
  const slugCandidate = values.slug.trim() || slugifyProjectName(title);
  const slug = sanitizeSlug(slugCandidate);
  let error;
  if (!title) error = "Project title is required.";
  else if (!slug) error = "Project slug is invalid.";
  else if (RESERVED_PATHS.has(slug)) error = "That project slug is reserved.";
  else if (await projectExists(env, username, slug)) error = "A project with that slug already exists.";
  if (error) {
    const projects = await getUserProjectsDO(env, username).listProjects(username);
    return html(renderDashboardPage(user, projects, { createError: error, createValues: values }), 400);
  }
  await Promise.all([
    env.PROJECTS.put(
      `${username}/${slug}/project.json`,
      JSON.stringify(
        {
          title,
          description: description || void 0,
          entryFile: "index.html"
        },
        null,
        2
      ),
      {
        httpMetadata: { contentType: "application/json; charset=utf-8" }
      }
    ),
    env.PROJECTS.put(
      `${username}/${slug}/index.html`,
      buildStarterProjectHtml(title, description),
      {
        httpMetadata: { contentType: "text/html; charset=utf-8" }
      }
    )
  ]);
  return redirect(`/${encodeURIComponent(slug)}`);
}
__name(handleCreateProject, "handleCreateProject");
async function deleteProject(env, username, slug) {
  const prefix = `${username}/${slug}/`;
  const keys = [];
  let cursor;
  do {
    const listing = await env.PROJECTS.list({ prefix, cursor });
    for (const object of listing.objects) {
      keys.push(object.key);
    }
    cursor = listing.truncated ? listing.cursor : void 0;
  } while (cursor);
  if (keys.length === 0) {
    return false;
  }
  for (let index = 0; index < keys.length; index += 1e3) {
    await env.PROJECTS.delete(keys.slice(index, index + 1e3));
  }
  return true;
}
__name(deleteProject, "deleteProject");
async function projectExists(env, username, slug) {
  const listing = await env.PROJECTS.list({
    prefix: `${username}/${slug}/`,
    limit: 1
  });
  return listing.objects.length > 0;
}
__name(projectExists, "projectExists");
async function serveProjectFile(env, username, slug, filePath) {
  const object = await env.PROJECTS.get(`${username}/${slug}/${filePath}`);
  if (!object) {
    return new Response("Not found", { status: 404 });
  }
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "private, no-store");
  if (!headers.get("content-type")) {
    headers.set("content-type", guessContentType(filePath));
  }
  return new Response(object.body, { headers });
}
__name(serveProjectFile, "serveProjectFile");
async function listProjectFiles2(env, username, slug) {
  const files = [];
  let cursor;
  const prefix = `${username}/${slug}/`;
  do {
    const listing = await env.PROJECTS.list({ prefix, cursor });
    for (const object of listing.objects) {
      const relativePath = object.key.slice(prefix.length);
      if (!relativePath) continue;
      files.push({
        path: relativePath,
        size: object.size,
        uploaded: object.uploaded?.toISOString() || null,
        contentType: object.httpMetadata?.contentType || guessContentType(relativePath)
      });
    }
    cursor = listing.truncated ? listing.cursor : void 0;
  } while (cursor);
  return files;
}
__name(listProjectFiles2, "listProjectFiles");
function buildStarterProjectHtml(title, description) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: Georgia, serif;
      background: linear-gradient(180deg, #fbf7ef, #f3ede2);
      color: #17120d;
      padding: 24px;
    }
    main {
      max-width: 720px;
      background: rgba(255, 252, 246, 0.92);
      border: 1px solid rgba(23, 18, 13, 0.1);
      border-radius: 28px;
      padding: 32px;
      box-shadow: 0 24px 60px rgba(63, 39, 16, 0.16);
    }
    h1 { margin: 0 0 12px; font-size: clamp(2rem, 6vw, 4rem); line-height: 0.95; }
    p { color: #66584a; line-height: 1.6; }
  </style>
</head>
<body>
  <main>
    <p>New Flaredream project</p>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(description || "Start editing index.html and project.json in R2.")}</p>
  </main>
</body>
</html>`;
}
__name(buildStarterProjectHtml, "buildStarterProjectHtml");

// worker.ts
var worker_default = app_default;

// ../../../../.nvm/versions/node/v24.11.1/lib/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../../.nvm/versions/node/v24.11.1/lib/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-3MQdGd/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../../../../.nvm/versions/node/v24.11.1/lib/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-3MQdGd/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  GlobalUsersDO,
  UserProjectsDO,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
