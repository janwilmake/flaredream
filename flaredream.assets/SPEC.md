https://uithub.com/janwilmake/gists/tree/main/named-codeblocks.md
https://pastebin.contextarea.com/HgMlftV.md
https://developers.cloudflare.com/workers/static-assets/direct-upload/index.md

Can you create a cloudflare worker (hosted at upload.flaredream.com) that takes:

- GET /{url} being a url that returns a file object JSON
- basic auth with username being cloudflare account id and password being cloudflare api key
- if no auth, returns www-authenticate header to get it

Just like the example, it must first determine which files are needed to be uploaded;

- find wrangler.json|toml|jsonc
- parse assets.directory
- if no wrangler file found, assume root to be required for upload with default assetsignore
- find all assetsignore files and flatten them
- apply assets ignore to know which final assets to upload

It fans out by calling /upload for each bucket in parallel. it should use a cloudflare DO for this instead of upstash (the DO immediately should say respond 'started' and then perform the bucket upload. it has a GET /longpoll endpoint that returns success or not after complete) It returns the same `Promise<Response>` as the original request. the main function would first request all bucket uploads in DOs, then poll all of them in parallel. DO uses the cloudflare api to upload the assets.

DO Namespace must be named AssetUploader just like the class (PascalCase) also in Env { AssetUploader: DurableObjectNamespace }

give this to me in a cloudflare typescript worker and openapi.json. use no dependencies and a single file main.ts
