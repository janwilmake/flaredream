import { getUserProjectsDO } from "./env";
import {
  getIdentity,
  handleAuthorize,
  handleCallback,
  handleLogout,
  handleManage,
  handleRegister,
  handleToken,
} from "./auth";
import { renderDashboardPage, renderProjectPage, renderSignedOutPage } from "./render";
import type { Env, ProjectCreateValues, StoredUser } from "./types";
import {
  assertEnv,
  buildLoginUrl,
  corsHeaders,
  escapeHtml,
  guessContentType,
  html,
  isOAuthRoute,
  json,
  normalizePathname,
  redirect,
  RESERVED_PATHS,
  sanitizeSlug,
  safeInternalRedirect,
  safeProjectPath,
  slugifyProjectName,
} from "./utils";

const app: ExportedHandler<Env> = {
  async fetch(request, env): Promise<Response> {
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
          token_endpoint_auth_methods_supported: ["none"],
        },
        200,
        corsHeaders,
      );
    }

    if (pathname === "/.well-known/oauth-protected-resource") {
      return json(
        {
          resource: url.origin,
          authorization_servers: [url.origin],
          bearer_methods_supported: ["header"],
          resource_documentation: `${url.origin}/manage`,
        },
        200,
        corsHeaders,
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
      const body = (await request.json().catch(() => null)) as { message?: string } | null;
      const message = body?.message?.trim();
      if (!message) return json({ error: "message_required" }, 400);
      const projectDO = getUserProjectsDO(env, identity.user.username);
      try {
        const response = await projectDO.chat(identity.user.username, slug, message.slice(0, 2000));
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
        listProjectFiles(env, identity.user.username, slug),
        projectDO.getChatMessages(slug),
      ]);

      return html(renderProjectPage(identity.user, project, files, messages), 200);
    }

    return new Response("Not found", { status: 404 });
  },
};

export default app;

async function handleCreateProject(
  request: Request,
  env: Env,
  username: string,
  user: StoredUser,
): Promise<Response> {
  const formData = await request.formData();
  const values: ProjectCreateValues = {
    title: formData.get("title")?.toString() || "",
    slug: formData.get("slug")?.toString() || "",
    description: formData.get("description")?.toString() || "",
  };

  const title = values.title.trim();
  const description = values.description.trim();
  const slugCandidate = values.slug.trim() || slugifyProjectName(title);
  const slug = sanitizeSlug(slugCandidate);

  let error: string | undefined;
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
          description: description || undefined,
          entryFile: "index.html",
        },
        null,
        2,
      ),
      {
        httpMetadata: { contentType: "application/json; charset=utf-8" },
      },
    ),
    env.PROJECTS.put(
      `${username}/${slug}/index.html`,
      buildStarterProjectHtml(title, description),
      {
        httpMetadata: { contentType: "text/html; charset=utf-8" },
      },
    ),
  ]);

  return redirect(`/${encodeURIComponent(slug)}`);
}

async function deleteProject(env: Env, username: string, slug: string): Promise<boolean> {
  const prefix = `${username}/${slug}/`;
  const keys: string[] = [];
  let cursor: string | undefined;

  do {
    const listing = await env.PROJECTS.list({ prefix, cursor });
    for (const object of listing.objects) {
      keys.push(object.key);
    }
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);

  if (keys.length === 0) {
    return false;
  }

  for (let index = 0; index < keys.length; index += 1000) {
    await env.PROJECTS.delete(keys.slice(index, index + 1000));
  }

  return true;
}

async function projectExists(env: Env, username: string, slug: string): Promise<boolean> {
  const listing = await env.PROJECTS.list({
    prefix: `${username}/${slug}/`,
    limit: 1,
  });
  return listing.objects.length > 0;
}

async function serveProjectFile(
  env: Env,
  username: string,
  slug: string,
  filePath: string,
): Promise<Response> {
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

async function listProjectFiles(env: Env, username: string, slug: string) {
  const files: {
    path: string;
    size: number;
    uploaded: string | null;
    contentType: string | null;
  }[] = [];
  let cursor: string | undefined;
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
        contentType: object.httpMetadata?.contentType || guessContentType(relativePath),
      });
    }
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);

  return files;
}

function buildStarterProjectHtml(title: string, description: string): string {
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
