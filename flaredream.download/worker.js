// Utility functions for parsing codeblocks from markdown
import { lexer } from "marked";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const pathnameWithoutExt = url.pathname.split(".")[0];
    const extension = url.pathname.split(".")[1];

    if (url.pathname === "/") {
      return new Response("Usage: /{id}[.zip|json|formdata]", { status: 404 });
    }
    try {
      // Get the markdown content (dummy implementation for now)
      const { error, result } = await getMarkdownContent(
        env,
        pathnameWithoutExt
      );

      if (error | !result) {
        return new Response("Content not found: " + error, { status: 404 });
      }

      // Extract codeblocks with path parameters
      const codeblocks = findCodeblocks(result);
      const namedCodeblocks = codeblocks.filter(
        (block) => block.parameters?.path
      );

      if (namedCodeblocks.length === 0) {
        return new Response("No named codeblocks found", { status: 400 });
      }

      // Determine output format
      let outputFormat = extension;
      if (!outputFormat) {
        const accept = request.headers.get("accept") || "";
        outputFormat = accept.includes("text/html") ? "zip" : "json";
      }

      // Process codeblocks and get file data
      const files = await processCodeblocks(namedCodeblocks);
      // Return response based on format
      switch (outputFormat) {
        case "zip":
          return createZipResponse(files);
        case "formdata":
          return createMultipartResponse(files);
        case "json":
          return createJsonResponse(files);
        default:
          return new Response("Invalid format", { status: 400 });
      }
    } catch (error) {
      console.error("Error processing request:", error);
      return new Response("Internal Server Error", { status: 500 });
    }
  },
};

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

/**
 * Recursively flatten a marked token and return something if a find function is met
 */
const flattenMarkedTokenRecursive = (token, findFunction) => {
  if (findFunction(token)) {
    return [token];
  }

  if (token.type === "table") {
    const header = token.header
      .map((token) => {
        const result = token.tokens
          .map((x) => flattenMarkedTokenRecursive(x, findFunction))
          .flat();
        return result;
      })
      .flat();

    const rows = token.rows
      .map((row) => {
        const result = row
          .map((token) => {
            const result = token.tokens
              .map((x) => flattenMarkedTokenRecursive(x, findFunction))
              .flat();

            return result;
          })
          .flat();

        return result;
      })
      .flat();

    return [header, rows].flat();
  }

  if (token.type === "list") {
    const result = token.items
      .map((token) => {
        const result = token.tokens
          .map((x) => flattenMarkedTokenRecursive(x, findFunction))
          .flat();
        return result;
      })
      .flat();

    return result;
  }

  if (
    token.type === "del" ||
    token.type === "em" ||
    token.type === "heading" ||
    token.type === "link" ||
    token.type === "paragraph" ||
    token.type === "strong"
  ) {
    if (!token.tokens) {
      return [];
    }
    const result = token.tokens
      .map((x) => flattenMarkedTokenRecursive(x, findFunction))
      .flat();
    return result;
  }

  return [];
};

/**
 * find all items that match a token, recursively in all nested things
 */
const flattenMarkdownString = (markdownString, findFunction) => {
  const tokenList = lexer(markdownString);
  const result = tokenList
    .map((x) => flattenMarkedTokenRecursive(x, findFunction))
    .filter((x) => !!x)
    .map((x) => x)
    .flat();

  return result;
};

/**
 * find all codeblocks  (stuff between triple bracket)
 *
 * ```
 * here
 * is
 * example
 * ```
 */
export const findCodeblocks = (markdownString) => {
  const result = flattenMarkdownString(
    markdownString,
    (token) => token.type === "code"
  );

  const codesblocks = result
    .map((token) => {
      if (token.type !== "code") return;

      const { text, lang } = token;

      const [ext, ...meta] = lang ? lang.trim().split(" ") : [];
      const parameters = Object.fromEntries(
        meta.map((chunk) => {
          const key = chunk.split("=")[0].trim();
          const value0 = chunk.split("=").slice(1).join("=").trim();
          const isQuoted =
            (value0.startsWith('"') && value0.endsWith('"')) ||
            (value0.startsWith("'") && value0.endsWith("'"));

          const value = isQuoted ? value0.slice(1, value0.length - 1) : value0;

          return [key, value];
        })
      );

      return { text, lang: ext, parameters };
    })
    .filter((x) => !!x)
    .map((x) => x);

  return codesblocks;
};

