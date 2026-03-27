/// <reference types="@cloudflare/workers-types" />
/// <reference lib="esnext" />
//@ts-check
/////
import {
  convertWranglerToWorkerConfig,
  WranglerConfig,
  WorkerMetadata,
} from "wrangler-convert";
import { load } from "js-toml";
import * as JSON5 from "json5";
import { parse } from "yaml";

interface Env {
  FLAREDREAM_DOWNLOAD: Fetcher;
  FLAREDREAM_ASSETS: Fetcher;
  KV: KVNamespace;
}

// Add CORS headers to all responses
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Check if user is authenticated
    const auth = getAuth(request);

    if (path === "/login") {
      return handleLogin(request, auth, url.origin);
    } else if (path.startsWith("/callback")) {
      return handleCallback(request);
    } else if (path.startsWith("/") && path.length > 1) {
      if (!auth) {
        return new Response(null, {
          status: 302,
          headers: { Location: `${url.origin}/login` },
        });
      }

      if (request.method === "POST") {
        // Direct POST with multipart/form-data
        return await handleDeploy(request, ctx, env);
      } else if (request.method === "GET") {
        // Convert GET URL to POST form-data request
        const postRequest = await convertUrlToPostRequest(request, env);

        return await handleDeploy(postRequest, ctx, env);
      }
    }

    return new Response("Not Found", { status: 404 });
  },
};

const ENABLE_DURABLE_WORKER = false;

const DURABLE_WORKER_SCRIPT = `
import handler from "{{MAIN_MODULE}}";
/**
 * Configuration of the worker. Backwards compatible with regular worker syntax
 *
 * @typedef {Object} Config
 * @property {"none"|"central"|"ip"|"region"|"username"|"custom"} durability - configures whether or how your worker is made durable. defaults to "none" meaning it behaves like a regular worker
 */

export default {
  /**
   * @param {Request} request
   * @param {{DurableWorkerDO:DurableObjectNamespace}} env
   * @param {ExecutionContext} ctx
   * @returns {Promise<Response>}
   */
  fetch: async function (request, env, ctx) {
    const config = handler.config || {};
    const durability = config.durability || "none";

    // If durability is 'none', call handler directly
    if (durability === "none") {
      return handler.fetch.call({}, request, env, ctx);
    }

    if (durability === "custom") {
      // First, call the handler to get the name
      const response = await handler.fetch.call({}, request, env, ctx);

      const customName = response.headers.get("x-durable-worker");
      if (customName) {
        // Re-route to the durable object with custom name
        return env.DurableWorkerDO.get(
          env.DurableWorkerDO.idFromName(customName)
        ).fetch(request);
      }

      // If no custom name, return the response as-is
      return response;
    }

    let name;

    if (durability === "central") {
      name = "central";
    } else if (durability === "region") {
      // Infer region from CF headers or use a fallback
      const region = request.cf?.colo || "unknown";
      name = \`region-\${region}\`;
    } else if (durability === "ip") {
      // Use IP address for user-based durability
      const ip =
        request.headers.get("CF-Connecting-IP") ||
        request.headers.get("X-Forwarded-For") ||
        "unknown";
      name = \`user-\${ip}\`;
    } else if (durability === "username") {
      // Try to find username from cookie or header
      let username;

      // First check for x-username header
      username = request.headers.get("x-username");

      // If not found, check for username cookie
      if (!username) {
        const cookieHeader = request.headers.get("Cookie");
        if (cookieHeader) {
          const cookies = cookieHeader.split(";").map((c) => c.trim());
          const usernameCookie = cookies.find((c) => c.startsWith("username="));
          if (usernameCookie) {
            username = usernameCookie.split("=")[1];
          }
        }
      }

      // If no username found, return error
      if (!username) {
        return new Response(
          "Username required but not found in cookie or x-username header",
          { status: 400 }
        );
      }

      name = \`username-\${username}\`;
    } else {
      return new Response("Invalid durability configuration", { status: 500 });
    }

    return env.DurableWorkerDO.get(env.DurableWorkerDO.idFromName(name)).fetch(
      request
    );
  },

  /**
   * @param {TraceItem} trace
   * @param {any} env
   */
  tail: async function (traces, env) {
    if (typeof handler.tail === "function") {
      return handler.tail.call({}, traces, env, null);
    }
  },

  /**
   * @param {Request} request
   * @param {any} env
   */
  trace: async function (traces, env) {
    if (typeof handler.trace === "function") {
      return handler.trace.call({}, traces, env, null);
    }
  },

  /**
   * @param {ForwardableEmailMessage} message
   * @param {any} env
   */
  email: async function (message, env) {
    if (typeof handler.email === "function") {
      return handler.email.call({}, message, env, null);
    }
  },

  /**
   * @param {ScheduledController} controller
   * @param {any} env
   */
  scheduled: async function (controller, env) {
    if (typeof handler.scheduled === "function") {
      return handler.scheduled.call({}, controller, env, null);
    }
  },
};

export class DurableWorkerDO {
  /** @param {DurableObjectState} state @param {any} env */
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;

    // Initialize the handler with the DO instance
    if (typeof handler.init === "function") {
      handler.init.call(this, env, ctx);
    }
  }

  /**
   * @param {Alarm} alarmInfo
   */
  alarm(alarmInfo) {
    if (typeof handler.scheduled === "function") {
      return handler.scheduled.call(this, alarmInfo, this.env, this.ctx);
    }
  }

  fetch(request) {
    // Pass the DO instance as 'this' context
    return handler.fetch.call(this, request, this.env, this.ctx);
  }
}



`;
// Convert GET URL request to POST multipart/form-data request
async function convertUrlToPostRequest(
  request: Request,
  env: Env
): Promise<Request> {
  const url = new URL(request.url);
  const path = url.pathname;
  const targetUrl = path.substring(1); // Remove leading slash

  // Decode the URL if it's encoded
  const decodedUrl = decodeURIComponent(targetUrl);
  const realUrl =
    decodedUrl.startsWith("http://") || decodedUrl.startsWith("https://")
      ? decodedUrl
      : "https://" + decodedUrl;

  let hostname;
  try {
    hostname = new URL(realUrl).hostname;
  } catch (e) {
    throw new Error(
      "Invalid URL. Read the instructions at https://deploy.flaredream.com"
    );
  }

  const isDownloadUrl = hostname === "download.flaredream.com";

  const filesResponse = isDownloadUrl
    ? await env.FLAREDREAM_DOWNLOAD.fetch(realUrl, {
        headers: { Accept: "multipart/form-data" },
      })
    : await fetch(realUrl, { headers: { Accept: "multipart/form-data" } });

  if (!filesResponse.ok) {
    throw new Error(`Failed to fetch files object: ${filesResponse.status}`);
  }
  const isFormData = filesResponse.headers
    .get("content-type")
    ?.startsWith("multipart/form-data;");

  if (!isFormData) {
    throw new Error(`Download URL must return form-data`);
  }

  return new Request(request.url, {
    method: "POST",
    body: filesResponse.body,
    headers: {
      "Content-Type": filesResponse.headers.get("content-type"),
      Accept: request.headers.get("accept"),
    },
  });
}

