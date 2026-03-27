import { DurableObject } from "cloudflare:workers";
import type {
  AuthCodeRecord,
  ChatMessage,
  CloudflareAPIKey,
  Env,
  GitHubUser,
  ProjectRecord,
  StoredUser,
} from "./types";
import {
  AUTH_CODE_MAX_AGE_MS,
  chooseEntryFile,
  humanizeSlug,
  sanitizeProjectFileName,
} from "./utils";

export class GlobalUsersDO extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.sql = state.storage.sql;
    state.blockConcurrencyWhile(async () => {
      this.migrate();
    });
  }

  async upsertGitHubUser(user: GitHubUser, githubAccessToken: string) {
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
      githubAccessToken,
    );
  }

  async getUser(username: string): Promise<StoredUser | null> {
    const row = this.sql
      .exec<{
        username: string;
        name: string | null;
        email: string | null;
        avatar_url: string | null;
        default_key_id: string | null;
        cloudflare_account_id: string | null;
        cloudflare_key_name: string | null;
      }>(
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
        username,
      )
      .toArray()[0];

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
      defaultKeyId: row.default_key_id,
    };
  }

  async getCloudflareKeys(username: string): Promise<CloudflareAPIKey[]> {
    return this.sql
      .exec<{
        id: string;
        name: string;
        account_id: string;
        api_key: string;
        created_at: string;
        last_used_at: string | null;
      }>(
        `SELECT id, name, account_id, api_key, created_at, last_used_at
         FROM cloudflare_keys
         WHERE username = ?
         ORDER BY created_at DESC`,
        username,
      )
      .toArray()
      .map((row) => ({
        id: row.id,
        name: row.name,
        accountId: row.account_id,
        apiKey: row.api_key,
        createdAt: row.created_at,
        lastUsed: row.last_used_at,
      }));
  }

  async addCloudflareKey(username: string, key: CloudflareAPIKey) {
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
      key.lastUsed,
    );

    const user = this.sql
      .exec<{ default_key_id: string | null }>(
        `SELECT default_key_id FROM users WHERE username = ?`,
        username,
      )
      .toArray()[0];

    if (user && !user.default_key_id) {
      this.sql.exec(
        `UPDATE users
         SET default_key_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE username = ?`,
        key.id,
        username,
      );
    }
  }

  async setDefaultCloudflareKey(username: string, keyId: string) {
    const existing = this.sql
      .exec<{ id: string }>(
        `SELECT id FROM cloudflare_keys WHERE id = ? AND username = ?`,
        keyId,
        username,
      )
      .toArray()[0];

    if (!existing) {
      return false;
    }

    this.sql.exec(
      `UPDATE users
       SET default_key_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE username = ?`,
      keyId,
      username,
    );
    return true;
  }

  async removeCloudflareKey(username: string, keyId: string) {
    this.sql.exec(
      `DELETE FROM cloudflare_keys WHERE username = ? AND id = ?`,
      username,
      keyId,
    );

    this.sql.exec(
      `UPDATE users
       SET default_key_id = CASE WHEN default_key_id = ? THEN NULL ELSE default_key_id END,
           updated_at = CURRENT_TIMESTAMP
       WHERE username = ?`,
      keyId,
      username,
    );

    const user = this.sql
      .exec<{ default_key_id: string | null }>(
        `SELECT default_key_id FROM users WHERE username = ?`,
        username,
      )
      .toArray()[0];

    if (user && !user.default_key_id) {
      const replacement = this.sql
        .exec<{ id: string }>(
          `SELECT id FROM cloudflare_keys WHERE username = ? ORDER BY created_at DESC LIMIT 1`,
          username,
        )
        .toArray()[0];

      if (replacement) {
        this.sql.exec(
          `UPDATE users SET default_key_id = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?`,
          replacement.id,
          username,
        );
      }
    }
  }

  async getCloudflareKey(username: string, keyId: string): Promise<CloudflareAPIKey | null> {
    const row = this.sql
      .exec<{
        id: string;
        name: string;
        account_id: string;
        api_key: string;
        created_at: string;
        last_used_at: string | null;
      }>(
        `SELECT id, name, account_id, api_key, created_at, last_used_at
         FROM cloudflare_keys
         WHERE username = ? AND id = ?`,
        username,
        keyId,
      )
      .toArray()[0];

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      name: row.name,
      accountId: row.account_id,
      apiKey: row.api_key,
      createdAt: row.created_at,
      lastUsed: row.last_used_at,
    };
  }

  async touchCloudflareKey(username: string, keyId: string) {
    this.sql.exec(
      `UPDATE cloudflare_keys
       SET last_used_at = CURRENT_TIMESTAMP
       WHERE username = ? AND id = ?`,
      username,
      keyId,
    );
    await this.setDefaultCloudflareKey(username, keyId);
  }

  async storeAuthCode(code: string, record: AuthCodeRecord) {
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
      new Date(Date.now() + AUTH_CODE_MAX_AGE_MS).toISOString(),
    );
  }

  async consumeAuthCode(code: string): Promise<AuthCodeRecord | null> {
    this.purgeExpiredAuthCodes();
    const row = this.sql
      .exec<{
        username: string;
        client_id: string;
        redirect_uri: string;
        selected_key_id: string;
        resource: string | null;
        message: string | null;
      }>(
        `SELECT username, client_id, redirect_uri, selected_key_id, resource, message
         FROM auth_codes
         WHERE code = ?`,
        code,
      )
      .toArray()[0];

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
      message: row.message,
    };
  }

  private purgeExpiredAuthCodes() {
    this.sql.exec(`DELETE FROM auth_codes WHERE expires_at <= ?`, new Date().toISOString());
  }

  private migrate() {
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
}