async function getCompleteResult(env, pathname) {
  const doId = env.SQL_STREAM_PROMPT_DO.idFromName(pathname);
  const doStub = env.SQL_STREAM_PROMPT_DO.get(doId);

  const response = await doStub.fetch(
    new Request("https://do/stream", {
      method: "GET",
      headers: { Accept: "text/event-stream" },
    })
  );

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const event = JSON.parse(line.slice(6));

          if (event.type === "token") {
            result += event.data.text;
          } else if (event.type === "complete") {
            return event.data.result;
          } else if (event.type === "error") {
            throw new Error(event.data.message);
          } else if (
            event.type === "init" &&
            event.data.status === "complete"
          ) {
            return event.data.result;
          }
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }
  }

  return result;
}

async function getMarkdownContent(env, pathnameWithoutExt) {
  let result = await env.RESULTS.get(pathnameWithoutExt, "json");
  if (result?.result) {
    return { result: result.result };
  }
  try {
    return { result: await getCompleteResult(env, pathnameWithoutExt) };
  } catch (e) {
    return { error: e.message };
  }
}

async function processCodeblocks(codeblocks) {
  const files = {};

  // Create an array of promises while maintaining the original order
  const promises = codeblocks.map(async (block) => {
    const path = block.parameters.path;
    const content = block.text.trim();

    // Check if content is just a URL
    const isUrl =
      content.split("\n").length === 1 &&
      (content.startsWith("http://") || content.startsWith("https://"));

    if (isUrl) {
      try {
        const response = await fetch(content);
        if (!response.ok) {
          throw new Error(`Failed to fetch ${content}: ${response.status}`);
        }

        const fetchedContent = await response.arrayBuffer();
        const contentType = response.headers.get("content-type") || "";
        const isBinary =
          !contentType.startsWith("text/") &&
          !contentType.includes("json") &&
          !contentType.includes("xml");

        return {
          path,
          data: {
            type: isBinary ? "binary" : "content",
            url: content,
            content: isBinary ? null : new TextDecoder().decode(fetchedContent),
            binaryData: isBinary ? fetchedContent : null,
            hash: await calculateHash(fetchedContent),
            size: fetchedContent.byteLength,
          },
        };
      } catch (error) {
        console.error(`Error fetching ${content}:`, error);
        // Fall back to treating as regular content
        const errorMessage = `Error fetching ${content}: ${error.message}`;
        return {
          path,
          data: {
            type: "content",
            content: errorMessage,
            hash: await calculateHash(new TextEncoder().encode(errorMessage)),
            size: new TextEncoder().encode(errorMessage).length,
          },
        };
      }
    } else {
      const encoded = new TextEncoder().encode(content);
      return {
        path,
        data: {
          type: "content",
          content: content,
          hash: await calculateHash(encoded),
          size: encoded.length,
        },
      };
    }
  });

  // Wait for all promises to resolve in parallel, maintaining order
  const results = await Promise.all(promises);

  // Build the final files object from the resolved results
  for (const { path, data } of results) {
    files[path.startsWith("/") ? path : "/" + path] = data;
  }

  return files;
}

async function calculateHash(data) {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function createJsonResponse(files) {
  const jsonFiles = {};

  for (const [path, file] of Object.entries(files)) {
    jsonFiles[path] = {
      type: file.type,
      ...(file.url && { url: file.url }),
      ...(file.content && { content: file.content }),
      hash: file.hash,
      size: file.size,
    };
  }

  return new Response(JSON.stringify({ files: jsonFiles }, null, 2), {
    headers: { "Content-Type": "application/json;charset=utf8" },
  });
}

function createMultipartResponse(files) {
  const boundary = `----formdata-${Date.now()}`;

  const readable = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      for (const [path, file] of Object.entries(files)) {
        // Add boundary
        controller.enqueue(encoder.encode(`--${boundary}\r\n`));
        controller.enqueue(
          encoder.encode(
            `Content-Disposition: form-data; name="${path}"; filename="${path}"\r\n`
          )
        );

        const contentType = getContentType(path);

        if (file.type === "binary") {
          controller.enqueue(
            encoder.encode(`Content-Type: ${contentType}\r\n\r\n`)
          );
          controller.enqueue(new Uint8Array(file.binaryData));
        } else {
          controller.enqueue(
            encoder.encode(`Content-Type: ${contentType}\r\n\r\n`)
          );
          controller.enqueue(encoder.encode(file.content));
        }

        controller.enqueue(encoder.encode(`\r\n`));
      }

      // Close boundary
      controller.enqueue(encoder.encode(`--${boundary}--\r\n`));
      controller.close();
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Disposition": 'attachment; filename="files.formdata"',
    },
  });
}