// Extract files from multipart/form-data request
async function extractFilesFromFormData(request: Request): Promise<{
  filesObject: FilesObject;
  config: {
    patterns?: string[];
    name?: string;
    environmentVariables?: { [key: string]: string };
  };
}> {
  const formData = await request.formData();

  const files: FilesObject["files"] = {};

  for (const [key, value] of formData.entries()) {
    if (value instanceof File) {
      const filename = value.name;
      // Handle file uploads
      console.log({ filename, key });
      const path = filename?.startsWith("/") ? filename : "/" + filename;
      const content = await value.text();

      // Calculate hash and size
      const encoder = new TextEncoder();
      const data = encoder.encode(content);
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hash = hashArray
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      files[path] = {
        type: "content",
        content: content,
        hash: hash,
        size: data.length,
      };
    } else if (typeof value === "string") {
      // Handle other form fields as search parameters
    }
  }

  const firstSegments = Object.keys(files).map((path) => path.split("/")[1]);

  const allSame = new Set(firstSegments).size === 1;

  if (allSame) {
    // omit first segment
    const newFiles: FilesObject["files"] = {};
    Object.keys(files).forEach((path) => {
      const newPath = "/" + path.split("/").slice(2).join("/");
      newFiles[newPath] = files[path];
    });
    return { filesObject: { files: newFiles }, config: {} };
  }

  return { filesObject: { files }, config: {} };
}

/**
 * Responsible for building:
 *
 * - adding additional migrations & bindings
 * - creating a front-entry-point
 * - adding node_modules bundles
 *
 * May later be made more configurable
 *
 */
const getBuild = (
  metadata: WorkerMetadata,
  currentMigrationTag: string | undefined,
  uploadAssetsResult: UploadAssetsResult,
  filesObject: FilesObject
) => {
  // Prepare metadata with assets if JWT is provided
  metadata = {
    ...metadata,
    compatibility_date:
      metadata.compatibility_date || new Date().toISOString().slice(0, 10),
    compatibility_flags: metadata.compatibility_flags || [],
    bindings: metadata.bindings || [],
  };

  // Add assets configuration if JWT exists
  if (uploadAssetsResult.jwt) {
    metadata.assets = {
      jwt: uploadAssetsResult.jwt,
      config: {
        html_handling: "auto-trailing-slash",
        not_found_handling: "404-page",
        ...(uploadAssetsResult._headers && {
          _headers: uploadAssetsResult._headers,
        }),
        ...(uploadAssetsResult._redirects && {
          _redirects: uploadAssetsResult._redirects,
        }),
      },
    };
  } else if (uploadAssetsResult.shouldUploadAssets) {
    // we have assets but we didn't get a JWT; keep previous ones, they probably haven't changed
    metadata.keep_assets = true;
  }

  if (ENABLE_DURABLE_WORKER) {
    // replace main module with durable-worker entrypoint
    const entryContent = DURABLE_WORKER_SCRIPT.replace(
      "{{MAIN_MODULE}}",
      metadata.main_module || "index.js"
    );
    metadata.main_module = "__durable-worker.js";

    // add entry file
    filesObject.files["/__durable-worker.js"] = {
      type: "content",
      content: entryContent,
      size: 0,
      hash: "",
    };

    // add durable object binding
    metadata.bindings.push({
      name: "DurableWorkerDO",
      type: "durable_object_namespace",
      class_name: "DurableWorkerDO",
    });

    // TODO: How can we see which DOs are already bound and created, so don't need a migration? Ideally we want to be able to attach this DO to the worker if it wasn't created yet and is needed. But keep in mind people must still be able to deploy with wrangler after using it once! IDK if this is even possible unless I instruct them to update wrangler :|

    // Found it! curl -X GET "https://api.cloudflare.com/client/v4/accounts/080fd9e0587416d2fa30ed1f527e2323/workers/scripts/lmpify3/settings" \ -H "Authorization: Bearer APIKEY" \ -H "Content-Type: application/json" gives binding details. we can get DO binding info, and add the DurableWorkerDO if it wasn't bound yet. the only thing now is that you'd need to change wrangler if you wanna use wrangler directly again, but that's ok.
    // because of this though, we may wanna only activate it if "config" is in export default.
  }

  return { metadata, filesObject };
};

