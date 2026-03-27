import { getGlobalUsersDO } from "./env";
import { renderManagePage } from "./render";
import type { CloudflareAPIKey, Env, Identity, OAuthState, Session, StoredUser } from "./types";
import {
  AUTH_CODE_MAX_AGE_MS,
  OAUTH_COOKIE,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  buildLoginUrlFromPath,
  clearCookie,
  corsHeaders,
  encodeBase64Url,
  generateBearerToken,
  generateCodeChallenge,
  generateCodeVerifier,
  html,
  isValidDomain,
  json,
  makeSignedCookie,
  readSignedCookie,
  redirect,
  sanitizeMessage,
  safeInternalRedirect,
} from "./utils";

export async function getIdentity(request: Request, env: Env): Promise<Identity | null> {
  const session = await readSignedCookie<Session>(request, SESSION_COOKIE, env);
  if (!session) {
    return null;
  }

  const user = await getGlobalUsersDO(env).getUser(session.githubUsername);
  if (!user) {
    return null;
  }

  return { session, user };
}

export async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const clientId = url.searchParams.get("client_id");
  const redirectTo = safeInternalRedirect(url.searchParams.get("redirect_to") || "/");
  const redirectUri = url.searchParams.get("redirect_uri");
  const responseType = url.searchParams.get("response_type") || "code";
  const originalState = url.searchParams.get("state");
  const resource = url.searchParams.get("resource");
  const message = sanitizeMessage(url.searchParams.get("message") || "");

  if (!clientId) {
    const identity = await getIdentity(request, env);
    if (identity) {
      return redirect(redirectTo);
    }
    const state: OAuthState = {
      redirectTo,
      codeVerifier: generateCodeVerifier(),
      resource: resource || undefined,
      message: message || undefined,
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
    const state: OAuthState = {
      redirectTo: `${url.pathname}${url.search}`,
      codeVerifier: generateCodeVerifier(),
      resource: resource || undefined,
      clientId,
      originalState: originalState || undefined,
      redirectUri: effectiveRedirectUri,
      message: message || undefined,
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
    message || undefined,
  );
}

export async function handleCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const oauthState = await readSignedCookie<OAuthState>(request, OAUTH_COOKIE, env);

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
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${url.origin}/callback`,
      code_verifier: oauthState.codeVerifier,
    }),
  });
  const tokenData = (await tokenResponse.json().catch(() => null)) as
    | { access_token?: string }
    | null;

  if (!tokenResponse.ok || !tokenData?.access_token) {
    return new Response("Failed to get GitHub access token", { status: 400 });
  }

  const userResponse = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      "User-Agent": "Flaredream",
    },
  });

  if (!userResponse.ok) {
    return new Response("Failed to fetch GitHub user", { status: 400 });
  }

  const user = (await userResponse.json()) as {
    id: number;
    login: string;
    name: string | null;
    email: string | null;
    avatar_url: string | null;
  };

  const globalUsers = getGlobalUsersDO(env);
  await globalUsers.upsertGitHubUser(user, tokenData.access_token);

  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    await makeSignedCookie(
      SESSION_COOKIE,
      {
        githubUsername: user.login,
        expiresAt: Date.now() + SESSION_MAX_AGE * 1000,
      },
      SESSION_MAX_AGE,
      env,
    ),
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

export async function handleToken(request: Request, env: Env): Promise<Response> {
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
    globalUsers.getCloudflareKey(auth.username, auth.selectedKeyId),
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
      ...(auth.message ? { message: auth.message } : {}),
    },
    200,
    corsHeaders,
  );
}

export async function handleRegister(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const body = (await request.json()) as { redirect_uris?: string[] };
    if (!body.redirect_uris || !Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0) {
      return json(
        {
          error: "invalid_client_metadata",
          error_description: "redirect_uris must be a non-empty array",
        },
        400,
        corsHeaders,
      );
    }

    const hosts = new Set<string>();
    for (const uri of body.redirect_uris) {
      hosts.add(new URL(uri).host);
    }

    if (hosts.size !== 1) {
      return json(
        {
          error: "invalid_client_metadata",
          error_description: "All redirect URIs must have the same host",
        },
        400,
        corsHeaders,
      );
    }

    return json(
      {
        client_id: [...hosts][0],
        redirect_uris: body.redirect_uris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code"],
        response_types: ["code"],
      },
      201,
      { ...corsHeaders, "Cache-Control": "no-store", Pragma: "no-cache" },
    );
  } catch {
    return json(
      {
        error: "invalid_client_metadata",
        error_description: "Invalid JSON in request body",
      },
      400,
      corsHeaders,
    );
  }
}

export async function handleManage(request: Request, env: Env): Promise<Response> {
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
      const [user, keys] = await Promise.all([
        globalUsers.getUser(identity.user.username),
        globalUsers.getCloudflareKeys(identity.user.username),
      ]);
      if (!user) {
        return redirect(buildLoginUrlFromPath("/manage"));
      }
      return html(renderManagePage(user, keys, error), 400);
    }

    if (result.mutated) {
      return redirect(currentUrl.pathname + currentUrl.search);
    }
  }

  const [user, keys] = await Promise.all([
    globalUsers.getUser(identity.user.username),
    globalUsers.getCloudflareKeys(identity.user.username),
  ]);
  if (!user) {
    return redirect(buildLoginUrlFromPath("/manage"));
  }
  return html(renderManagePage(user, keys), 200);
}

export function handleLogout(request: Request): Response {
  const url = new URL(request.url);
  const redirectTo = safeInternalRedirect(url.searchParams.get("redirect_to") || "/");
  const headers = new Headers({ Location: redirectTo });
  headers.append("Set-Cookie", clearCookie(SESSION_COOKIE));
  headers.append("Set-Cookie", clearCookie(OAUTH_COOKIE));
  return new Response(null, { status: 302, headers });
}

async function handleAuthorizeKeySelection(
  request: Request,
  env: Env,
  user: StoredUser,
  clientId: string,
  redirectUri: string,
  originalState: string | null,
  resource: string | null,
  message?: string,
): Promise<Response> {
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
          message,
        });
      }

      const key = await globalUsers.getCloudflareKey(user.username, keyId);
      if (!key) {
        return renderOauthManagePage(globalUsers, user, "Selected key was not found.", {
          clientId,
          redirectUri,
          state: originalState,
          resource,
          message,
        });
      }

      const code = generateCodeVerifier();
      await globalUsers.storeAuthCode(code, {
        username: user.username,
        clientId,
        redirectUri,
        selectedKeyId: keyId,
        resource,
        message,
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
      let error: string | undefined;
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
        message,
      });
    }
  }

  return renderOauthManagePage(globalUsers, user, undefined, {
    clientId,
    redirectUri,
    state: originalState,
    resource,
    message,
  });
}

async function renderOauthManagePage(
  globalUsers: ReturnType<typeof getGlobalUsersDO>,
  user: StoredUser,
  error: string | undefined,
  oauth: {
    clientId: string;
    redirectUri: string;
    state: string | null;
    resource: string | null;
    message?: string;
  },
): Promise<Response> {
  const [freshUser, keys] = await Promise.all([
    globalUsers.getUser(user.username),
    globalUsers.getCloudflareKeys(user.username),
  ]);
  if (!freshUser) {
    return redirect(buildLoginUrlFromPath("/manage"));
  }
  return html(
    renderManagePage(freshUser, keys, error, {
      ...oauth,
      isOauthFlow: true,
    }),
    error ? 400 : 200,
  );
}

async function applyKeyAction(
  globalUsers: ReturnType<typeof getGlobalUsersDO>,
  username: string,
  formData: FormData,
): Promise<{ ok: true; mutated: boolean } | { ok: false; mutated: false; error: string }> {
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

    const key: CloudflareAPIKey = {
      id: crypto.randomUUID(),
      name,
      accountId,
      apiKey,
      createdAt: new Date().toISOString(),
      lastUsed: null,
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

async function validateCloudflareKey(accountId: string, apiKey: string) {
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      return { ok: false as const, error: "Invalid Cloudflare account ID or API token." };
    }

    return { ok: true as const };
  } catch {
    return { ok: false as const, error: "Failed to validate the Cloudflare token." };
  }
}

async function redirectToGitHub(
  origin: string,
  env: Env,
  state: OAuthState,
): Promise<Response> {
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
      Math.max(1, Math.floor(AUTH_CODE_MAX_AGE_MS / 1000)),
      env,
    ),
  );
  return new Response(null, { status: 302, headers });
}
