

Attempt at making a proxy that proxies a request to another worker, but also tails that worker during the lifetime of the request to collect errors, warnings, and logs, effectively simplifying the API

[![](https://b.lmpify.com/Iteration_1)](https://lmpify.com/what-api-does-wrang-xqit6l0)


This worker:

1. Extracts required headers from the incoming request (script name, origin, account ID, and authorization)
2. Validates that all required headers are present
3. Creates a new request without the custom headers
4. Establishes a tail connection using the Cloudflare API (`/accounts/{account_id}/workers/scripts/{script_name}/tails`)
5. Collects logs via WebSocket during the request
6. Forwards the request to the target worker
7. Waits for the entire response body to be processed
8. Adds all logs to the `x-tail` response header as a JSON array
9. Cleans up by deleting the tail after the request is complete (`/accounts/{account_id}/workers/scripts/{script_name}/tails/{id}`)

The worker handles errors gracefully and ensures that the tail is deleted even if an error occurs. The code uses TypeScript comments for type checking and follows the modern Cloudflare Workers syntax with `export default { fetch }`.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/janwilmake/worker-tailproxy/tree/main) <!-- for easy deployment, ensure to add this into the readme of the created project -->

Limitations: since this worker waits for the entire response body to be processed, apis that normally stream will be slower, and apis that have large throughput (over ±40mb) won't work. This could potentially be solved using a [Trailer](https://reader.llmtext.com/md/developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Trailer)

# FAQ

| Summary | Prompt it |
|---------|-----------|
| Overview of worker-tailproxy and its functionality | [![](https://b.lmpify.com/overview)](https://lmpify.com?q=https%3A%2F%2Fuuithub.com%2Fjanwilmake%2Fworker-tailproxy%2Ftree%2Fmain%3FpathPatterns%3DREADME.md%0A%0AWhat%20is%20worker-tailproxy%20and%20what%20problem%20does%20it%20solve%3F%20How%20does%20it%20work%20at%20a%20high%20level%3F) |
| Core implementation of the worker-tailproxy functionality | [![](https://b.lmpify.com/implementation)](https://lmpify.com?q=https%3A%2F%2Fuuithub.com%2Fjanwilmake%2Fworker-tailproxy%2Ftree%2Fmain%3FpathPatterns%3Dmain.js%0A%0AExplain%20how%20worker-tailproxy%20works%20in%20detail.%20How%20does%20it%20handle%20the%20CloudFlare%20Tail%20API%20to%20collect%20logs%20during%20requests%3F) |
| How to use worker-tailproxy in practice | [![](https://b.lmpify.com/usage)](https://lmpify.com?q=https%3A%2F%2Fuuithub.com%2Fjanwilmake%2Fworker-tailproxy%2Ftree%2Fmain%3FpathPatterns%3DREADME.md%26pathPatterns%3Dmain.js%0A%0AHow%20do%20I%20use%20worker-tailproxy%20with%20my%20own%20Cloudflare%20Workers%3F%20What%20headers%20do%20I%20need%20to%20include%20in%20my%20requests%3F) |
| User interface for the worker-tailproxy | [![](https://b.lmpify.com/ui)](https://lmpify.com?q=https%3A%2F%2Fuuithub.com%2Fjanwilmake%2Fworker-tailproxy%2Ftree%2Fmain%3FpathPatterns%3Dindex.html%0A%0AHow%20does%20the%20UI%20for%20worker-tailproxy%20work%3F%20How%20can%20I%20use%20it%20to%20test%20my%20Workers%20and%20view%20logs%3F) |
| Deployment instructions and configuration | [![](https://b.lmpify.com/deploy)](https://lmpify.com?q=https%3A%2F%2Fuuithub.com%2Fjanwilmake%2Fworker-tailproxy%2Ftree%2Fmain%3FpathPatterns%3Dwrangler.toml%26pathPatterns%3DREADME.md%0A%0AHow%20do%20I%20deploy%20worker-tailproxy%20to%20my%20Cloudflare%20account%3F) |

# Usage


To use this worker, you need to make a request with the required headers:

```bash
curl -X POST "https://worker-tailproxy.[your-worker-subdomain].workers.dev/" \
  -H "x-script: target-worker-name" \
  -H "x-origin: https://target-worker.[your-worker-subdomain].workers.dev" \
  -H "x-account-id: your-cloudflare-account-id" \
  -H "x-cloudflare-authorization: Bearer your-cloudflare-api-token" \
  -H "Content-Type: application/json" \
  -d '{"example": "payload"}'
```

The API token needs to have the "Workers Tail" permission for the specified account. The response will include all logs collected during the request in the `x-tail` header.

# UI

[![](https://b.lmpify.com/Making_A_UI)](https://lmpify.com/httpsuithubcomj-wwbl3d0)

TODO:

- Create authenticated cors-proxy (useful for anything)
- Test UI and make it work, getting logs for requests to any worker, anywhere
- Discuss OTEL (node, extra complexity)
- Need for tracing in service bindings too? https://lmpify.com/httpsuithubcomj-x6fpv60 also, check Durable Object logging support with the tail api.