const getCurrentMigrationTag = async (
  auth: Auth,
  wranglerConfig: WranglerConfig
) => {
  let currentMigrationTag: string | undefined = undefined;

  if (!wranglerConfig.migrations) {
    return;
  }

  // Get latest migration tag
  try {
    // 1. List all versions and grab the latest one
    const listResp = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${auth.accountId}/workers/scripts/${wranglerConfig.name}/versions?per_page=1`,
      { headers: { Authorization: `Bearer ${auth.apiKey}` } }
    );

    if (!listResp.ok) {
      return;
    }

    const { result } = await listResp.json();
    const latestVersionId = result.items?.[0]?.id;

    if (!latestVersionId) {
      return;
    }
    // 2. Fetch detail for the latest version to read script_runtime.migration_tag
    const detailResp = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${auth.accountId}/workers/scripts/${wranglerConfig.name}/versions/${latestVersionId}`,
      { headers: { Authorization: `Bearer ${auth.apiKey}` } }
    );

    if (!detailResp.ok) {
      return;
    }
    const { result: versionDetail } = await detailResp.json();
    currentMigrationTag =
      versionDetail.resources?.script_runtime?.migration_tag || "";
    return currentMigrationTag;
  } catch (e) {
    console.warn(
      "Could not retrieve migration_tag – skipping migration filter:",
      e
    );
  }
};
async function handleDeploy(request: Request, ctx: ExecutionContext, env: Env) {
  try {
    const url = new URL(request.url);
    const auth = getAuth(request);
    if (!auth) {
      throw new Error("Unauthorized :(");
    }

    if (request.method !== "POST") {
      throw new Error("Invalid request method for handleDeploy");
    }

    // NB: clone before accessing the request
    const clonedRequest = request.clone() as Request;
    // Extract files from multipart form data

    // TODO: get config here
    const { filesObject, config } = await extractFilesFromFormData(request);

    if (!filesObject.files || typeof filesObject.files !== "object") {
      throw new Error("No files found in request");
    }

    if (Object.keys(filesObject.files).length === 0) {
      throw new Error("No files provided");
    }

    // Find and parse wrangler config
    let wranglerConfig = await findAndParseWranglerConfig(filesObject.files);
    if (!wranglerConfig) {
      // TODO: name based on the hash of the first file? seems iffy, but its ok
      const defaultName =
        "__flaredream-" +
        slugify(Object.values(filesObject.files)[0].hash).slice(0, 7);
      wranglerConfig = {
        name: config.name || defaultName,
        assets: { directory: "./" },
      };
      console.log("No wrangler config found, using defaults");
    }

    const currentMigrationTag = await getCurrentMigrationTag(
      auth,
      wranglerConfig
    );

    // Get subdomain from Cloudflare API
    const subdomainResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${auth.accountId}/workers/subdomain`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + auth.apiKey,
        },
      }
    );

    let subdomain: string | null = null;

    if (subdomainResponse.ok) {
      const subdomainData = await subdomainResponse.json<any>();
      subdomain = subdomainData.result?.subdomain || "";
    }

    // Convert wrangler config to worker metadata
    const conversionResult = convertWranglerToWorkerConfig(
      wranglerConfig,
      config.environmentVariables,
      currentMigrationTag
    );

    let { metadata, scriptName } = conversionResult;

    // Initialize errors tracking
    const errors: DeploymentErrors = {
      unsupportedRoutes: [],
      domainErrors: [],
    };

    // 1. Parse routes from wrangler config
    const { customDomains: wranglerDomains, unsupportedRoutes } =
      parseRoutesFromWranglerConfig(wranglerConfig);
    errors.unsupportedRoutes = unsupportedRoutes;

    // 2. Parse patterns from search params (these override wrangler routes)
    const { customDomains: paramDomains, domainErrors } =
      parseCustomDomainPatterns(url.searchParams);

    errors.domainErrors = domainErrors;

    // 3. Determine final list of custom domains (search params take priority)
    const allCustomDomains =
      paramDomains.length > 0 ? paramDomains : wranglerDomains;

    const uniqueCustomDomains = [...new Set(allCustomDomains)];

    console.log("Custom domains to process:", uniqueCustomDomains);

    // 4. Get zone information for all custom domains
    const zoneMap = await getZonesForHostnames(auth, uniqueCustomDomains);

    // Upload assets if any exist
    const assetFiles = filesObject.files;
    const shouldUploadAssets =
      Object.keys(assetFiles).length > 0 && metadata.assets ? true : false;
    const uploadAssetsResult = await uploadAssets(
      clonedRequest,
      scriptName,
      auth,
      env,
      shouldUploadAssets
    );

    console.log("uploadAssetsResult", uploadAssetsResult);
    // Find main worker script

    const build = getBuild(
      metadata,
      currentMigrationTag,
      uploadAssetsResult,
      filesObject
    );

    // Upload worker with assets
    const uploadResult = await uploadWorkerWithAssetsLegacy(
      auth,
      scriptName,
      build.metadata,
      build.filesObject.files
    );

    // Enable subdomain
    await ensureSubdomainEnabled(auth, scriptName);

    // Start with worker subdomain URL
    const deployedUrls: string[] = [];
    if (subdomain) {
      const workerUrl = `https://${scriptName}.${subdomain}.workers.dev`;
      deployedUrls.push(workerUrl);
    }

    // 5. Process custom domains in parallel (after worker deployment)
    const {
      results: customDomainResults,
      deployedUrls: customUrls,
      errors: customErrors,
    } = await processCustomDomains(
      auth,
      uniqueCustomDomains,
      scriptName,
      zoneMap
    );

    // Add custom domain URLs to deployed URLs
    deployedUrls.push(...customUrls);

    let debuggerUrl: string | null = null;
    if (subdomain && env.KV) {
      try {
        const tailProxyId = await createTailProxy(
          env,
          auth,
          scriptName,
          subdomain
        );
        const domain = `${tailProxyId}.evaloncloud.com`;
        debuggerUrl = `https://${domain}`;
        deployedUrls.push(debuggerUrl);
        customDomainResults.push({
          success: true,
          message: "Special debugging address",
          domain,
        });
      } catch (error) {
        console.error("Failed to create tail proxy:", error);

        customDomainResults.push({
          success: false,
          message: "Special debugging address",
          domain: ``,
          error: error.message,
        });
        // Don't fail the entire deployment if tail proxy creation fails
      }
    }

    // Add custom domain errors to overall errors
    errors.domainErrors.push(...customErrors);

    const dashboardUrl = `https://dash.cloudflare.com/?to=/:account/workers/services/view/${scriptName}/production/settings`;
    const acceptHeader = request.headers.get("accept") || "";

    const data: DeployResultData = {
      scriptName,
      workerUrl: deployedUrls.find((url) => url.includes(".workers.dev")),
      dashboardUrl,
      uploadResult,
      customDomainResults,
      debuggerUrl,
      assetCount: Object.keys(assetFiles).length,
      //@ts-ignore
      deployedUrls: [...new Set(deployedUrls)], // Remove duplicates
      errors:
        errors.unsupportedRoutes.length > 0 || errors.domainErrors.length > 0
          ? errors
          : undefined,
    };

    if (acceptHeader.includes("text/html")) {
      return new Response(getSuccessHtml(data), {
        headers: { "Content-Type": "text/html", ...corsHeaders },
      });
    }

    // Return JSON for non-HTML requests
    return new Response(JSON.stringify(data, undefined, 2), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    return new Response(`Deployment failed: ${errorMessage}`, {
      status: 500,
      headers: corsHeaders,
    });
  }
}

// [Rest of the original functions remain unchanged...]
interface Auth {
  accountId: string;
  apiKey: string;
}

interface FilesObject {
  files: {
    [path: string]: {
      type: "content" | "binary";
      url?: string;
      content?: string;
      hash: string;
      size: number;
    };
  };
}

interface Zone {
  id: string;
  name: string;
  status: string;
}

interface CustomDomainResult {
  success: boolean;
  domain: string;
  message: string;
  error?: string;
}

interface DeploymentErrors {
  unsupportedRoutes: string[];
  domainErrors: string[];
}

