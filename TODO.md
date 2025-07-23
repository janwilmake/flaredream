# Try building with wrangler

When adding things like `durable-worker` it's important to offer a way to use it with wrangler so things can be wrangler-compatible. Do I put it in a build-step and expose this code, or does it become part of the 'flaredream runtime'?

Let's try and see how other build tools work with wrangler workers, do they all use a build script in package.json? If so, does that mean I just need to be able to run these scripts to support it all? If that's the case, how hard is that or what are workarounds?

# Flaredream build

Converting Flaredream config to build-files could be a build-step that anyone can run locally! This would make it great.

`flaredream build` could be the next cli you can add to make things wrangler compatible

It could be default for flaredream, but for wrangler you can add it as build script.

Also the build-step could just change imports to add `.js` - otherwise wrangler won't be able to deploy it. I can also request wrangler to support including extensionless files (if that ends up being the problem)

Also, I can imagine using https://www.npmjs.com/package/ts-to-jsdoc (although ts should generally be discouraged for 1:1 equality between code-generation and production runtime logs, without any additional complexity)

It must be utlizing an API that goes from FormData-stream --> FormData-stream! This way, it can be used from within the flaredream deploy API as well!

# Make the tailproxy work!!!

- ❌ Why doesn't this work yet? Is it permissions?
- What else can I make to make this more user friendly? I wanna be able to manually test in this way in the browser, and see logs somehow. In a header is great, but what if a script can be injected into each html output that has a sw.js that observes all requests and adds tail logs? This could potentially be very insightful.

# MCP

The deployment API also functions as MCP and should be first made possible from letmeprompt.com
