#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { createServer } = require("http");
const { spawn } = require("child_process");
const os = require("os");

const CONFIG_FILE = path.join(os.homedir(), ".flaredream-config.json");
const FLAREDREAM_API = "https://deploy.flaredream.com";
const AUTH_SERVICE = "https://cloudflare.simplerauth.com";

// Orange color ANSI code
const ORANGE = "\x1b[38;5;214m";
const RESET = "\x1b[0m";

function showLogo() {
  const logo = `${ORANGE}
███████╗██╗      █████╗ ██████╗ ███████╗
██╔════╝██║     ██╔══██╗██╔══██╗██╔════╝
█████╗  ██║     ███████║██████╔╝█████╗  
██╔══╝  ██║     ██╔══██║██╔══██╗██╔══╝  
██║     ███████╗██║  ██║██║  ██║███████╗
╚═╝     ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝

██████╗ ██████╗ ███████╗ █████╗ ███╗   ███╗
██╔══██╗██╔══██╗██╔════╝██╔══██╗████╗ ████║
██║  ██║██████╔╝█████╗  ███████║██╔████╔██║
██║  ██║██╔══██╗██╔══╝  ██╔══██║██║╚██╔╝██║
██████╔╝██║  ██║███████╗██║  ██║██║ ╚═╝ ██║
╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝
${RESET}`;
  console.log(logo);
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    }
  } catch (error) {
    console.error("Error loading config:", error.message);
  }
  return {};
}

function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error("Error saving config:", error.message);
  }
}

function generateRandomState() {
  return (
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15)
  );
}

function openBrowser(url) {
  const platform = os.platform();
  let command;

  if (platform === "darwin") {
    command = "open";
  } else if (platform === "win32") {
    command = "start";
  } else {
    command = "xdg-open";
  }

  spawn(command, [url], { detached: true, stdio: "ignore" });
}

async function authenticate() {
  return new Promise((resolve, reject) => {
    const state = generateRandomState();
    const redirectUri = "http://localhost:3000/callback";
    const authUrl = new URL(`${AUTH_SERVICE}/authorize`);

    authUrl.searchParams.set("client_id", "localhost");
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set(
      "message",
      "Deploy your applications to Cloudflare Workers"
    );

    const server = createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:3000`);

      if (url.pathname === "/callback") {
        const code = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state");

        if (returnedState !== state) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end("<h1>Error: Invalid state parameter</h1>");
          server.close();
          reject(new Error("Invalid state parameter"));
          return;
        }

        if (!code) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end("<h1>Error: No authorization code received</h1>");
          server.close();
          reject(new Error("No authorization code received"));
          return;
        }

        try {
          const tokenResponse = await fetch(`${AUTH_SERVICE}/token`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              grant_type: "authorization_code",
              code,
              client_id: "localhost",
              redirect_uri: redirectUri,
            }),
          });

          if (!tokenResponse.ok) {
            throw new Error(`Token exchange failed: ${tokenResponse.status}`);
          }

          const tokenData = await tokenResponse.json();

          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`
            <h1>Authentication Successful!</h1>
            <p>You can now close this window and return to your terminal.</p>
            <script>setTimeout(() => window.close(), 3000);</script>
          `);

          server.close();
          resolve({
            accountId: tokenData.cloudflare_account_id,
            apiKey: tokenData.cloudflare_api_key,
          });
        } catch (error) {
          res.writeHead(500, { "Content-Type": "text/html" });
          res.end(`<h1>Error: ${error.message}</h1>`);
          server.close();
          reject(error);
        }
      } else {
        res.writeHead(404, { "Content-Type": "text/html" });
        res.end("<h1>Not Found</h1>");
      }
    });

    server.listen(3000, () => {
      console.log("Opening browser for authentication...");
      console.log(
        `If the browser doesn't open automatically, visit: ${authUrl.toString()}`
      );
      openBrowser(authUrl.toString());
    });

    server.on("error", (error) => {
      reject(error);
    });
  });
}

