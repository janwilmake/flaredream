# Dependencies and Build

MAYBE, we'd wanna add the ability to have dependencies (`node_modules`) and typescript builds. They should be automatically installed. I have stuff for this. https://npmjz.com or maybe https://github.com/janwilmake/uit

`esbuild --bundle src/script-upload.ts --outdir=build --format=esm`

This DOES create a single-file bundle.

# `durable-worker` entrypoint

- Added `getBuild` function into script upload at the right place
- Every deployment should be able to configure an alternate entrypoint, and exported durable objects need to be passed on!

# Flaredream build

When adding things like `durable-worker` it's important to offer a way to use it with wrangler so things can be wrangler-compatible. Do I put it in a build-step and expose this code, or does it become part of the 'flaredream runtime'?

Converting Flaredream config to build-files could be a build-step that anyone can run locally! This would make it great.

`flaredream build` could be the next cli you can add to make things wrangler compatible

It could be default for flaredream, but for wrangler you can add it as build script.

Also the build-step could just change imports to add `.js` - otherwise wrangler won't be able to deploy it. I can also request wrangler to support including extensionless files (if that ends up being the problem)

Also, I can imagine using https://www.npmjs.com/package/ts-to-jsdoc (although ts should generally be discouraged for 1:1 equality between code-generation and production runtime logs, without any additional complexity)

It must be utlizing an API that goes from FormData-stream --> FormData-stream! This way, it can be used from within the flaredream deploy API as well!

# What should be part of building?

- get `package.json`, `package-lock.json` to find package versions (if not present, use latest regular versions for required modules)
- in all `.js` files, look for `import xxx from "module"` and `export xxx from "module"`. Get all needed names for each module
- create a bundle for each module for each version needed, but only for the needed names.
- add every bundle in every folder where it was imported

^ The main reason I want this is so the final source-code isn't just a single file and there aren't any stupid mappings

Another option would be to **allow import maps**. This would allow placing these modules in more convenient places (and it would allow to just use node_modules directly).

https://x.com/janwilmake/status/1948107506162802706
