import type {
  ChatMessage,
  CloudflareAPIKey,
  ProjectCreateValues,
  ProjectFile,
  ProjectRecord,
  StoredUser,
} from "./types";
import {
  encodePathSegments,
  escapeAttribute,
  escapeHtml,
  formatBytes,
  safeJson,
} from "./utils";

export function renderSignedOutPage(): string {
  return renderDocument({
    title: "Flaredream App",
    body: `
      <main class="shell shell-center">
        <section class="hero-card">
          <p class="eyebrow">app.flaredream.com</p>
          <h1>One worker now handles login, keys, and your R2-backed projects.</h1>
          <p class="lede">
            Authentication and Cloudflare key management are hosted on this same domain.
            Project files are served from the <code>projects</code> R2 bucket at
            <code>/&#123;githubUsername&#125;/&#123;projectSlug&#125;/&#123;...files&#125;</code>.
          </p>
          <div class="actions">
            <a class="button button-primary" href="/login">Login with GitHub</a>
            <a class="button button-secondary" href="/manage">Manage Cloudflare keys</a>
          </div>
        </section>
      </main>
    `,
  });
}

export function renderDashboardPage(
  user: StoredUser,
  projects: ProjectRecord[],
  options: {
    createError?: string;
    createValues?: ProjectCreateValues;
  } = {},
): string {
  const values = options.createValues || { title: "", slug: "", description: "" };
  const projectCards = projects
    .map(
      (project) => `
        <article class="project-card">
          <div class="project-card-header">
            <div>
              <h2>${escapeHtml(project.title)}</h2>
              <span class="project-slug">/${escapeHtml(project.slug)}</span>
            </div>
            <div class="project-card-actions">
              <a class="button button-secondary" href="/${encodeURIComponent(project.slug)}">Open</a>
              <form method="POST" action="/projects/${encodeURIComponent(
                project.slug,
              )}/delete" onsubmit="return confirm('Delete ${escapeAttribute(
                project.slug,
              )}? This removes all project files from R2.');">
                <button class="button button-danger" type="submit">Delete</button>
              </form>
            </div>
          </div>
          <p class="project-description">${
            project.description ? escapeHtml(project.description) : "No description provided."
          }</p>
          <div class="project-meta">
            <span>${project.fileCount} files</span>
            <span>${
              project.entryFile ? `entry: ${escapeHtml(project.entryFile)}` : "no entry file"
            }</span>
          </div>
        </article>
      `,
    )
    .join("");

  return renderDocument({
    title: "Flaredream Dashboard",
    body: `
      <main class="shell">
        <header class="topbar">
          <div>
            <p class="eyebrow">Flaredream Dashboard</p>
            <h1>Your projects</h1>
          </div>
          <div class="user-pill">
            ${renderAvatar(user)}
            <div>
              <strong>${escapeHtml(user.name || user.username)}</strong>
              <span>@${escapeHtml(user.username)}</span>
            </div>
          </div>
        </header>

        <section class="stats-row">
          <div class="stat-card">
            <span class="stat-label">Projects</span>
            <strong>${projects.length}</strong>
          </div>
          <div class="stat-card">
            <span class="stat-label">Cloudflare Account</span>
            <strong>${escapeHtml(user.cloudflareAccountId || "No default key selected")}</strong>
          </div>
          <div class="stat-card">
            <span class="stat-label">Cloudflare Key</span>
            <strong>${escapeHtml(user.cloudflareKeyName || "No default key selected")}</strong>
          </div>
        </section>

        <section class="dashboard-actions">
          <details class="create-project-details" ${options.createError ? "open" : ""}>
            <summary class="button button-primary">Create Project</summary>
            <div class="create-project-form-wrap">
              ${options.createError ? `<p class="form-error">${escapeHtml(options.createError)}</p>` : ""}
              <form method="POST" action="/projects/create" class="stack-form">
                <label>
                  <span>Title</span>
                  <input name="title" type="text" required value="${escapeAttribute(
                    values.title,
                  )}" placeholder="Portfolio">
                </label>
                <label>
                  <span>Slug</span>
                  <input name="slug" type="text" value="${escapeAttribute(
                    values.slug,
                  )}" placeholder="portfolio">
                </label>
                <label>
                  <span>Description</span>
                  <textarea name="description" rows="3" placeholder="Short project description">${escapeHtml(
                    values.description,
                  )}</textarea>
                </label>
                <button class="button button-primary" type="submit">Create Project</button>
              </form>
            </div>
          </details>
          <a class="button button-secondary" href="/manage">Manage Cloudflare keys</a>
          <a class="button button-secondary" href="/logout">Log out</a>
        </section>

        <section class="grid">
          ${
            projects.length > 0
              ? projectCards
              : `<section class="empty-state">
                  <h2>No projects found yet</h2>
                  <p>Put files in <code>/${escapeHtml(
                    user.username,
                  )}/&#123;projectSlug&#125;/...</code> or create a starter project.</p>
                </section>`
          }
        </section>
      </main>
    `,
  });
}