function createZipResponse(files) {
  const zipStream = createZipStream(files);

  return new Response(zipStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="files.zip"',
    },
  });
}

function createZipStream(files) {
  const readable = new ReadableStream({
    start(controller) {
      const centralDirectory = [];
      let offset = 0;

      // Add each file
      for (const [path, file] of Object.entries(files)) {
        const fileName = new TextEncoder().encode(path);
        const fileData =
          file.type === "binary"
            ? new Uint8Array(file.binaryData)
            : new TextEncoder().encode(file.content);

        // Create local file header
        const localHeader = createLocalFileHeader(fileName, fileData);
        controller.enqueue(localHeader);

        // Add file data
        controller.enqueue(fileData);

        // Store central directory entry info
        centralDirectory.push({
          fileName,
          fileData,
          offset,
          crc32: calculateCRC32(fileData),
        });

        offset += localHeader.length + fileData.length;
      }

      // Add central directory
      const centralDirStart = offset;
      for (const entry of centralDirectory) {
        const centralDirHeader = createCentralDirectoryHeader(entry);
        controller.enqueue(centralDirHeader);
        offset += centralDirHeader.length;
      }

      // Add end of central directory record
      const endRecord = createEndOfCentralDirectoryRecord(
        centralDirectory.length,
        offset - centralDirStart,
        centralDirStart
      );
      controller.enqueue(endRecord);

      controller.close();
    },
  });

  return readable;
}

function createLocalFileHeader(fileName, fileData) {
  const header = new ArrayBuffer(30 + fileName.length);
  const view = new DataView(header);

  view.setUint32(0, 0x04034b50, true); // Local file header signature
  view.setUint16(4, 10, true); // Version needed to extract
  view.setUint16(6, 0, true); // General purpose bit flag
  view.setUint16(8, 0, true); // Compression method (0 = no compression)
  view.setUint16(10, 0, true); // Last mod file time
  view.setUint16(12, 0, true); // Last mod file date
  view.setUint32(14, calculateCRC32(fileData), true); // CRC-32
  view.setUint32(18, fileData.length, true); // Compressed size
  view.setUint32(22, fileData.length, true); // Uncompressed size
  view.setUint16(26, fileName.length, true); // File name length
  view.setUint16(28, 0, true); // Extra field length

  // Add filename
  new Uint8Array(header, 30).set(fileName);

  return new Uint8Array(header);
}

function createCentralDirectoryHeader(entry) {
  const header = new ArrayBuffer(46 + entry.fileName.length);
  const view = new DataView(header);

  view.setUint32(0, 0x02014b50, true); // Central directory header signature
  view.setUint16(4, 10, true); // Version made by
  view.setUint16(6, 10, true); // Version needed to extract
  view.setUint16(8, 0, true); // General purpose bit flag
  view.setUint16(10, 0, true); // Compression method
  view.setUint16(12, 0, true); // Last mod file time
  view.setUint16(14, 0, true); // Last mod file date
  view.setUint32(16, entry.crc32, true); // CRC-32
  view.setUint32(20, entry.fileData.length, true); // Compressed size
  view.setUint32(24, entry.fileData.length, true); // Uncompressed size
  view.setUint16(28, entry.fileName.length, true); // File name length
  view.setUint16(30, 0, true); // Extra field length
  view.setUint16(32, 0, true); // File comment length
  view.setUint16(34, 0, true); // Disk number start
  view.setUint16(36, 0, true); // Internal file attributes
  view.setUint32(38, 0, true); // External file attributes
  view.setUint32(42, entry.offset, true); // Relative offset of local header

  // Add filename
  new Uint8Array(header, 46).set(entry.fileName);

  return new Uint8Array(header);
}

function createEndOfCentralDirectoryRecord(
  numEntries,
  centralDirSize,
  centralDirOffset
) {
  const header = new ArrayBuffer(22);
  const view = new DataView(header);

  view.setUint32(0, 0x06054b50, true); // End of central directory signature
  view.setUint16(4, 0, true); // Number of this disk
  view.setUint16(6, 0, true); // Number of disk with start of central directory
  view.setUint16(8, numEntries, true); // Number of central directory records on this disk
  view.setUint16(10, numEntries, true); // Total number of central directory records
  view.setUint32(12, centralDirSize, true); // Size of central directory
  view.setUint32(16, centralDirOffset, true); // Offset of start of central directory
  view.setUint16(20, 0, true); // ZIP file comment length

  return new Uint8Array(header);
}

function calculateCRC32(data) {
  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    crcTable[i] = crc;
  }

  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
