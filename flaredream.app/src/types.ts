import type { GlobalUsersDO, UserProjectsDO } from "./durable-objects";

export type Session = {
  githubUsername: string;
  expiresAt: number;
};

export type OAuthState = {
  redirectTo?: string;
  codeVerifier: string;
  resource?: string;
  clientId?: string;
  originalState?: string;
  redirectUri?: string;
  message?: string;
};

export type StoredUser = {
  username: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  cloudflareAccountId: string | null;
  cloudflareKeyName: string | null;
  defaultKeyId: string | null;
};

export type GitHubUser = {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
};

export type CloudflareAPIKey = {
  id: string;
  name: string;
  accountId: string;
  apiKey: string;
  createdAt: string;
  lastUsed: string | null;
};

export type AuthCodeRecord = {
  username: string;
  clientId: string;
  redirectUri: string;
  selectedKeyId: string;
  resource?: string | null;
  message?: string | null;
};

export type ProjectRecord = {
  slug: string;
  title: string;
  description: string | null;
  entryFile: string | null;
  fileCount: number;
  syncedAt: string;
  updatedAt: string;
};

export type ProjectFile = {
  path: string;
  size: number;
  uploaded: string | null;
  contentType: string | null;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type ProjectManifest = {
  title?: string;
  description?: string;
  entryFile?: string;
};

export type Identity = {
  session: Session;
  user: StoredUser;
};

export type ProjectCreateValues = {
  title: string;
  slug: string;
  description: string;
};

export interface Env {
  GLOBAL_USERS: DurableObjectNamespace<GlobalUsersDO>;
  USER_PROJECTS: DurableObjectNamespace<UserProjectsDO>;
  PROJECTS: R2Bucket;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  SESSION_SECRET: string;
}