export function renderManagePage(
  user: StoredUser,
  keys: CloudflareAPIKey[],
  error?: string,
  oauth?: {
    clientId: string;
    redirectUri: string;
    state: string | null;
    resource: string | null;
    message?: string;
    isOauthFlow: boolean;
  },
): string {
  const genericTokensUrl = "https://dash.cloudflare.com/?to=/:account/api-tokens";

  const keyItems = keys
    .map((key) => {
      const isDefault = user.defaultKeyId === key.id;
      const accountTokensUrl = `https://dash.cloudflare.com/?to=/${encodeURIComponent(
        key.accountId,
      )}/api-tokens`;
      return `
        <article class="key-card">
          <div class="key-copy">
            <h2>${escapeHtml(key.name)}</h2>
            <p>Account ${escapeHtml(key.accountId)}</p>
            <small>Added ${escapeHtml(new Date(key.createdAt).toLocaleDateString())}</small>
            <small><a class="resource-link inline-link" href="${accountTokensUrl}" target="_blank" rel="noreferrer">Open Cloudflare API tokens for this account</a></small>
          </div>
          <div class="key-actions">
            ${
              isDefault
                ? `<span class="status-pill">Default</span>`
                : `<form method="POST">
                     <input type="hidden" name="action" value="default">
                     <input type="hidden" name="keyId" value="${escapeAttribute(key.id)}">
                     <button class="button button-secondary" type="submit">Set Default</button>
                   </form>`
            }
            ${
              oauth?.isOauthFlow
                ? `<form method="POST">
                     <input type="hidden" name="action" value="select">
                     <input type="hidden" name="keyId" value="${escapeAttribute(key.id)}">
                     <button class="button button-primary" type="submit">Use This Key</button>
                   </form>`
                : ""
            }
            <form method="POST">
              <input type="hidden" name="action" value="delete">
              <input type="hidden" name="keyId" value="${escapeAttribute(key.id)}">
              <button class="button button-danger" type="submit">Delete</button>
            </form>
          </div>
        </article>
      `;
    })
    .join("");

  return renderDocument({
    title: oauth?.isOauthFlow ? "Authorize Cloudflare Access" : "Manage Cloudflare Keys",
    body: `
      <main class="shell shell-manage">
        <header class="topbar">
          <div>
            <p class="eyebrow">${
              oauth?.isOauthFlow ? "OAuth Authorization" : "Cloudflare Keys"
            }</p>
            <h1>${
              oauth?.isOauthFlow ? "Choose a Cloudflare key" : "Manage your Cloudflare keys"
            }</h1>
            <p class="lede">${
              oauth?.isOauthFlow
                ? escapeHtml(
                    oauth.message ||
                      "Select which Cloudflare API token should be returned to the requesting client.",
                  )
                : "These keys stay attached to your GitHub identity inside the app worker."
            }</p>
          </div>
          <div class="user-pill">
            ${renderAvatar(user)}
            <div>
              <strong>${escapeHtml(user.name || user.username)}</strong>
              <span>@${escapeHtml(user.username)}</span>
            </div>
          </div>
        </header>

        ${
          oauth?.isOauthFlow
            ? `<section class="oauth-details">
                 <strong>Client:</strong> ${escapeHtml(oauth.clientId)}<br>
                 <strong>Redirect URI:</strong> ${escapeHtml(oauth.redirectUri)}
               </section>`
            : ""
        }

        ${error ? `<section class="error-box">${escapeHtml(error)}</section>` : ""}

        <section class="manage-layout">
          <section class="panel">
            <div class="panel-header">
              <h2>Saved keys</h2>
              <span>${keys.length}</span>
            </div>
            <div class="keys-stack">
              ${
                keyItems ||
                `<div class="panel-empty">No keys stored yet. Add one below.</div>`
              }
            </div>
          </section>

          <section class="panel">
            <div class="panel-header">
              <h2>Add key</h2>
              <span>Validated against Cloudflare</span>
            </div>
            <div class="resource-links">
              <a class="resource-link" href="${genericTokensUrl}" target="_blank" rel="noreferrer">Open Cloudflare API tokens</a>
            </div>
            <p class="field-help">
              Token URL format: <code>${escapeHtml(genericTokensUrl)}</code>
            </p>
            <p class="field-help">
              The account ID is shown in the right sidebar of the Cloudflare dashboard.
            </p>
            <form method="POST" class="stack-form">
              <input type="hidden" name="action" value="add">
              <label>
                <span>Key name</span>
                <input name="name" type="text" required placeholder="Production account token">
              </label>
              <label>
                <span>Account ID</span>
                <input name="accountId" type="text" required placeholder="1234567890abcdef1234567890abcdef">
              </label>
              <label>
                <span>API token</span>
                <input name="apiKey" type="password" required placeholder="Cloudflare API token">
              </label>
              <button class="button button-primary" type="submit">Save key</button>
            </form>
          </section>
        </section>

        <section class="dashboard-actions">
          <a class="button button-secondary" href="/">Back to dashboard</a>
          <a class="button button-secondary" href="/logout">Log out</a>
        </section>
      </main>
    `,
  });
}