interface TailProxyData {
  headers: {
    "x-origin": string;
    "x-script": string;
    "x-account-id": string;
    "x-cloudflare-authorization": string;
  };
}

type DeployResultData = {
  scriptName: string;
  workerUrl: string | undefined;
  dashboardUrl: string;
  uploadResult: any;
  customDomainResults: CustomDomainResult[];
  debuggerUrl: string | null;
  assetCount: number;
  deployedUrls: string[];
  errors: DeploymentErrors | undefined;
};

// [All the remaining functions from the original code stay the same...]
async function createTailProxy(
  env: { KV?: KVNamespace },
  auth: Auth,
  scriptName: string,
  subdomain: string
): Promise<string> {
  if (!env.KV) {
    throw new Error("KV binding not found in environment");
  }

  // Generate random UUID for the proxy key
  const proxyId = crypto.randomUUID();

  // Store in KV with the UUID as key
  await env.KV.put(
    proxyId,
    JSON.stringify({
      headers: {
        "x-origin": `https://${scriptName}.${subdomain}.workers.dev`,
        "x-script": scriptName,
        "x-account-id": auth.accountId,
        "x-cloudflare-authorization": `Bearer ${auth.apiKey}`,
      },
    } satisfies TailProxyData),
    {
      // Optional: Set expiration (e.g., 24 hours)
      expirationTtl: 86400,
    }
  );

  return proxyId;
}

function getAuth(request: Request): Auth | null {
  // First, try to get auth from cookies
  const cookieHeader = request.headers.get("Cookie");
  if (cookieHeader) {
    const cookies = Object.fromEntries(
      cookieHeader.split("; ").map((cookie) => {
        const [name, value] = cookie.split("=");
        return [name, decodeURIComponent(value)];
      })
    );

    if (cookies.cf_account_id && cookies.cf_api_key) {
      return {
        accountId: cookies.cf_account_id,
        apiKey: cookies.cf_api_key,
      };
    }
  }

  // If no cookies found, try Basic Authorization header
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Basic ")) {
    try {
      const base64Credentials = authHeader.slice("Basic ".length);
      const credentials = atob(base64Credentials);
      const [accountId, apiKey] = credentials.split(":");

      if (accountId && apiKey) {
        return {
          accountId: accountId.trim(),
          apiKey: apiKey.trim(),
        };
      }
    } catch (error) {
      console.error("Failed to parse Basic Authorization header:", error);
    }
  }

  return null;
}

async function handleLogin(
  request: Request,
  auth: Auth | null,
  origin: string
) {
  if (auth) {
    // Already logged in, redirect to home
    return Response.redirect(origin + "/", 302);
  }

  // Show login form that redirects to SimpleAuth
  return redirectLoginResponse(origin);
}

async function handleCallback(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code) {
    return new Response("Authorization code not found", { status: 400 });
  }

  try {
    // Exchange code for token with SimpleAuth
    const tokenResponse = await fetch(
      "https://cloudflare.simplerauth.com/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: code,
          client_id: new URL(request.url).hostname,
          redirect_uri: url.origin + "/callback",
        }),
      }
    );

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json();
      return new Response(JSON.stringify(errorData), { status: 400 });
    }

    const tokenData = await tokenResponse.json();

    // Set secure cookies
    const cookieOptions =
      "HttpOnly; Secure; SameSite=Lax; Max-Age=2592000; Path=/";

    const headers = new Headers();
    headers.set(
      "Set-Cookie",
      `cf_account_id=${tokenData.cloudflare_account_id}; ${cookieOptions}`
    );
    headers.append(
      "Set-Cookie",
      `cf_api_key=${tokenData.cloudflare_api_key}; ${cookieOptions}`
    );

    headers.append("Location", "/");

    return new Response(null, { status: 302, headers });
  } catch (error) {
    return new Response("Network error occurred. Please try again.", {
      status: 400,
    });
  }
}

function redirectLoginResponse(origin: string, errorMessage = "") {
  // Generate random state for CSRF protection
  const state = crypto.randomUUID();

  const authUrl = new URL("https://cloudflare.simplerauth.com/authorize");
  authUrl.searchParams.set("client_id", new URL(origin).hostname);
  authUrl.searchParams.set("redirect_uri", origin + "/callback");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set(
    "message",
    "To deploy your applications to Cloudflare Workers and manage custom domains, create a custom token with Workers Scripts EDIT permission."
  );

  return new Response(null, {
    status: 302,
    headers: { Location: authUrl.toString() },
  });
}

function slugify(text: string): string {
  if (!text) {
    return "";
  }

  return text
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-") // Replace any character that's not a-z, 0-9, _, or - with a dash
    .replace(/-+/g, "-") // Replace multiple consecutive dashes with a single dash
    .replace(/^-+|-+$/g, ""); // Remove leading and trailing dashes
}

async function findAndParseWranglerConfig(
  files: FilesObject["files"]
): Promise<WranglerConfig | null> {
  // Look for wrangler config files in order of preference
  const configFiles = ["/wrangler.toml", "/wrangler.json", "/wrangler.jsonc"];

  for (const configFile of configFiles) {
    const file = files[configFile];
    if (file && file.type === "content" && file.content) {
      try {
        if (configFile.endsWith(".toml")) {
          return load(file.content);
        } else if (configFile.endsWith(".json")) {
          return JSON.parse(file.content);
        } else if (configFile.endsWith(".jsonc")) {
          return JSON5.parse(file.content);
        }
      } catch (error) {
        console.error(`Failed to parse ${configFile}:`, error);
        continue;
      }
    }
  }

  return null;
}

function findMainScript(
  files: FilesObject["files"],
  mainModule: string | undefined
) {
  if (!mainModule) {
    return null;
  }
  // Try to find the main script file
  const possiblePaths = [
    "/" + mainModule,
    "/" + mainModule.replace(".js", ".ts"),
  ];

  for (const path of possiblePaths) {
    if (files[path] && files[path].type === "content") {
      return files[path].content;
    }
  }

  return null;
}

