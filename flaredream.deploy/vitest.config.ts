import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: "./wrangler.json" },
			miniflare: {
				compatibilityFlags: ["nodejs_compat"],
				workers: [
					{
						name: "flaredream-download",
						modules: true,
						script: `export default { fetch() { return new Response("mock download", { status: 200 }) } }`,
					},
					{
						name: "flaredream-upload",
						modules: true,
						script: `export default { fetch() { return new Response(JSON.stringify({ success: true, jwt: null, message: "mock" }), { headers: { "Content-Type": "application/json" } }) } }`,
					},
				],
			},
		}),
	],
	resolve: {
		alias: {
			// xregexp ships CJS in lib/ but ESM in src/ — force ESM for Workers runtime
			xregexp: "xregexp/src/index.js",
		},
	},
});