export function renderProjectPage(
  user: StoredUser,
  project: ProjectRecord,
  files: ProjectFile[],
  messages: ChatMessage[],
): string {
  const sortedFiles = [...files].sort((left, right) => left.path.localeCompare(right.path));
  const previewPath = project.entryFile
    ? `/${encodeURIComponent(project.slug)}/files/${encodePathSegments(project.entryFile)}`
    : null;
  const initialState = {
    slug: project.slug,
    files: sortedFiles,
    messages,
  };

  const sidebar = sortedFiles
    .map(
      (file) => `
        <button class="file-link" data-file-path="${escapeAttribute(file.path)}" type="button">
          <span>${escapeHtml(file.path)}</span>
          <small>${formatBytes(file.size)}</small>
        </button>
      `,
    )
    .join("");

  return renderDocument({
    title: `${project.title} · Flaredream`,
    body: `
      <main class="shell shell-project">
        <header class="project-topbar">
          <div>
            <a class="back-link" href="/">Back to dashboard</a>
            <h1>${escapeHtml(project.title)}</h1>
            <p class="project-caption">${escapeHtml(project.description || "R2-backed project view")}</p>
          </div>
          <div class="user-pill compact">
            ${renderAvatar(user)}
            <div>
              <strong>@${escapeHtml(user.username)}</strong>
              <span>${project.fileCount} files</span>
            </div>
          </div>
        </header>

        <section class="project-layout">
          <aside class="panel file-panel">
            <div class="panel-header">
              <h2>Files</h2>
              <span>${project.fileCount}</span>
            </div>
            <div class="file-list">
              ${sidebar || `<p class="panel-empty">No files in this project.</p>`}
            </div>
          </aside>

          <section class="panel preview-panel">
            <div class="panel-header">
              <h2>Preview</h2>
              <span>${escapeHtml(project.entryFile || "No entry file")}</span>
            </div>
            ${
              previewPath
                ? `<iframe class="preview-frame" src="${escapeAttribute(previewPath)}" title="Project preview"></iframe>`
                : `<div class="panel-empty">Add an <code>index.html</code> or configure <code>project.json</code> with <code>entryFile</code>.</div>`
            }
          </section>

          <section class="panel inspector-panel">
            <div class="panel-header">
              <h2>Inspector</h2>
              <span id="inspector-path">Select a file</span>
            </div>
            <pre id="inspector-content" class="code-view">Choose a text file from the list.</pre>
          </section>

          <section class="panel chat-panel">
            <div class="panel-header">
              <h2>Chat</h2>
              <span>Simple placeholder assistant</span>
            </div>
            <div id="chat-log" class="chat-log"></div>
            <form id="chat-form" class="chat-form">
              <textarea id="chat-input" name="message" rows="3" placeholder="Ask about this project"></textarea>
              <button class="button button-primary" type="submit">Send</button>
            </form>
          </section>
        </section>
      </main>
      <script>
        const initialState = ${safeJson(initialState)};
        const textExtensions = new Set(["css","html","js","json","md","svg","ts","txt","tsx","jsx","yml","yaml"]);
        const inspectorPath = document.getElementById("inspector-path");
        const inspectorContent = document.getElementById("inspector-content");
        const chatLog = document.getElementById("chat-log");
        const chatForm = document.getElementById("chat-form");
        const chatInput = document.getElementById("chat-input");

        function escapeHtml(value) {
          return value
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
        }

        function isLikelyTextFile(file) {
          const ext = file.path.includes(".") ? file.path.split(".").pop().toLowerCase() : "";
          return textExtensions.has(ext) || (file.contentType || "").startsWith("text/");
        }

        async function showFile(filePath) {
          inspectorPath.textContent = filePath;
          inspectorContent.textContent = "Loading...";
          const response = await fetch("/" + encodeURIComponent(initialState.slug) + "/files/" + filePath.split("/").map(encodeURIComponent).join("/"));
          inspectorContent.textContent = response.ok ? await response.text() : "Failed to load file.";
        }

        function renderMessages(messages) {
          chatLog.innerHTML = messages.map((message) => {
            return '<article class="chat-message chat-' + message.role + '">' +
              '<strong>' + (message.role === "assistant" ? "Assistant" : "You") + '</strong>' +
              '<p>' + escapeHtml(message.content) + '</p>' +
            '</article>';
          }).join("");
          chatLog.scrollTop = chatLog.scrollHeight;
        }

        document.querySelectorAll(".file-link").forEach((button) => {
          button.addEventListener("click", () => showFile(button.dataset.filePath));
        });

        const firstTextFile = initialState.files.find((file) => isLikelyTextFile(file));
        if (firstTextFile) {
          showFile(firstTextFile.path);
        }

        renderMessages(initialState.messages);

        chatForm.addEventListener("submit", async (event) => {
          event.preventDefault();
          const message = chatInput.value.trim();
          if (!message) return;

          chatInput.value = "";
          const optimistic = [...initialState.messages, { role: "user", content: message }];
          renderMessages(optimistic);

          const response = await fetch("/api/projects/" + encodeURIComponent(initialState.slug) + "/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message })
          });

          if (!response.ok) {
            renderMessages([...optimistic, { role: "assistant", content: "Chat request failed." }]);
            return;
          }

          const data = await response.json();
          initialState.messages = data.messages || [];
          renderMessages(initialState.messages);
        });
      </script>
    `,
  });
}