function isDirectory(filePath) {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function getAllFiles(dirPath, baseDir = dirPath) {
  const files = [];
  const items = fs.readdirSync(dirPath);

  for (const item of items) {
    const fullPath = path.join(dirPath, item);
    const relativePath = path.relative(baseDir, fullPath);

    // Skip hidden files and common build directories
    if (
      item.startsWith(".") ||
      item === "node_modules" ||
      item === "dist" ||
      item === "build"
    ) {
      continue;
    }

    if (isDirectory(fullPath)) {
      files.push(...getAllFiles(fullPath, baseDir));
    } else if (isFile(fullPath)) {
      files.push({
        path: relativePath.replace(/\\/g, "/"), // Normalize path separators
        fullPath: fullPath,
      });
    }
  }

  return files;
}

function isBinaryFile(filePath) {
  const binaryExtensions = [
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".ico",
    ".svg",
    ".pdf",
    ".zip",
    ".tar",
    ".gz",
    ".rar",
    ".7z",
    ".mp3",
    ".mp4",
    ".avi",
    ".mov",
    ".wmv",
    ".exe",
    ".dll",
    ".so",
    ".dylib",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
    ".bin",
    ".dat",
  ];

  const ext = path.extname(filePath).toLowerCase();
  return binaryExtensions.includes(ext);
}

/**
 * @param {string} filePath
 * @returns {string}
 */
const getContentType = (filePath) => {
  // Extract extension from file path
  const lastDotIndex = filePath.lastIndexOf(".");
  if (lastDotIndex === -1) {
    return "text/plain"; // No extension found
  }

  const extension = filePath.slice(lastDotIndex + 1).toLowerCase();

  // Extension to MIME type mapping
  const mimeTypes = {
    // Text files
    txt: "text/plain",
    md: "text/markdown",
    markdown: "text/markdown",
    rtf: "application/rtf",

    // Web files
    html: "text/html",
    htm: "text/html",
    css: "text/css",
    js: "text/javascript",
    mjs: "text/javascript",
    jsx: "text/javascript",
    ts: "text/typescript",
    tsx: "text/typescript",
    json: "application/json",
    jsonc: "application/json",
    xml: "application/xml",
    xhtml: "application/xhtml+xml",
    svg: "image/svg+xml",

    // Programming languages
    py: "text/x-python",
    pyw: "text/x-python",
    rb: "text/x-ruby",
    php: "text/x-php",
    java: "text/x-java-source",
    c: "text/x-c",
    cpp: "text/x-c++",
    cxx: "text/x-c++",
    cc: "text/x-c++",
    h: "text/x-c",
    hpp: "text/x-c++",
    cs: "text/x-csharp",
    go: "text/x-go",
    rs: "text/x-rust",
    kt: "text/x-kotlin",
    swift: "text/x-swift",
    scala: "text/x-scala",
    r: "text/x-r",
    pl: "text/x-perl",
    lua: "text/x-lua",
    dart: "text/x-dart",
    elm: "text/x-elm",
    clj: "text/x-clojure",
    fs: "text/x-fsharp",
    ml: "text/x-ocaml",
    hs: "text/x-haskell",
    ex: "text/x-elixir",
    exs: "text/x-elixir",
    erl: "text/x-erlang",
    nim: "text/x-nim",
    jl: "text/x-julia",
    zig: "text/x-zig",

    // Shell scripts
    sh: "text/x-shellscript",
    bash: "text/x-shellscript",
    zsh: "text/x-shellscript",
    fish: "text/x-shellscript",
    bat: "text/x-msdos-batch",
    cmd: "text/x-msdos-batch",
    ps1: "text/x-powershell",
    psm1: "text/x-powershell",

    // Configuration files
    toml: "text/x-toml",
    yaml: "text/yaml",
    yml: "text/yaml",
    ini: "text/x-ini",
    cfg: "text/x-ini",
    conf: "text/x-ini",
    properties: "text/x-java-properties",
    env: "text/plain",
    gitignore: "text/plain",
    dockerignore: "text/plain",
    editorconfig: "text/plain",

    // Data files
    csv: "text/csv",
    tsv: "text/tab-separated-values",
    sql: "text/x-sql",
    graphql: "application/graphql",
    gql: "application/graphql",

    // Images
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
    bmp: "image/bmp",
    ico: "image/vnd.microsoft.icon",
    tiff: "image/tiff",
    tif: "image/tiff",

    // Audio
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    flac: "audio/flac",
    aac: "audio/aac",
    weba: "audio/webm",
    m4a: "audio/mp4",

    // Video
    mp4: "video/mp4",
    webm: "video/webm",
    avi: "video/x-msvideo",
    mov: "video/quicktime",
    wmv: "video/x-ms-wmv",
    flv: "video/x-flv",
    mkv: "video/x-matroska",
    "3gp": "video/3gpp",

    // Archives
    zip: "application/zip",
    rar: "application/vnd.rar",
    tar: "application/x-tar",
    gz: "application/gzip",
    bz2: "application/x-bzip2",
    xz: "application/x-xz",
    "7z": "application/x-7z-compressed",

    // Documents
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    odt: "application/vnd.oasis.opendocument.text",
    ods: "application/vnd.oasis.opendocument.spreadsheet",
    odp: "application/vnd.oasis.opendocument.presentation",

    // Fonts
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    otf: "font/otf",
    eot: "application/vnd.ms-fontobject",

    // Application files
    wasm: "application/wasm",
    exe: "application/vnd.microsoft.portable-executable",
    dmg: "application/x-apple-diskimage",
    deb: "application/vnd.debian.binary-package",
    rpm: "application/x-redhat-package-manager",
    apk: "application/vnd.android.package-archive",
    jar: "application/java-archive",
    war: "application/java-archive",
    ear: "application/java-archive",

    // Special files
    lock: "text/plain",
    log: "text/plain",
    dockerfile: "text/plain",
    makefile: "text/x-makefile",
    cmake: "text/x-cmake",
    gradle: "text/x-gradle",
    pom: "application/xml",
    gemfile: "text/x-ruby",
    podfile: "text/x-ruby",
    cartfile: "text/plain",
    brewfile: "text/x-ruby",
    vagrantfile: "text/x-ruby",
    rakefile: "text/x-ruby",
    package: "application/json",
    pubspec: "text/yaml",
    cargo: "text/x-toml",
    mod: "text/x-go",
    sum: "text/plain",
    requirements: "text/plain",
    pipfile: "text/x-toml",
    setup: "text/x-python",
    pyproject: "text/x-toml",
    composer: "application/json",
    sln: "text/plain",
    csproj: "application/xml",
    vbproj: "application/xml",
    fsproj: "application/xml",
    vcxproj: "application/xml",
    xcodeproj: "text/plain",
    pbxproj: "text/plain",
    workspace: "text/plain",
    xcworkspace: "text/plain",
    iml: "application/xml",
    pro: "text/plain",
    pri: "text/plain",
    qrc: "application/xml",
    ui: "application/xml",
    rc: "text/plain",
  };

  return mimeTypes[extension] || "application/octet-stream";
};
async function createFormData(files) {
  const boundary = `----formdata-flaredream-${Date.now()}`;
  const chunks = [];

  for (const file of files) {
    chunks.push(`--${boundary}\r\n`);
    chunks.push(
      `Content-Disposition: form-data; name="${file.path}"; filename="${file.path}"\r\n`
    );
    const contentType = getContentType(file.fullPath);
    if (isBinaryFile(file.fullPath)) {
      chunks.push(`Content-Type: ${contentType}\r\n\r\n`);
      chunks.push(fs.readFileSync(file.fullPath));
    } else {
      chunks.push(`Content-Type: ${contentType}; charset=utf-8\r\n\r\n`);
      chunks.push(fs.readFileSync(file.fullPath, "utf8"));
    }
    chunks.push(`\r\n`);
  }

  chunks.push(`--${boundary}--\r\n`);

  return {
    body: Buffer.concat(
      chunks.map((chunk) =>
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      )
    ),
    boundary,
  };
}

async function deploy(targetPath) {
  console.log("Starting deployment...");

  // Load or authenticate
  let config = loadConfig();
  if (!config.accountId || !config.apiKey) {
    console.log(
      "No authentication found. Please authenticate with Cloudflare..."
    );
    try {
      const authData = await authenticate();
      config = { ...config, ...authData };
      saveConfig(config);
      console.log("Authentication successful!");
    } catch (error) {
      console.error("Authentication failed:", error.message);
      process.exit(1);
    }
  }

  // Determine what to deploy
  let deployPath = process.cwd();
  if (targetPath) {
    deployPath = path.resolve(targetPath);
    if (!fs.existsSync(deployPath)) {
      console.error(`Path does not exist: ${deployPath}`);
      process.exit(1);
    }
  }

  console.log(`Deploying from: ${deployPath}`);

  // Collect files
  let files;
  if (isDirectory(deployPath)) {
    files = getAllFiles(deployPath);
  } else if (isFile(deployPath)) {
    files = [
      {
        path: path.basename(deployPath),
        fullPath: deployPath,
      },
    ];
  } else {
    console.error(`Invalid path: ${deployPath}`);
    process.exit(1);
  }

  if (files.length === 0) {
    console.error("No files found to deploy");
    process.exit(1);
  }

  console.log(`Found ${files.length} files to deploy`);

  // Create form data
  console.log("Preparing upload...");
  const { body, boundary } = await createFormData(files);

  // Make deployment request
  const url = new URL(`${FLAREDREAM_API}/deploy`);

  console.log("Uploading to Flaredream...");

  try {
    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        Authorization: `Basic ${Buffer.from(
          `${config.accountId}:${config.apiKey}`
        ).toString("base64")}`,
      },
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Deployment failed (${response.status}): ${errorText}`);
    }

    const result = await response.text();
    console.log("\n🎉 Deployment successful!");
    console.log(result);
  } catch (error) {
    console.error("Deployment failed:", error.message);
    process.exit(1);
  }
}

function showHelp() {
  console.log(`
Usage: flaredream deploy [path]

Commands:
  deploy [path]    Deploy files to Cloudflare Workers
                   If no path is specified, deploys current directory
                   Path can be a file or directory

Examples:
  flaredream deploy            # Deploy current directory
  flaredream deploy ./dist     # Deploy dist folder
  flaredream deploy index.js   # Deploy single file

Options:
  -h, --help       Show this help message
`);
}

function main() {
  showLogo();

  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    showHelp();
    return;
  }

  const command = args[0];

  if (command === "deploy") {
    const targetPath = args[1];
    deploy(targetPath);
  } else {
    console.error(`Unknown command: ${command}`);
    showHelp();
    process.exit(1);
  }
}

main();
