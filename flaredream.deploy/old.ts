/**
 * Upload a Worker using the new two-step API:
 * 1. POST /versions → create a version (with optional assets).
 * 2. POST /deployments → create a 100 % deployment for that version.
 * Returns the “Create Deployment” response body.
 *
 * This is currently not used since it does NOT support durable object migrations yet, we need the legacy endpoint for that
 */
async function uploadWorkerWithAssets(
  auth: Auth,
  scriptName: string,
  scriptContent: string | null | undefined,
  metadata: any,
  jwt?: string,
  headersFile?: any,
  redirectsFile?: any,
  allFiles?: FilesObject["files"]
): Promise<any> {
  const account = auth.accountId;
  const token = auth.apiKey;

  /* ---------- 1. Build multipart payload ---------- */
  const form = new FormData();

  // Normalise metadata
  const meta = {
    // migrations not neededd in this endpoint!
    //      "message": "Version upload failed. You attempted to upload a version of a Worker that includes a Durable Object migration, but migrations must be fully applied by running \"wrangler deploy\". See https://developers.cloudflare.com/workers/configuration/versions-and-deployments/gradual-deployments/#gradual-deployments-for-durable-objects for more information.",

    /// ...metadata,
    main_module: metadata.main_module || "index.js",
    compatibility_date:
      metadata.compatibility_date || new Date().toISOString().slice(0, 10),
    compatibility_flags: metadata.compatibility_flags || [],
    bindings: metadata.bindings || [],
  };

  // Add assets if we have a JWT
  if (jwt) {
    meta.assets = {
      jwt,
      config: {
        html_handling: "auto-trailing-slash",
        not_found_handling: "404-page",
        ...(headersFile?.content && { _headers: headersFile.content }),
        ...(redirectsFile?.content && { _redirects: redirectsFile.content }),
      },
    };
  }

  form.append("metadata", JSON.stringify(meta));

  // Main script
  if (scriptContent) {
    form.append(
      meta.main_module,
      new Blob([scriptContent], { type: "application/javascript+module" }),
      meta.main_module
    );
  }

  // Additional modules / assets
  if (allFiles) {
    for (const [path, file] of Object.entries(allFiles)) {
      const cleanPath = path.startsWith("/") ? path.slice(1) : path;
      const ext = cleanPath.split(".").pop();
      const mimeMap: Record<string, string> = {
        js: "application/javascript+module",
        ts: "text/typescript",
        html: "text/plain",
        // would this work?
        // md: "text/plain",
        json: "application/json",
        wasm: "application/wasm",
      };
      if (
        file.type === "content" &&
        mimeMap[ext] &&
        cleanPath !== meta.main_module
      ) {
        form.append(
          cleanPath,
          new Blob([file.content || ""], { type: mimeMap[ext] }),
          cleanPath
        );
      }
    }
  }

  console.log("FINAL META", meta);
  /* ---------- 2. Create a Version ---------- */
  const versionResp = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${scriptName}/versions`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    }
  );

  if (!versionResp.ok) {
    const txt = await versionResp.text();
    throw new Error(`Version upload failed (${versionResp.status}): ${txt}`);
  }

  const { result: version } = await versionResp.json();
  const versionId = version.id;

  /* ---------- 3. Deploy the Version (100 %) ---------- */
  const deployResp = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${scriptName}/deployments`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        strategy: "percentage",
        versions: [{ version_id: versionId, percentage: 100 }],
        annotations: {},
      }),
    }
  );

  if (!deployResp.ok) {
    const txt = await deployResp.text();
    throw new Error(`Deployment failed (${deployResp.status}): ${txt}`);
  }

  return deployResp.json(); // contains { success, errors, messages, result }
}
