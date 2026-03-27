/// <reference types="@cloudflare/workers-types" />
/// <reference lib="es2015" />
//@ts-check

/**
 * Handles the HTTP fetch event
 * @param {Request} request - The incoming request
 * @param {any} env - Environment variables
 * @param {ExecutionContext} ctx - Execution context
 * @returns {Promise<Response>}
 */
export async function proxy(request, env, ctx) {
  // Extract required headers
  const scriptName = request.headers.get("x-script");
  const origin = request.headers.get("x-origin");
  const accountId = request.headers.get("x-account-id");
  const authorization = request.headers.get("x-cloudflare-authorization");

  // Validate required headers
  if (!scriptName || !origin || !accountId || !authorization) {
    return new Response(
      JSON.stringify({
        error:
          "Missing required headers: x-script, x-origin, x-account-id, x-cloudflare-authorization",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Create a new request without the custom headers
  const newHeaders = new Headers(request.headers);
  newHeaders.delete("x-script");
  newHeaders.delete("x-origin");
  newHeaders.delete("x-account-id");
  newHeaders.delete("x-cloudflare-authorization");

  // Create an array to store logs
  const logs = [];

  // Start a tail for the worker
  let tailId = null;
  try {
    // Start a tail
    const tailResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}/tails`,
      {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      }
    );

    let tailFailed = false;
    if (!tailResponse.ok) {
      /** @type {{success:false,errors:{code:number,message:string}[]}} */
      const errorData = await tailResponse.json();
      if (errorData.errors[0]?.code === 100311) {
        // Cannot tail a Worker which only has assets. This may be possible in the future.
        tailFailed = true;
      } else {
        return new Response(
          JSON.stringify({ error: "Failed to start tail", details: errorData }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    let ws;

    if (!tailFailed) {
      // only do this if tail could be done

      const tailData = await tailResponse.json();
      tailId = tailData.result.id;
      const wsUrl = tailData.result.url;

      // Connect to the WebSocket to collect logs
      ws = new WebSocket(wsUrl);

      ws.addEventListener("message", (event) => {
        try {
          const data = JSON.parse(event.data);
          logs.push(data);
        } catch (e) {
          logs.push({ error: "Failed to parse log data", raw: event.data });
        }
      });

      // Ensure the WebSocket is connected before continuing
      await new Promise((resolve) => {
        if (ws.readyState === WebSocket.OPEN) {
          resolve();
        } else {
          ws.addEventListener("open", () => resolve());
        }
      });
    }

    // Forward the request to the original worker
    const newRequest = new Request(origin, {
      method: request.method,
      headers: newHeaders,
      body: request.body,
      redirect: request.redirect,
    });

    const originalResponse = await fetch(newRequest);

    // Clone the response so we can read the body
    const clonedResponse = originalResponse.clone();

    // Read the response body to ensure we get all logs
    await originalResponse.text();

    // Close the WebSocket if it was open
    ws?.close();

    // Create a new response with the original response's body and headers,
    // plus the logs in a custom header
    const responseHeaders = new Headers(originalResponse.headers);
    responseHeaders.set("x-tail", JSON.stringify(logs));

    // Delete the tail
    if (tailId) {
      ctx.waitUntil(deleteTail(accountId, scriptName, tailId, authorization));
    }

    return new Response(clonedResponse.body, {
      status: originalResponse.status,
      statusText: originalResponse.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    // If there's an error, make sure to delete the tail
    if (tailId) {
      ctx.waitUntil(deleteTail(accountId, scriptName, tailId, authorization));
    }

    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/**
 * Deletes a tail from a Worker
 * @param {string} accountId - Cloudflare account ID
 * @param {string} scriptName - Worker script name
 * @param {string} tailId - ID of the tail to delete
 * @param {string} authorization - Authorization header value
 * @returns {Promise<void>}
 */
async function deleteTail(accountId, scriptName, tailId, authorization) {
  try {
    await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}/tails/${tailId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Failed to delete tail:", error);
  }
}

export default {
  /**
   * @param {Request} request
   * @param {{KV:KVNamespace}} env
   * @param {ExecutionContext} ctx - Execution context
   * @returns {Promise<Response>}
   */
  fetch: async (request, env, ctx) => {
    const url = new URL(request.url);
    const [tld, domain, id] = url.hostname.split(".").reverse();
    if (!id) {
      return new Response("No ID", { status: 404 });
    }

    /**
     * @type {null|{headers: {"x-origin": string;"x-script": string;"x-account-id": string;"x-cloudflare-authorization": string}}}
     */
    const value = await env.KV.get(id, "json");

    if (!value) {
      return new Response("No value", { status: 404 });
    }

    const headers = new Headers(request.headers);
    Object.keys(value.headers).forEach((key) => {
      headers.append(key, value.headers[key]);
    });

    return proxy(
      new Request(value.headers["x-origin"] + url.pathname + url.search, {
        headers,
        body: request.body,
        method: request.method,
      }),
      env,
      ctx
    );
  },
};
