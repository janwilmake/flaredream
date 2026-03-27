import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../script-upload";

const BASE = "https://deploy.flaredream.com";

function basicAuth(accountId: string, apiKey: string): string {
	return "Basic " + btoa(`${accountId}:${apiKey}`);
}

describe("CORS", () => {
	it("responds to OPTIONS with correct CORS headers", async () => {
		const request = new Request(BASE + "/test", { method: "OPTIONS" });
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(204);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
		expect(response.headers.get("Access-Control-Allow-Methods")).toContain("POST");
		expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
	});
});

describe("Routing", () => {
	it("returns 404 for root path", async () => {
		const request = new Request(BASE + "/");
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(404);
	});

	it("redirects to /login when unauthenticated", async () => {
		const request = new Request(BASE + "/some-deploy-url", { redirect: "manual" });
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toContain("/login");
	});
});

describe("Authentication", () => {
	it("accepts Basic auth header", async () => {
		// POST with auth but empty body should fail with a parse error, not 302
		const request = new Request(BASE + "/test-deploy", {
			method: "POST",
			headers: {
				Authorization: basicAuth("test-account-id", "test-api-key"),
				"Content-Type": "multipart/form-data; boundary=----testboundary",
			},
			body: "------testboundary--\r\n",
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		// Should NOT be a redirect — auth was accepted, it just fails during deploy
		expect(response.status).not.toBe(302);
	});

	it("accepts cookie auth", async () => {
		const request = new Request(BASE + "/test-deploy", {
			method: "POST",
			headers: {
				Cookie: "cf_account_id=test-account-id; cf_api_key=test-api-key",
				"Content-Type": "multipart/form-data; boundary=----testboundary",
			},
			body: "------testboundary--\r\n",
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).not.toBe(302);
	});
});

describe("Deploy - file extraction", () => {
	it("rejects POST with no files", async () => {
		const formData = new FormData();
		const request = new Request(BASE + "/test-deploy", {
			method: "POST",
			headers: {
				Authorization: basicAuth("test-account-id", "test-api-key"),
			},
			body: formData,
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(500);
		const text = await response.text();
		expect(text).toContain("No files");
	});

	it("accepts a simple JS worker deployment", async () => {
		const formData = new FormData();

		const workerScript = `export default { fetch() { return new Response("hello"); } }`;
		const wranglerConfig = JSON.stringify({
			name: "test-worker",
			main: "index.js",
			compatibility_date: "2025-06-29",
		});

		formData.append(
			"index.js",
			new File([workerScript], "index.js", { type: "application/javascript" })
		);
		formData.append(
			"wrangler.json",
			new File([wranglerConfig], "wrangler.json", { type: "application/json" })
		);

		const request = new Request(BASE + "/test-deploy", {
			method: "POST",
			headers: {
				Authorization: basicAuth("test-account-id", "test-api-key"),
			},
			body: formData,
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		const text = await response.text();
		// Will fail at CF API call (fake credentials), but should get past file parsing
		expect(response.status).toBe(500);
		// Should NOT be a "No files" error — files were extracted successfully
		expect(text).not.toContain("No files");
	});
});

describe("Deploy - bundling", () => {
	it("triggers bundling when package.json has dependencies", async () => {
		const formData = new FormData();

		const workerScript = `
import { Hono } from "hono";
const app = new Hono();
app.get("/", (c) => c.text("Hello Hono!"));
export default app;
`;
		const packageJson = JSON.stringify({
			dependencies: { hono: "^4.0.0" },
		});
		const wranglerConfig = JSON.stringify({
			name: "test-bundled-worker",
			main: "index.js",
			compatibility_date: "2025-06-29",
		});

		formData.append(
			"index.js",
			new File([workerScript], "index.js", { type: "application/javascript" })
		);
		formData.append(
			"package.json",
			new File([packageJson], "package.json", { type: "application/json" })
		);
		formData.append(
			"wrangler.json",
			new File([wranglerConfig], "wrangler.json", { type: "application/json" })
		);

		const request = new Request(BASE + "/test-deploy", {
			method: "POST",
			headers: {
				Authorization: basicAuth("test-account-id", "test-api-key"),
			},
			body: formData,
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		const text = await response.text();
		// Bundling should succeed — the error should be from CF API (bad credentials),
		// not from missing files or bundling failure
		expect(text).not.toContain("No files");
		expect(text).not.toContain("Bundle");
	});

	it("triggers bundling for TypeScript entry point", async () => {
		const formData = new FormData();

		const workerScript = `
const greeting: string = "Hello from TypeScript!";
export default {
  fetch(request: Request): Response {
    return new Response(greeting);
  }
};
`;
		const wranglerConfig = JSON.stringify({
			name: "test-ts-worker",
			main: "index.ts",
			compatibility_date: "2025-06-29",
		});

		formData.append(
			"index.ts",
			new File([workerScript], "index.ts", { type: "text/plain" })
		);
		formData.append(
			"wrangler.json",
			new File([wranglerConfig], "wrangler.json", { type: "application/json" })
		);

		const request = new Request(BASE + "/test-deploy", {
			method: "POST",
			headers: {
				Authorization: basicAuth("test-account-id", "test-api-key"),
			},
			body: formData,
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		const text = await response.text();
		// Should get past bundling — error should be CF API related
		expect(text).not.toContain("No files");
	});

	it("skips bundling for plain JS without dependencies", async () => {
		const formData = new FormData();

		const workerScript = `export default { fetch() { return new Response("plain js"); } }`;
		const wranglerConfig = JSON.stringify({
			name: "test-plain-worker",
			main: "index.js",
			compatibility_date: "2025-06-29",
		});

		formData.append(
			"index.js",
			new File([workerScript], "index.js", { type: "application/javascript" })
		);
		formData.append(
			"wrangler.json",
			new File([wranglerConfig], "wrangler.json", { type: "application/json" })
		);

		const request = new Request(BASE + "/test-deploy", {
			method: "POST",
			headers: {
				Authorization: basicAuth("test-account-id", "test-api-key"),
			},
			body: formData,
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		const text = await response.text();
		// Should proceed directly to CF API — no bundling step
		expect(text).not.toContain("No files");
		expect(text).not.toContain("Bundle");
	});
});

describe("Deploy - config parsing", () => {
	it("uses wrangler.json when present", async () => {
		const formData = new FormData();

		const workerScript = `export default { fetch() { return new Response("test"); } }`;
		const wranglerConfig = JSON.stringify({
			name: "my-custom-name",
			main: "index.js",
			compatibility_date: "2025-06-29",
		});

		formData.append(
			"index.js",
			new File([workerScript], "index.js", { type: "application/javascript" })
		);
		formData.append(
			"wrangler.json",
			new File([wranglerConfig], "wrangler.json", { type: "application/json" })
		);

		const request = new Request(BASE + "/test-deploy", {
			method: "POST",
			headers: {
				Authorization: basicAuth("test-account-id", "test-api-key"),
				Accept: "application/json",
			},
			body: formData,
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		const text = await response.text();
		// The error will mention the script name from config in the CF API URL
		expect(text).toContain("my-custom-name");
	});

	it("generates default config when no wrangler config present", async () => {
		const formData = new FormData();

		const htmlFile = `<html><body>Hello</body></html>`;

		formData.append(
			"index.html",
			new File([htmlFile], "index.html", { type: "text/html" })
		);

		const request = new Request(BASE + "/test-deploy", {
			method: "POST",
			headers: {
				Authorization: basicAuth("test-account-id", "test-api-key"),
			},
			body: formData,
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		const text = await response.text();
		// Should use auto-generated name with __flaredream- prefix
		expect(text).toContain("__flaredream-");
	});
});

describe("Deploy - module transforms", () => {
	it("handles JSON, TOML, YAML imports alongside JS", async () => {
		const formData = new FormData();

		const workerScript = `
import config from "./config.json";
import data from "./data.toml";
export default { fetch() { return new Response(JSON.stringify({ config, data })); } }
`;
		const jsonConfig = JSON.stringify({ key: "value" });
		const tomlConfig = `name = "test"\nversion = 1`;
		const wranglerConfig = JSON.stringify({
			name: "test-transforms",
			main: "index.js",
			compatibility_date: "2025-06-29",
		});

		formData.append("index.js", new File([workerScript], "index.js"));
		formData.append("config.json", new File([jsonConfig], "config.json"));
		formData.append("data.toml", new File([tomlConfig], "data.toml"));
		formData.append("wrangler.json", new File([wranglerConfig], "wrangler.json"));

		const request = new Request(BASE + "/test-deploy", {
			method: "POST",
			headers: {
				Authorization: basicAuth("test-account-id", "test-api-key"),
			},
			body: formData,
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		const text = await response.text();
		// Should get past file processing without errors about transforms
		expect(text).not.toContain("No files");
		expect(text).not.toContain("parse");
	});
});