export class UserProjectsDO extends DurableObject<Env> {
  private envRef: Env;
  private sql: SqlStorage;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.envRef = env;
    this.sql = state.storage.sql;
    state.blockConcurrencyWhile(async () => {
      this.migrate();
    });
  }

  async listProjects(username: string): Promise<ProjectRecord[]> {
    await this.syncProjectsFromR2(username);
    return this.sql
      .exec<{
        slug: string;
        title: string;
        description: string | null;
        entry_file: string | null;
        file_count: number;
        synced_at: string;
        updated_at: string;
      }>(
        `SELECT slug, title, description, entry_file, file_count, synced_at, updated_at
         FROM projects
         ORDER BY updated_at DESC, slug ASC`,
      )
      .toArray()
      .map((row) => ({
        slug: row.slug,
        title: row.title,
        description: row.description,
        entryFile: row.entry_file,
        fileCount: row.file_count,
        syncedAt: row.synced_at,
        updatedAt: row.updated_at,
      }));
  }

  async getProject(username: string, slug: string): Promise<ProjectRecord | null> {
    await this.syncProjectFromR2(username, slug);
    const row = this.sql
      .exec<{
        slug: string;
        title: string;
        description: string | null;
        entry_file: string | null;
        file_count: number;
        synced_at: string;
        updated_at: string;
      }>(
        `SELECT slug, title, description, entry_file, file_count, synced_at, updated_at
         FROM projects
         WHERE slug = ?`,
        slug,
      )
      .toArray()[0];

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
      updatedAt: row.updated_at,
    };
  }

  async chat(username: string, slug: string, message: string) {
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
      new Date().toISOString(),
    );

    const files = await listProjectFiles(this.envRef, username, slug);
    const assistantMessage = buildAssistantReply(project, files, message);

    this.sql.exec(
      `INSERT INTO chat_messages (project_slug, role, content, created_at)
       VALUES (?, ?, ?, ?)`,
      slug,
      "assistant",
      assistantMessage,
      new Date().toISOString(),
    );

    return {
      reply: assistantMessage,
      messages: await this.getChatMessages(slug),
    };
  }

  async getChatMessages(slug: string): Promise<ChatMessage[]> {
    return this.sql
      .exec<{
        role: "user" | "assistant";
        content: string;
        created_at: string;
      }>(
        `SELECT role, content, created_at
         FROM chat_messages
         WHERE project_slug = ?
         ORDER BY id ASC
         LIMIT 50`,
        slug,
      )
      .toArray()
      .map((row) => ({
        role: row.role,
        content: row.content,
        createdAt: row.created_at,
      }));
  }

  private async syncProjectsFromR2(username: string) {
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

  private async syncProjectFromR2(username: string, slug: string) {
    const files = await listProjectFiles(this.envRef, username, slug);
    if (files.length === 0) {
      this.sql.exec(`DELETE FROM projects WHERE slug = ?`, slug);
      return;
    }

    const manifest = await readProjectManifest(this.envRef.PROJECTS, username, slug);
    const entryFile =
      sanitizeProjectFileName(manifest?.entryFile) ??
      chooseEntryFile(files.map((file) => file.path));
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
      files.length,
    );
  }

  private migrate() {
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
}

function buildAssistantReply(project: ProjectRecord, files: { path: string }[], prompt: string): string {
  const sampleFiles = files.slice(0, 5).map((file) => file.path).join(", ") || "none";
  return [
    `Project "${project.title}" is available from R2 with ${files.length} files.`,
    project.entryFile
      ? `The current preview entry is ${project.entryFile}.`
      : "There is no preview entry file configured yet.",
    `Sample files: ${sampleFiles}.`,
    `This chat is a placeholder inside the worker, so it does not call a model yet. Your last message was: "${prompt.slice(0, 140)}".`,
  ].join(" ");
}

async function listProjectSlugs(bucket: R2Bucket, prefix: string): Promise<string[]> {
  const slugs = new Set<string>();
  let cursor: string | undefined;

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
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);

  return [...slugs].sort();
}

async function listProjectFiles(env: Env, username: string, slug: string) {
  const files: { path: string; size: number }[] = [];
  let cursor: string | undefined;
  const prefix = `${username}/${slug}/`;

  do {
    const listing = await env.PROJECTS.list({ prefix, cursor });
    for (const object of listing.objects) {
      const relativePath = object.key.slice(prefix.length);
      if (relativePath) {
        files.push({ path: relativePath, size: object.size });
      }
    }
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);

  return files;
}

async function readProjectManifest(bucket: R2Bucket, username: string, slug: string) {
  const object = await bucket.get(`${username}/${slug}/project.json`);
  if (!object) {
    return null;
  }

  try {
    return await object.json<{ title?: string; description?: string; entryFile?: string }>();
  } catch {
    return null;
  }
}
