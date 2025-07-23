# accept `multipart/form-data` (2025-07-21)

✅ Accept `multipart/form-data` (should work from external form submissions!). Done in `script-upload.ts`. Do this first and document this in the API.

# CLI (2025-07-21)

✅ I need to be able to allow users to use the deployment pipeline i built on their own files:

✅ It should work on any js-only cloudflare project. Its API should be a FormData stream for this, I think. It needs easy oauth. This may also allow people to start using this in cline, cursor, etc! They can do commands, right?

✅ The problem is that now I'm still using `wrangler` all the fucking time while I want to continuously improve my APIs, add features, and turn this into a modular framework, so start with a CLI!

# Dropbox (2025-07-21)

✅ Create Flaredream Upload: Fancy Dropbox to serve assets on a Cloudflare Worker, easy to choose (sub)domain

- ✅ Simple Dropbox to add multiple files
- ✅ Input to fill domain name
- ✅ Simply redirect to deploy after all files are uploaded

# Fixing Deploy Submission (2025-07-23)

✅ Form submission to https://dropbox.flaredream.com is standard HTML `multipart/form-data`. Now gets error. Ensure this just works! Maybe, new version fucked it up and previously was fine? https://github.com/janwilmake/flaredream.assets/tree/ed4c76f0464e31c87dc3eadca5f30b00abd921aa.

❌ I should just OSS this? Or only show how easy it is to use the API.

✅ If the files uploaded all have the same root folder, omit that first segment, since it depends on the client implementation whether or not this will be added.

# CLI (2025-07-23)

✅ Available as `npm i -g flaredream`

✅ Personal goal: Can I now deploy everything with 'flaredream deploy' instead of 'wrangler deploy'?

# Dropbox (2025-07-23)

✅ Available and functional at https://dropbox.flareadream.com