type UploadAssetsResult = {
  success: boolean;
  message: string;
  failedUploads?: any;
  _headers?: string;
  _redirects?: string;
  jwt?: string | null;
  shouldUploadAssets: boolean;
};
async function uploadAssets(
  request: Request,
  scriptName: string,
  auth: Auth,
  env: Env,
  shouldUploadAssets: boolean
): Promise<UploadAssetsResult> {
  if (!shouldUploadAssets) {
    return {
      message: "Not needed",
      success: true,
      jwt: null,
      shouldUploadAssets: false,
      _headers: undefined,
      _redirects: undefined,
    };
  }
  // Upload using service binding
  const uploadUrl = `https://assets.flaredream.com/${scriptName}`;

  const response = await env.FLAREDREAM_ASSETS.fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Type": request.headers.get("content-type"),
      Authorization: `Basic ${btoa(`${auth.accountId}:${auth.apiKey}`)}`,
    },
    body: request.body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Asset upload failed: ${response.status} - ${errorText}`);
  }

  const result = await response.json<{
    success: boolean;
    message: string;
    failedUploads: any;
    _headers?: string;
    _redirects?: string;
    jwt?: string | null;
  }>();

  // if (!result.jwt) {
  //   throw new Error("No JWT returned from asset upload");
  // }

  return { ...result, shouldUploadAssets: true };
}

// An array of modules (often JavaScript files) comprising a Worker script. At least one module must be present and referenced in the metadata as main_module or body_part by filename. Possible Content-Type(s) are: application/javascript+module, text/javascript+module, application/javascript, text/javascript, application/wasm, text/plain, application/octet-stream, application/source-map
// NB: incorrect mimetypes can give 500 error!
const allowedExtensions = {
  js: "application/javascript+module",
  "": "application/javascript+module",
  cjs: "application/javascript+module",
  mjs: "application/javascript+module",
  // not sure if it is parsed
  // jsx: "application/javascript+module",
  // surely not possible
  // ts: "application/javascript+module",
  // mts: "application/javascript+module",
  // cts: "application/javascript+module",
  // tsx: "application/javascript+module",

  html: "text/plain",
  css: "text/plain",
  txt: "text/plain",
  md: "text/plain",
  mdx: "text/plain",

  // custom loaders
  toml: "application/javascript+module",
  yaml: "application/javascript+module",
  json: "application/javascript+module",
  jsonc: "application/javascript+module",

  // never tried, would be cool to make it easy
  wasm: "application/wasm",

  // TODO: this MIGHT help in error handling (when we include sourcemaps for typescript files)
  // for now it can probably be added without breaking anything
  // but i know where to look if i get 500
  map: "application/source-map",
};

const loadContent = (ext: string, content: string | undefined) => {
  if (!content) {
    return undefined;
  }
  if (ext === "json") {
    return `export default ${content}`;
  }

  if (ext === "jsonc") {
    return `export default ${JSON.stringify(JSON5.parse(content))}`;
  }

  if (ext === "toml") {
    return `export default ${JSON.stringify(load(content))}`;
  }

  if (ext === "yaml" || ext === "yml") {
    return `export default ${JSON.stringify(parse(content))}`;
  }

  if (ext === "") {
    // Special: JS module! For now, should silently be accepted as javascript, but we may want to try parsing it first, incase people include extensionless files into their bundle that aren't JS

    // TODO: add https://github.com/acornjs/acorn as a parser to be sure it's parseable.

    // Ideally, I should first parse all js for their imports, and only include files and modules included from the entrypoint.

    return content;
  }

  // regular string or javascript module
  return content;
};

async function uploadWorkerWithAssetsLegacy(
  auth: Auth,
  scriptName: string,
  metadata: WorkerMetadata,
  allFiles?: FilesObject["files"]
) {
  const scriptContent = findMainScript(allFiles, metadata.main_module);
  //https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/
  const apiUrl = `https://api.cloudflare.com/client/v4/accounts/${auth.accountId}/workers/scripts/${scriptName}`;

  // Prepare the multipart form data
  const formData = new FormData();
  formData.append("metadata", JSON.stringify(metadata));

  if (scriptContent) {
    // Add main worker script

    formData.append(
      metadata.main_module || "index.js",
      new Blob([scriptContent], { type: "application/javascript+module" }),
      metadata.main_module || "index.js"
    );

    // Add additional worker files (like WebAssembly modules, etc.)
    if (allFiles) {
      for (let [path, file] of Object.entries(allFiles)) {
        path = path.startsWith("/") ? path.slice(1) : path;
        const segments = path.split(".");
        const isExtensionless = segments.length === 1;
        const ext = isExtensionless ? "" : segments.pop();

        const isExtensionAllowed = Object.keys(allowedExtensions).includes(ext);

        const isFileAllowed =
          file.type === "content" &&
          //allow for extensionless files or one of the above
          (isExtensionAllowed || isExtensionless) &&
          path !== (metadata.main_module || "index.js");

        const type = allowedExtensions[ext];
        const content = loadContent(ext, file.content);

        if (isFileAllowed && content) {
          formData.append(path, new Blob([content], { type }), path);
        }
      }
    }
  } else {
    console.log("NO ScriptContent, just assets!");
  }

  // for (const [key, value] of formData.entries()) {
  //   if (value instanceof File) {
  //     console.log("file", key, "name", value.name, "value", await value.text());
  //   } else {
  //     console.log("non file:", key);
  //   }
  // }

  const response = await fetch(apiUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${auth.apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Worker upload failed: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  return result;
}

async function ensureSubdomainEnabled(auth: Auth, scriptName: string) {
  try {
    // First, check if the subdomain is already enabled
    const getResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${auth.accountId}/workers/scripts/${scriptName}/subdomain`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${auth.apiKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (getResponse.ok) {
      const getResult = await getResponse.json();

      // If subdomain is already enabled, no need to do anything
      if (getResult.result?.enabled) {
        console.log(`Subdomain already enabled for ${scriptName}`);
        return;
      }
    }

    // If not enabled or request failed, enable the subdomain
    const postResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${auth.accountId}/workers/scripts/${scriptName}/subdomain`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enabled: true,
          previews_enabled: true,
        }),
      }
    );

    if (postResponse.ok) {
      console.log(`Subdomain enabled for ${scriptName}`);
    } else {
      const errorData = await postResponse.json();
      console.error(`Failed to enable subdomain for ${scriptName}:`, errorData);
    }
  } catch (error) {
    console.error(`Error ensuring subdomain enabled for ${scriptName}:`, error);
  }
}

