import { getAssetManifest } from "./mod.js";

// Types
interface Env {
  FLAREDREAM_DOWNLOAD: Fetcher;
}

interface FileData {
  path: string;
  data: Uint8Array;
  contentType: string;
}

interface UploadResult {
  status: number;
  error?: string;
  jwt?: string;
}

const getContentType = (filePath: string): string => {
  // Extract extension from file path
  const lastDotIndex = filePath.lastIndexOf(".");
  if (lastDotIndex === -1) {
    return "text/plain"; // No extension found
  }

  const extension = filePath.slice(lastDotIndex + 1).toLowerCase();

  // Extension to MIME type mapping
  const mimeTypes: { [key: string]: string } = {
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

// Find file in fileData by matching hash from manifest
const findFileForHash = (
  fileData: FileData[],
  manifest: any,
  hash: string
): FileData | null => {
  // Find the path in manifest that corresponds to this hash
  const manifestPath = Object.keys(manifest).find(
    (path) => manifest[path].hash === hash
  );

  if (!manifestPath) {
    console.log("Manifest path not found for hash", hash);
    return null;
  }

  // Remove leading slash from manifest path for matching
  const cleanPath = manifestPath.startsWith("/")
    ? manifestPath.slice(1)
    : manifestPath;

  // Find the file by filename (relative path)
  const file = fileData.find((f) => {
    const cleanFilename = f.path.startsWith("/") ? f.path.slice(1) : f.path;

    return (
      cleanFilename === cleanPath ||
      f.path === manifestPath ||
      cleanFilename.endsWith(cleanPath)
    );
  });

  if (!file) {
    console.log(
      "File not found in fileData for hash",
      hash,
      "manifest path",
      manifestPath
    );
  }

  return file || null;
};

// Upload bucket function
async function uploadBucket(
  bucket: string[],
  fileData: FileData[],
  manifest: any,
  cloudflareAccountId: string,
  jwt: string,
  env: Env
): Promise<UploadResult> {
  const body = new FormData();

  for (const hash of bucket) {
    const file = findFileForHash(fileData, manifest, hash);

    if (!file) {
      console.log("FILE NOT FOUND for hash", hash);
      continue;
    }

    let content: string;
    let contentType: string;

    // Check if it's a binary file based on content type
    const detectedContentType = getContentType(file.path);
    const isBinary =
      !detectedContentType.startsWith("text/") &&
      detectedContentType !== "application/json" &&
      detectedContentType !== "application/xml" &&
      !detectedContentType.includes("javascript") &&
      !detectedContentType.includes("typescript");

    if (isBinary) {
      // Handle binary file
      contentType = file.contentType || detectedContentType;

      // Convert to binary string
      let binary = "";
      const chunkSize = 8192;
      for (let i = 0; i < file.data.length; i += chunkSize) {
        const chunk = file.data.slice(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, Array.from(chunk));
      }
      content = btoa(binary);
    } else {
      // Handle text file
      const textContent = new TextDecoder().decode(file.data);
      content = btoa(unescape(encodeURIComponent(textContent)));
      contentType = detectedContentType;
    }

    const blob = new Blob([content], { type: contentType });
    body.append(hash, blob, hash);
  }

  const uploadUrl = `https://api.cloudflare.com/client/v4/accounts/${cloudflareAccountId}/workers/assets/upload?base64=true`;

  const response = await fetch(uploadUrl, {
    method: "POST",
    body,
    headers: { Authorization: `Bearer ${jwt}` },
  });

  if (!response.ok) {
    return {
      status: response.status,
      error: await response.text(),
    };
  }

  const json: any = await response.json();
  const newJwt = json.result?.jwt as string | undefined;

  return {
    status: 200,
    jwt: newJwt,
  };
}

const getFiles = async (
  request: Request,
  env: Env
): Promise<{
  files?: FileData[];
  scriptName?: string;
  error?: string;
  status?: number;
}> => {
  if (!["GET", "POST"].includes(request.method)) {
    return {
      error: "Method not allowed. Only GET and POST are allowed",
      status: 405,
    };
  }

  const url = new URL(request.url);
  const scriptName = url.pathname.slice(1).split("/")[0];

  if (request.method === "GET") {
    const targetUrl = url.pathname.slice(scriptName.length + 2);

    if (!targetUrl) {
      return { error: "URL parameter required", status: 400 };
    }

    let decodedUrl: string;
    try {
      decodedUrl = decodeURIComponent(targetUrl);
    } catch {
      return { status: 400, error: "Invalid url encoding" };
    }

    try {
      // Fetch the files object
      let filesResponse: Response;
      if (new URL(decodedUrl).hostname === "download.flaredream.com") {
        filesResponse = await env.FLAREDREAM_DOWNLOAD.fetch(decodedUrl, {
          headers: { accept: "multipart/form-data" },
        });
      } else {
        filesResponse = await fetch(decodedUrl, {
          headers: { accept: "multipart/form-data" },
        });
      }

      if (!filesResponse.ok) {
        return {
          status: filesResponse.status,
          error: `Failed to fetch files: ${filesResponse.statusText}`,
        };
      }

      const files = await parseMultipartResponse(filesResponse);
      return { files, scriptName };
    } catch (e) {
      return { status: 500, error: e.message };
    }
  }

  // POST Request
  try {
    const files = await parseMultipartResponse(request);
    return { files, scriptName };
  } catch (e) {
    return { status: 500, error: e.message };
  }
};

async function parseMultipartResponse(
  response: Request | Response
): Promise<FileData[]> {
  const formData = await response.formData();
  const files: FileData[] = [];
  for (const [key, value] of formData.entries()) {
    if (value instanceof File) {
      files.push({
        data: await value.bytes(),
        contentType: value.type,
        path: !value.name.startsWith("/") ? "/" + value.name : value.name,
      });
    }
  }

  const firstSegments = files.map((file) => file.path.split("/")[1]);

  const allSame = new Set(firstSegments).size === 1;
  if (allSame) {
    // omit first segment
    return files.map((file) => ({
      ...file,
      path: "/" + file.path.split("/").slice(2).join("/"),
    }));
  }
  return files;
}

// Main Worker
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    // Check for basic auth
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Basic ")) {
      return new Response("Unauthorized", {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="Cloudflare Account"',
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // Parse basic auth
    const encoded = authHeader.slice(6);
    const decoded = atob(encoded);
    const [accountId, apiKey] = decoded.split(":");

    if (!accountId || !apiKey) {
      return new Response("Invalid credentials", {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="Cloudflare Account"',
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    const { files, error, status, scriptName } = await getFiles(request, env);

    if (!files || !scriptName) {
      return new Response("Error getting files: " + error, { status });
    }

    // Generate asset manifest
    const { manifest, _headers, _redirects } = await getAssetManifest(files);

    // Create upload session with Cloudflare
    const uploadSessionResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}/assets-upload-session`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ manifest }),
      }
    );

    if (!uploadSessionResponse.ok) {
      return new Response(
        `Failed to create upload session: ${uploadSessionResponse.statusText}`,
        {
          status: uploadSessionResponse.status,
        }
      );
    }

    const uploadSessionData: { result: { buckets: string[][]; jwt: string } } =
      await uploadSessionResponse.json();
    const { jwt, buckets } = uploadSessionData.result;

    console.log({ jwt, buckets, manifest });

    if (!buckets || buckets.length === 0) {
      // All files already uploaded
      return new Response(
        JSON.stringify({
          success: true,
          message: "All assets already uploaded",
          jwt,
        }),
        {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    console.log("bucket count", buckets.length);

    // Upload all buckets sequentially
    const uploadPromises = buckets.map(async (bucket) => {
      try {
        const result = await uploadBucket(
          bucket,
          files,
          manifest,
          accountId,
          jwt,
          env
        );

        if (result.status !== 200) {
          return {
            success: false,
            error: `Upload failed for bucket`,
            result,
          };
        }

        return { success: true, result };
      } catch (error) {
        return {
          success: false,
          error: `Upload error: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        };
      }
    });

    const results = await Promise.all(uploadPromises);

    return new Response(
      JSON.stringify(
        {
          success: true,
          message: "All assets uploaded successfully",
          _headers,
          _redirects,
          results,
          jwt: results.find((x) => x.result?.jwt)?.result?.jwt,
        },
        undefined,
        2
      ),
      {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  },
};