function renderAvatar(user: StoredUser): string {
  return user.avatarUrl
    ? `<img alt="" class="avatar" src="${escapeAttribute(user.avatarUrl)}">`
    : `<div class="avatar avatar-fallback">${escapeHtml(
        user.username.slice(0, 1).toUpperCase(),
      )}</div>`;
}

function renderDocument(input: { title: string; body: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(input.title)}</title>
  <style>
    :root {
      --bg: #f3ede2;
      --ink: #17120d;
      --panel: rgba(255, 252, 246, 0.86);
      --panel-border: rgba(23, 18, 13, 0.12);
      --accent: #d04c28;
      --accent-deep: #8a2f17;
      --muted: #66584a;
      --shadow: 0 24px 60px rgba(63, 39, 16, 0.16);
      --radius: 28px;
      --mono: "SFMono-Regular", Menlo, Consolas, monospace;
      --sans: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif;
      --danger: #a43b23;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      font-family: var(--sans);
      background:
        radial-gradient(circle at top left, rgba(208, 76, 40, 0.22), transparent 28%),
        radial-gradient(circle at top right, rgba(212, 153, 75, 0.18), transparent 30%),
        linear-gradient(180deg, #f8f3ea, var(--bg));
      min-height: 100vh;
    }
    a { color: inherit; text-decoration: none; }
    code, pre, textarea, input { font-family: var(--mono); }
    .shell { max-width: 1280px; margin: 0 auto; padding: 36px 20px 48px; }
    .shell-center { display: grid; min-height: 100vh; place-items: center; }
    .shell-project { max-width: 1440px; }
    .shell-manage { max-width: 1180px; }
    .hero-card, .panel, .stat-card, .project-card, .empty-state, .oauth-details, .error-box, .key-card {
      background: var(--panel);
      backdrop-filter: blur(16px);
      border: 1px solid var(--panel-border);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
    }
    .hero-card { max-width: 760px; padding: 40px; }
    .hero-card h1, .topbar h1, .project-topbar h1 { margin: 0; font-size: clamp(2.2rem, 4vw, 4rem); line-height: 0.95; letter-spacing: -0.04em; }
    .eyebrow { margin: 0 0 12px; color: var(--accent-deep); text-transform: uppercase; letter-spacing: 0.14em; font-size: 0.75rem; }
    .lede, .project-caption, .project-description, .panel-empty, .field-help { color: var(--muted); font-size: 1.05rem; line-height: 1.6; }
    .actions, .dashboard-actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 24px; align-items: flex-start; }
    .button {
      display: inline-flex; align-items: center; justify-content: center;
      padding: 12px 18px; border-radius: 999px; font-size: 0.95rem;
      border: 1px solid transparent; transition: transform 140ms ease;
      cursor: pointer; background: white;
    }
    .button:hover { transform: translateY(-1px); }
    .button-primary { background: linear-gradient(135deg, #d04c28, #ef8f39); color: white; }
    .button-secondary { background: rgba(255, 255, 255, 0.6); border-color: rgba(23, 18, 13, 0.12); }
    .button-danger { background: rgba(164, 59, 35, 0.12); color: var(--danger); border-color: rgba(164, 59, 35, 0.16); }
    .topbar, .project-topbar {
      display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 24px;
    }
    .user-pill {
      display: inline-flex; align-items: center; gap: 12px; padding: 10px 14px;
      background: rgba(255, 255, 255, 0.72); border: 1px solid rgba(23, 18, 13, 0.08); border-radius: 999px;
    }
    .user-pill span { display: block; color: var(--muted); font-size: 0.88rem; }
    .compact { align-self: center; }
    .avatar { width: 42px; height: 42px; border-radius: 50%; object-fit: cover; }
    .avatar-fallback {
      display: grid; place-items: center; background: linear-gradient(135deg, #d04c28, #ef8f39); color: white; font-weight: 700;
    }
    .stats-row { display: grid; gap: 14px; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-bottom: 20px; }
    .stat-card { padding: 20px; }
    .stat-card strong { display: block; font-size: 1.2rem; margin-top: 6px; word-break: break-word; }
    .stat-label { color: var(--muted); font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.08em; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-top: 24px; }
    .project-card, .empty-state { padding: 22px; }
    .project-card-header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
    .project-card-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .project-card h2, .panel-header h2, .key-copy h2 { margin: 0; font-size: 1.35rem; }
    .project-slug, .panel-header span, .back-link { color: var(--muted); font-size: 0.9rem; }
    .project-meta { display: flex; justify-content: space-between; gap: 12px; margin-top: 16px; color: var(--muted); font-size: 0.88rem; }
    .create-project-details summary { list-style: none; }
    .create-project-details summary::-webkit-details-marker { display: none; }
    .create-project-form-wrap {
      margin-top: 12px;
      width: min(420px, calc(100vw - 48px));
      padding: 18px;
      background: rgba(255, 255, 255, 0.72);
      border: 1px solid rgba(23, 18, 13, 0.08);
      border-radius: 24px;
      box-shadow: var(--shadow);
    }
    .form-error { margin: 0 0 12px; color: var(--danger); }
    .oauth-details, .error-box { padding: 16px 18px; margin-bottom: 18px; }
    .error-box { border-color: rgba(160, 38, 18, 0.18); background: rgba(208, 76, 40, 0.1); }
    .manage-layout { display: grid; gap: 16px; grid-template-columns: 1.1fr 0.9fr; }
    .keys-stack { display: grid; gap: 12px; }
    .key-card { padding: 18px; display: flex; justify-content: space-between; gap: 16px; }
    .key-copy p, .key-copy small { display: block; margin: 6px 0 0; color: var(--muted); }
    .key-actions { display: flex; flex-direction: column; gap: 10px; align-items: flex-end; }
    .status-pill {
      display: inline-flex; align-items: center; justify-content: center; padding: 8px 12px;
      border-radius: 999px; background: rgba(208, 76, 40, 0.14); color: var(--accent-deep); font-size: 0.82rem;
    }
    .stack-form { display: grid; gap: 12px; }
    .stack-form label { display: grid; gap: 8px; color: var(--muted); }
    .resource-links { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; }
    .resource-link {
      display: inline-flex; padding: 10px 14px; border-radius: 999px;
      background: rgba(255, 255, 255, 0.8); border: 1px solid rgba(23, 18, 13, 0.08);
    }
    .inline-link { padding: 0; border: 0; background: transparent; }
    input, textarea {
      width: 100%; border-radius: 18px; border: 1px solid rgba(23, 18, 13, 0.12);
      padding: 14px; font-size: 0.95rem; background: rgba(255, 255, 255, 0.9);
    }
    .project-layout {
      display: grid; gap: 16px;
      grid-template-columns: minmax(220px, 280px) minmax(0, 1.2fr) minmax(320px, 0.9fr);
      grid-template-areas:
        "files preview inspector"
        "files chat inspector";
    }
    .file-panel { grid-area: files; }
    .preview-panel { grid-area: preview; min-height: 420px; }
    .inspector-panel { grid-area: inspector; }
    .chat-panel { grid-area: chat; }
    .panel { padding: 18px; min-height: 220px; }
    .panel-header { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; margin-bottom: 16px; }
    .file-list { display: flex; flex-direction: column; gap: 8px; max-height: 720px; overflow: auto; }
    .file-link {
      text-align: left; width: 100%; border: 1px solid rgba(23, 18, 13, 0.08);
      background: rgba(255, 255, 255, 0.7); border-radius: 18px; padding: 12px 14px; cursor: pointer;
    }
    .file-link span, .file-link small { display: block; }
    .file-link small { margin-top: 4px; color: var(--muted); }
    .preview-frame { width: 100%; min-height: 520px; border: 1px solid rgba(23, 18, 13, 0.08); border-radius: 20px; background: white; }
    .code-view {
      margin: 0; border-radius: 20px; padding: 16px; min-height: 520px; overflow: auto;
      background: #1d1a17; color: #f5efe7; font-size: 0.88rem; line-height: 1.55; white-space: pre-wrap; word-break: break-word;
    }
    .chat-log { display: flex; flex-direction: column; gap: 10px; min-height: 220px; max-height: 340px; overflow: auto; margin-bottom: 12px; }
    .chat-message { border-radius: 18px; padding: 12px 14px; background: rgba(255, 255, 255, 0.7); border: 1px solid rgba(23, 18, 13, 0.08); }
    .chat-assistant { background: rgba(208, 76, 40, 0.08); }
    .chat-message strong { display: block; margin-bottom: 6px; }
    .chat-message p { margin: 0; color: var(--muted); white-space: pre-wrap; }
    .chat-form { display: grid; gap: 10px; }
    @media (max-width: 1080px) {
      .project-layout {
        grid-template-columns: 1fr;
        grid-template-areas: "preview" "inspector" "chat" "files";
      }
      .manage-layout, .stats-row { grid-template-columns: 1fr; }
      .key-card, .project-card-header { flex-direction: column; }
      .key-actions, .project-card-actions { align-items: stretch; justify-content: stretch; }
    }
    @media (max-width: 720px) {
      .shell { padding: 20px 14px 32px; }
      .topbar, .project-topbar { flex-direction: column; }
      .hero-card, .panel, .project-card, .stat-card, .empty-state, .oauth-details, .error-box, .key-card {
        border-radius: 22px;
      }
      .create-project-form-wrap { width: 100%; }
    }
  </style>
</head>
<body>
  ${input.body}
</body>
</html>`;
}
