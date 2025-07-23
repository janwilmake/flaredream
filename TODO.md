# Make the tailproxy work!!!

- ❌ Why doesn't this work yet? Is it permissions?
- What else can I make to make this more user friendly? I wanna be able to manually test in this way in the browser, and see logs somehow. In a header is great, but what if a script can be injected into each html output that has a sw.js that observes all requests and adds tail logs? This could potentially be very insightful.

# Test dependencies via direct import without extension

See https://letmeprompt.com/rules-httpsuithu-u8dywy0

It seems even in the cloudflare dashboard, if I add a file without extension (.js) it won't find it and I get the error 'Uncaught Error: No such module "json5".'. The same happens when running `wrangler deploy --no-bundle`. This causes it to be impossible to use node_module imports because this is not a part of the runtime.

Claude says it should work but with both strategies it doesn't so far

Let's see if I can make it work via my own deployment solution. Will it find the file? Do I need an additional rule somewhere to allow for files without extension? or is that only needed for dashboard editor / wrangler? or maybe, these extensionless files need to be addeed with the right content-type?

If dependencies can work without syntax change and also without bundle, it's a great great advantage. I could now add in a bundle for every absolute dependency automatically. This won't support tree-splitting yet, although it also could with an extra step!

# Try building with wrangler

When adding things like `durable-worker` it's important to offer a way to use it with wrangler so things can be wrangler-compatible. Do I put it in a build-step and expose this code, or does it become part of the 'flaredream runtime'?

Let's try and see how other build tools work with wrangler workers, do they all use a build script in package.json? If so, does that mean I just need to be able to run these scripts to support it all? If that's the case, how hard is that or what are workarounds?

# Flaredream build

Converting Flaredream config to build-files could be a build-step that anyone can run locally! This would make it great.

`flaredream build` could be the next cli you can add to make things wrangler compatible

It could be default for flaredream but for wrangler you can add it as build script.

Also the build-step could just change imports to add `.js` - otherwise wrangler won't be able to deploy it. I can also request wrangler to support including extensionless files (if that ends up being the problem)

Also, I can imagine using https://www.npmjs.com/package/ts-to-jsdoc (although ts should generally be discouraged for 1:1 equality between code-generation and production runtime logs, without any additional complexity)

# MCP

The deployment API also functions as MCP and should be first made possible from letmeprompt.com
