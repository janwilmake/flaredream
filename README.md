# Flaredream - Wrangler-compatible Cloudflare Deployments API

Flaredream Deploy is a (free) API-version of `wrangler deploy` that runs directly on a worker. This API is fully stateless, there's no need to spawn a container or durable objects.

The main limitations right now are:

- Building/bundling (jsx, node_modules)
- Environments and env vars
- Routes (custom_domain:false)

Here's a comprehensive comparison:

| Feature                              | Wrangler Deploy | Flaredream Deploy | Notes                             |
| ------------------------------------ | --------------- | ----------------- | --------------------------------- |
| **Worker Types & Build System**      |                 |                   | Need to provide ESM JS            |
| Service Workers (Traditional format) | ✅              | ✅                | addEventListener syntax           |
| ES Modules (Modern format)           | ✅              | ✅                | export default syntax             |
| Durable Objects                      | ✅              | ✅                |                                   |
| Building/Bundling (esbuild)          | ✅              | ❌                | Handles TypeScript, JSX, imports  |
| Node modules support                 | ✅              | ❌                | Resolves and bundles dependencies |
| **Configuration**                    |
| wrangler.toml parsing                | ✅              | ✅                |                                   |
| Compatibility dates/flags            | ✅              | ✅                |                                   |
| Static assets                        | ✅              | ✅                | Up to 40MB                        |
| KV, R2, D1, Queues, Service Bindings | ✅              | ✅                | Parsed from wrangler.toml         |
| Custom domains                       | ✅              | ✅                | Only `custom_domain:true`         |
| Routes (patterns)                    | ✅              | ❌                |                                   |
| Multiple environments                | ✅              | ❌                |                                   |
| Environment variables                | ✅              | ❌                |                                   |
| **Other Features**                   | ✅              | ❌                |                                   |
| Works without wrangler config        | ❌              | ✅                | Uses sensible defaults            |

## Usage

There are 2 ways to use this API:

1. Make a GET request to `https://deploy.flaredream.com/{URL}` where `{URL}` is a URL that returns a multipart/form-data stream.
2. Make a POST request to `https://deploy.flaredream.com/deploy` with multipart/form-data body ([example](https://dropbox.flaredream.com))

Use HTTP Basic Authentication with your Cloudflare credentials: `Authorization: Basic {base64(accountId:apiToken)}`. Your Cloudflare Account-Owned API token needs these permissions: **Workers Scripts Edit** and **Workers Custom Domains Edit**

**Example:**

```bash
curl -u "your-account-id:your-api-token" \
  "https://deploy.flaredream.com/https://download.flaredream.com/abc123"
```

For more details on the API, see https://deploy.flaredream.com/openapi.json

# Other ways to use this API

# Flaredream CLI (this repo)

Installation:

```sh
npm i -g flaredream
```

Usage:

```sh
flaredream deploy [./file-or-folder]
```

# Flaredream Dropbox

Just upload! Check https://flaredream.com/dropbox

# Via LMPIFY

Generate static assets and/or a cloudflare worker with wrangler configuration, and click "deploy"

https://flaredream.com