function getSuccessHtml(data: DeployResultData) {
  const deployedUrlsHtml = data.deployedUrls
    .map(
      (url) => `<a href="${url}" target="_blank" class="url-link">${url}</a>`
    )
    .join("");

  // Add custom domain status messages
  const customDomainMessages =
    data.customDomainResults
      ?.map((result) => {
        const statusClass = result.success ? "success" : "error";
        const icon = result.success ? "✅" : "❌";
        return `<div class="domain-status ${statusClass}">
        <span class="domain-icon">${icon}</span>
        <div class="domain-details">
          <div class="domain-name">${result.domain}</div>
          <div class="domain-message">${result.message}</div>
        </div>
      </div>`;
      })
      .join("") || "";

  // Add error messages
  const errorMessages = [];
  if (data.errors?.unsupportedRoutes.length) {
    errorMessages.push(`
      <div class="error-section">
        <h4>⚠️ Unsupported Routes Ignored</h4>
        <p>The following routes don't have custom_domain:true and were skipped:</p>
        <ul>
          ${data.errors.unsupportedRoutes
            .map((route) => `<li><code>${route}</code></li>`)
            .join("")}
        </ul>
        <p>Only custom domains are supported. Traditional route patterns are not yet supported.</p>
      </div>
    `);
  }
  if (data.errors?.domainErrors.length) {
    errorMessages.push(`
      <div class="error-section">
        <h4>❌ Domain Setup Warnings</h4>
        <ul>
          ${data.errors.domainErrors
            .map((error) => `<li>${error}</li>`)
            .join("")}
        </ul>
      </div>
    `);
  }

  const errorHtml = errorMessages.join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Deployment Successful - Flaredream</title>
    <meta name="description" content="Your app is now live on Cloudflare!" />
    <script>
      window.data = ${JSON.stringify(data, undefined, 2)};
    </script>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            background: linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 50%, #2a1810 100%);
            min-height: 100vh;
            overflow-x: hidden;
            color: #ffffff;
        }

        /* Animated background particles */
        .particles {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 1;
        }

        .particle {
            position: absolute;
            width: 2px;
            height: 2px;
            background: linear-gradient(45deg, #ff6b35, #f7931e);
            border-radius: 50%;
            animation: float 6s ease-in-out infinite;
        }

        @keyframes float {
            0%, 100% { transform: translateY(0px) rotate(0deg); opacity: 0.7; }
            50% { transform: translateY(-20px) rotate(180deg); opacity: 1; }
        }

        /* Main container */
        .container {
            position: relative;
            z-index: 2;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 2rem;
        }

        /* Logo/Brand */
        .brand {
            margin-bottom: 3rem;
            text-align: center;
        }

        .brand h1 {
            font-size: 2rem;
            font-weight: 700;
            background: linear-gradient(135deg, #ff6b35, #f7931e, #ffaa44);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            margin-bottom: 0.5rem;
        }

        .brand p {
            color: #888;
            font-size: 1.1rem;
        }

        /* Main card */
        .main-card {
            background: rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 107, 53, 0.2);
            border-radius: 24px;
            padding: 3rem 2.5rem;
            max-width: 700px;
            width: 100%;
            box-shadow: 
                0 8px 32px rgba(0, 0, 0, 0.3),
                0 0 0 1px rgba(255, 255, 255, 0.1) inset;
            position: relative;
            overflow: hidden;
            text-align: center;
        }

        .main-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 1px;
            background: linear-gradient(90deg, transparent, rgba(255, 107, 53, 0.8), transparent);
        }

        /* Success icon */
        .success-icon {
            font-size: 4rem;
            margin-bottom: 1.5rem;
            color: #4ade80;
        }

        /* Headline */
        .headline {
            margin-bottom: 2rem;
        }

        .headline h2 {
            font-size: 2.5rem;
            font-weight: 800;
            line-height: 1.2;
            margin-bottom: 1rem;
            background: linear-gradient(135deg, #ffffff, #ff6b35);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        .subtitle {
            color: #ccc;
            font-size: 1.1rem;
            margin-bottom: 0.5rem;
        }

        .worker-name {
            color: #ff6b35;
            font-weight: 600;
            font-size: 1.2rem;
            margin-bottom: 2rem;
        }

        /* URLs Section */
        .urls-section {
            margin: 2rem 0;
            text-align: left;
        }

        .urls-section h3 {
            color: #ffffff;
            font-size: 1.2rem;
            margin-bottom: 1rem;
            text-align: center;
        }

        .url-link {
            display: block;
            color: #4ade80;
            text-decoration: none;
            padding: 0.75rem 1rem;
            margin: 0.5rem 0;
            background: rgba(74, 222, 128, 0.1);
            border: 1px solid rgba(74, 222, 128, 0.2);
            border-radius: 8px;
            font-family: 'Monaco', 'Menlo', monospace;
            font-size: 0.9rem;
            transition: all 0.3s ease;
            word-break: break-all;
        }

        .url-link:hover {
            background: rgba(74, 222, 128, 0.2);
            border-color: rgba(74, 222, 128, 0.4);
            transform: translateY(-1px);
        }

        /* Custom Domain Status Section */
        .domain-status-section {
            margin: 2rem 0;
            text-align: left;
        }

        .domain-status-section h3 {
            color: #ffffff;
            font-size: 1.2rem;
            margin-bottom: 1rem;
            text-align: center;
        }

        .domain-status {
            display: flex;
            align-items: flex-start;
            padding: 1rem;
            margin: 0.5rem 0;
            border-radius: 8px;
            border: 1px solid;
        }

        .domain-status.success {
            background: rgba(74, 222, 128, 0.1);
            border-color: rgba(74, 222, 128, 0.3);
        }

        .domain-status.error {
            background: rgba(239, 68, 68, 0.1);
            border-color: rgba(239, 68, 68, 0.3);
        }

        .domain-icon {
            font-size: 1.2rem;
            margin-right: 0.75rem;
            margin-top: 0.1rem;
        }

        .domain-details {
            flex: 1;
        }

        .domain-name {
            font-weight: 600;
            font-family: 'Monaco', 'Menlo', monospace;
            font-size: 0.9rem;
            margin-bottom: 0.25rem;
        }

        .domain-status.success .domain-name {
            color: #4ade80;
        }

        .domain-status.error .domain-name {
            color: #ef4444;
        }

        .domain-message {
            font-size: 0.85rem;
            color: #ccc;
            line-height: 1.4;
        }

        /* Error sections */
        .error-section {
            margin: 1.5rem 0;
            padding: 1rem;
            background: rgba(239, 68, 68, 0.1);
            border: 1px solid rgba(239, 68, 68, 0.3);
            border-radius: 8px;
            text-align: left;
        }

        .error-section h4 {
            color: #ef4444;
            margin-bottom: 0.5rem;
        }

        .error-section p, .error-section li {
            color: #ccc;
            font-size: 0.9rem;
            line-height: 1.4;
        }

        .error-section ul {
            margin: 0.5rem 0;
            padding-left: 1.5rem;
        }

        .error-section code {
            background: rgba(0, 0, 0, 0.3);
            padding: 0.2rem 0.4rem;
            border-radius: 4px;
            font-family: 'Monaco', 'Menlo', monospace;
            font-size: 0.85rem;
        }

        /* Button */
        .settings-btn {
            display: inline-block;
            padding: 1.25rem 2rem;
            background: linear-gradient(135deg, #ff6b35, #f7931e);
            border: none;
            border-radius: 12px;
            color: #ffffff;
            font-size: 1.1rem;
            font-weight: 600;
            text-decoration: none;
            cursor: pointer;
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
            margin: 0.5rem;
        }

        .settings-btn::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
            transition: left 0.5s ease;
        }

        .settings-btn:hover::before {
            left: 100%;
        }

        .settings-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(255, 107, 53, 0.4);
        }

        .settings-btn:active {
            transform: translateY(0);
        }

        /* Responsive */
        @media (max-width: 640px) {
            .headline h2 {
                font-size: 2rem;
            }
            
            .main-card {
                padding: 2rem 1.5rem;
                margin: 1rem;
            }
        }
    </style>
