# accept `multipart/form-data`

✅ Accept `multipart/form-data` (should work from external form submissions!). Done in `script-upload.ts`. Do this first and document this in the API.

# CLI

I need to be able to allow users to use the deployment pipeline i built on their own files:

It should work on any js-only cloudflare project. Its API should be a FormData stream for this, I think. It needs easy oauth. This may also allow people to start using this in cline, cursor, etc! They can do commands, right?

The problem is that now I'm still using `wrangler` all the fucking time while I want to continuously improve my APIs, add features, and turn this into a modular framework, so start with a CLI!

When adding things like `durable-worker` it's important to offer a way to use it with wrangler so things can be wrangler-compatible. Do I put it in a build-step and expose this code, or does it become part of the 'flaredream runtime'?

# Dropbox

Create Flaredream Upload: Fancy Dropbox to serve assets on a Cloudflare Worker, easy to choose (sub)domain

- Simple Dropbox to add multiple files
- Input to fill domain name
- Exploration worker by default
- Simply redirect to deploy after all files are uploaded

# MCP

The deployment API also functions as MCP and should be first made possible from letmeprompt.com

# Landing

Let people choose and learn what they like: CLI, API, Dropbox, MCP. <-- 4 cards that all just work from there would be great.

Features:

- Cloudflare and Wrangler Compatible
- Sensible Defaults
