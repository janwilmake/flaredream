# Limitations

- No build system. No dependencies, no typescript. Big deal or can we work around it?
- No github deployment. How to actually sync it with my workflow if its not on github?
- No editor. Is this really feasible?

# Module Worker Syntax, front and back.

- im using module worker syntax, which is directly supported and has import/export and other modern ES6 stuff: https://letmeprompt.com/httpsuithubcomj-y3kohr0
- key difference is module resolving; this syntax resolves only exactly, no node_modules stuff
- could be possible to share between frontend and backend using `_redirects`: https://letmeprompt.com/previous-prompt-ht-ss1s630
- im probably better off just supporting bundling if i wanna use this myself a lot, but for that i'd also need agents, because i will now have 2 layers of errors. in the end, js-only will be simpler and better, and maybe I can still do most of my work in vscode anyway, just some things via the other flow and push to github. in the end, we need to keep things simple to allow this to be unique and potentially the first SPEC driven app builder.

| Feature       | Cursor, Windsurf | Bolt, Lovable                            | Flaredream                                   |
| ------------- | ---------------- | ---------------------------------------- | -------------------------------------------- |
| Stack         | Any              | Typescript, React, Supabase, Astro, etc. | Only JS, CSS, HTML                           |
| Deployment    | Any              | Supabase etc                             | Cloudflare                                   |
| Prompting     | Iterative        | Iterative                                | Spec-based                                   |
| Technique     | Agentic          | Agentic                                  | Context-driven Workflows                     |
| Module system | node_modules     | node_modules                             | node_module compatible one-file JS templates |
| Types         |                  |                                          | JS with doc-comments                         |

Let's write a blog at some point about this.

# Be opinionated or make it work with everything?

There's a balance here.

I need a differentiation that addresses a need.

I also need to follow my intuition.

If I just copy others I'm going nowhere.

# Loading UX

It's doubtful if the loading ux will be useful if the worker cannot be in front, and if we can create a good UX that's clear and not confusing and completely different than how workers currently work.

It DOES create a nice potential separateion between staging and production

# What can I launch?

Probably workers in beta, html+css+js needs a little more work. Can charge good if it lets people deploy static sites to their own domains!

# node_modules

🔥 YES YES YES. extensions officially don't matter, i can assign any mimetype to formdata/multi-part file parts.