</head>
<body>
    <div class="particles" id="particles"></div>
    
    <div class="container">
        <div class="brand">
            <h1>Flaredream</h1>
            <p>The Better Way To Ship</p>
        </div>

        <div class="main-card">
            <div class="success-icon">🚀</div>
            
            <div class="headline">
                <h2>Your app is now live on Cloudflare!</h2>
            </div>

            <div class="subtitle">Worker deployed successfully:</div>
            <div class="worker-name">${data.scriptName}</div>

            <div class="urls-section">
                <h3>Your app is available at:</h3>
                ${deployedUrlsHtml}
            </div>

            ${
              customDomainMessages
                ? `
            <div class="domain-status-section">
                <h3>Custom Domain Status:</h3>
                ${customDomainMessages}
            </div>
            `
                : ""
            }

            ${errorHtml}

            <a href="${
              data.dashboardUrl
            }" class="settings-btn" target="_blank">Settings</a>
        </div>
    </div>

    <script>
        // Create floating particles
        function createParticles() {
            const particlesContainer = document.getElementById('particles');
            const particleCount = 50;

            for (let i = 0; i < particleCount; i++) {
                const particle = document.createElement('div');
                particle.className = 'particle';
                
                particle.style.left = Math.random() * 100 + '%';
                particle.style.top = Math.random() * 100 + '%';
                particle.style.animationDelay = Math.random() * 6 + 's';
                particle.style.animationDuration = (Math.random() * 4 + 4) + 's';
                
                particlesContainer.appendChild(particle);
            }
        }

        // Initialize particles
        createParticles();
    </script>
</body>
</html>`;
}

// NEW: Parse routes from wrangler config and extract custom domains
function parseRoutesFromWranglerConfig(wranglerConfig: WranglerConfig): {
  customDomains: string[];
  unsupportedRoutes: string[];
} {
  const customDomains: string[] = [];
  const unsupportedRoutes: string[] = [];

  if (!wranglerConfig.routes) {
    return { customDomains, unsupportedRoutes };
  }

  const routes = Array.isArray(wranglerConfig.routes)
    ? wranglerConfig.routes
    : [wranglerConfig.routes];

  for (const route of routes) {
    if (typeof route === "string") {
      // String routes are not supported (they don't have custom_domain flag)
      unsupportedRoutes.push(route);
    } else if (typeof route === "object" && route.pattern) {
      // Object routes can have custom_domain flag
      if (route.custom_domain === true) {
        const hostname = extractHostnameFromRoutePattern(route.pattern);
        if (hostname && !customDomains.includes(hostname)) {
          customDomains.push(hostname);
        }
      } else {
        // Route without custom_domain:true is not supported
        unsupportedRoutes.push(route.pattern);
      }
    }
  }

  return { customDomains, unsupportedRoutes };
}

// NEW: Extract hostname from route pattern (handles both domains and subdomains)
function extractHostnameFromRoutePattern(pattern: string): string {
  // Remove protocol if present
  let hostname = pattern.replace(/^https?:\/\//, "");

  // Extract hostname part (before any path)
  hostname = hostname.split("/")[0];

  // Remove port if present
  hostname = hostname.split(":")[0];

  // For wildcard patterns like *.example.com, convert to specific subdomain
  if (hostname.startsWith("*.")) {
    // For *.example.com, we'll use api.example.com as default
    return hostname.replace("*.", "api.");
  }

  return hostname;
}

// NEW: Parse patterns from search params and validate they're proper hostnames
function parseCustomDomainPatterns(searchParams: URLSearchParams): {
  customDomains: string[];
  domainErrors: string[];
} {
  const patterns = searchParams.getAll("pattern");
  const customDomains: string[] = [];
  const domainErrors: string[] = [];

  for (const pattern of patterns) {
    const hostname = extractHostnameFromRoutePattern(pattern);

    // Validate hostname
    if (!hostname || hostname.length === 0) {
      domainErrors.push(
        `Invalid pattern: "${pattern}" - could not extract valid hostname`
      );
      continue;
    }

    // Check if it's a valid hostname format
    if (!/^[a-zA-Z0-9.-]+$/.test(hostname)) {
      domainErrors.push(
        `Invalid hostname: "${hostname}" - contains invalid characters`
      );
      continue;
    }

    // Skip .workers.dev domains
    if (hostname.includes(".workers.dev")) {
      domainErrors.push(
        `Skipped "${hostname}" - .workers.dev domains are handled automatically`
      );
      continue;
    }

    if (!customDomains.includes(hostname)) {
      customDomains.push(hostname);
    }
  }

  return { customDomains, domainErrors };
}

// NEW: Get zones for all unique hostnames by looking up each hostname individually
async function getZonesForHostnames(
  auth: Auth,
  hostnames: string[]
): Promise<{ [hostname: string]: Zone }> {
  const zoneMap: { [hostname: string]: Zone } = {};

  if (hostnames.length === 0) {
    return zoneMap;
  }

  // Function to get the root domain from a hostname
  function getRootDomain(hostname: string): string {
    const parts = hostname.split(".");
    if (parts.length <= 2) {
      return hostname; // Already a root domain
    }
    // Return the last two parts (e.g., "api.example.com" -> "example.com")
    return parts.slice(-2).join(".");
  }

  // Get unique root domains to avoid duplicate API calls
  const rootDomains = [...new Set(hostnames.map(getRootDomain))];

  try {
    // Look up each root domain in parallel
    const zonePromises = rootDomains.map(async (rootDomain) => {
      try {
        const response = await fetch(
          `https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(
            rootDomain
          )}&account.id=${auth.accountId}`,
          {
            headers: {
              Authorization: `Bearer ${auth.apiKey}`,
              "Content-Type": "application/json",
            },
          }
        );

        if (!response.ok) {
          console.error(
            `Failed to fetch zone for ${rootDomain}: ${response.status}`
          );
          return { rootDomain, zone: null };
        }

        const data = await response.json();
        if (!data.success || !data.result || data.result.length === 0) {
          console.warn(`❌ No zone found for root domain: ${rootDomain}`);
          return { rootDomain, zone: null };
        }

        // Return the first (and should be only) matching zone
        const zone: Zone = data.result[0];
        console.log(
          `✅ Found zone "${zone.name}" for root domain "${rootDomain}"`
        );
        return { rootDomain, zone };
      } catch (error) {
        console.error(`Error fetching zone for ${rootDomain}:`, error);
        return { rootDomain, zone: null };
      }
    });

    const zoneResults = await Promise.all(zonePromises);

    // Create a mapping from root domain to zone
    const rootDomainToZone: { [rootDomain: string]: Zone } = {};
    for (const { rootDomain, zone } of zoneResults) {
      if (zone) {
        rootDomainToZone[rootDomain] = zone;
      }
    }

    // Map each original hostname to its corresponding zone
    for (const hostname of hostnames) {
      const rootDomain = getRootDomain(hostname);
      const zone = rootDomainToZone[rootDomain];
      if (zone) {
        zoneMap[hostname] = zone;
        console.log(`✅ Mapped hostname "${hostname}" to zone "${zone.name}"`);
      } else {
        console.warn(`❌ No zone found for hostname: ${hostname}`);
      }
    }

    return zoneMap;
  } catch (error) {
    console.error("Error fetching zones:", error);
    return zoneMap;
  }
}

function findZoneForHostname(hostname: string, zones: Zone[]): Zone | null {
  const hostnameLC = hostname.toLowerCase();

  // Sort zones by name length (longest first) to match most specific zone
  const sortedZones = zones.sort((a, b) => b.name.length - a.name.length);

  for (const zone of sortedZones) {
    const zoneName = zone.name.toLowerCase();

    // Exact match
    if (hostnameLC === zoneName) {
      return zone;
    }

    // Subdomain match (hostname ends with .zoneName)
    if (hostnameLC.endsWith("." + zoneName)) {
      return zone;
    }
  }

  return null;
}

async function createCustomDomain(
  auth: Auth,
  hostname: string,
  scriptName: string,
  zone: Zone
): Promise<CustomDomainResult> {
  try {
    console.log(
      `🌐 Setting up custom domain "${hostname}" for worker "${scriptName}"`
    );

    // Use the proper Workers Custom Domains API endpoint
    const apiUrl = `https://api.cloudflare.com/client/v4/accounts/${auth.accountId}/workers/domains`;

    const domainData = {
      zone_id: zone.id,
      hostname: hostname,
      service: scriptName,
      environment: "production",
      override_existing_origin: true,
    };

    console.log(`🚀 Creating custom domain attachment:`, domainData);

    const response = await fetch(apiUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${auth.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(domainData),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error(
        `❌ Custom domain creation failed for "${hostname}":`,
        errorData
      );

      // Handle specific error cases
      if (response.status === 403) {
        return {
          success: false,
          domain: hostname,
          message: `Permission denied. Please ensure your API token has "Workers Custom Domains" EDIT permission and "Zone Settings" EDIT permission for zone "${zone.name}".`,
          error: "INSUFFICIENT_PERMISSIONS",
        };
      }

      if (response.status === 400) {
        const errorMessage = errorData.errors?.[0]?.message || "Bad request";
        return {
          success: false,
          domain: hostname,
          message: `Failed to create custom domain "${hostname}": ${errorMessage}`,
          error: "BAD_REQUEST",
        };
      }

      const errorMessage =
        errorData.errors?.[0]?.message || `HTTP ${response.status}`;
      return {
        success: false,
        domain: hostname,
        message: `Failed to create custom domain "${hostname}": ${errorMessage}`,
        error: "API_ERROR",
      };
    }

    const result = await response.json();

    if (result.success) {
      console.log(`✅ Custom domain "${hostname}" successfully created`);
      return {
        success: true,
        domain: hostname,
        message: `Custom domain "${hostname}" successfully attached to worker "${scriptName}". DNS records and SSL certificates are being automatically configured.`,
      };
    } else {
      const errorMessage = result.errors?.[0]?.message || "Unknown error";
      console.error(
        `❌ Custom domain API returned error for "${hostname}":`,
        result.errors
      );
      return {
        success: false,
        domain: hostname,
        message: `Failed to create custom domain "${hostname}": ${errorMessage}`,
        error: "API_ERROR",
      };
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error(
      `❌ Network error creating custom domain "${hostname}":`,
      error
    );
    return {
      success: false,
      domain: hostname,
      message: `Network error while creating custom domain "${hostname}": ${errorMessage}`,
      error: "NETWORK_ERROR",
    };
  }
}

async function processCustomDomains(
  auth: Auth,
  customDomains: string[],
  scriptName: string,
  zoneMap: { [hostname: string]: Zone }
): Promise<{
  results: CustomDomainResult[];
  deployedUrls: string[];
  errors: string[];
}> {
  const results: CustomDomainResult[] = [];
  const deployedUrls: string[] = [];
  const errors: string[] = [];

  if (customDomains.length === 0) {
    return { results, deployedUrls, errors };
  }

  // Process all custom domains in parallel
  const domainPromises = customDomains.map(async (hostname) => {
    const zone = zoneMap[hostname];

    if (!zone) {
      const error = `Domain "${hostname}" is not managed by your Cloudflare account. Please add the domain to Cloudflare first.`;
      errors.push(error);
      return {
        success: false,
        domain: hostname,
        message: error,
        error: "ZONE_NOT_FOUND",
      } as CustomDomainResult;
    }

    return createCustomDomain(auth, hostname, scriptName, zone);
  });

  const domainResults = await Promise.all(domainPromises);

  for (const result of domainResults) {
    results.push(result);

    if (result.success) {
      deployedUrls.push(`https://${result.domain}`);
    }
  }

  return { results, deployedUrls, errors };
}
