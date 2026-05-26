import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_500_000) {
      throw new Error("Request body is too large.");
    }
  }
  return body ? JSON.parse(body) : {};
}

function cleanBaseUrl(baseUrl) {
  const rawUrl = String(baseUrl || "http://127.0.0.1:1234").trim();
  const url = new URL(rawUrl.includes("://") ? rawUrl : `http://${rawUrl}`);
  let pathname = url.pathname.replace(/\/+$/, "");

  if (pathname.endsWith("/chat/completions")) {
    pathname = pathname.slice(0, -"/chat/completions".length);
  } else if (pathname.endsWith("/models")) {
    pathname = pathname.slice(0, -"/models".length);
  } else if (pathname.endsWith("/embeddings")) {
    pathname = pathname.slice(0, -"/embeddings".length);
  }

  url.search = "";
  url.hash = "";
  url.pathname = pathname.endsWith("/v1") ? pathname : `${pathname}/v1`;
  return url.toString().replace(/\/+$/, "");
}

function toLmStudioError(error, status = 500) {
  return {
    error: error?.message || "LM Studio request failed.",
    status
  };
}

async function proxyModels(req, res) {
  try {
    const { baseUrl, apiKey } = await readJson(req);
    const target = `${cleanBaseUrl(baseUrl)}/models`;
    const response = await fetch(target, {
      headers: { authorization: `Bearer ${apiKey || "lm-studio"}` }
    });
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
    if (!response.ok) return sendJson(res, response.status, toLmStudioError(payload?.error || payload, response.status));
    return sendJson(res, 200, payload);
  } catch (error) {
    return sendJson(res, 502, toLmStudioError(error, 502));
  }
}

// Proxy to LM Studio's extended /api/v0/models which returns max_context_length,
// quantization, arch, capabilities etc. — not available from /v1/models.
async function proxyModelInfo(req, res) {
  try {
    const { baseUrl, apiKey } = await readJson(req);
    // Build the v0 base URL from whatever the user configured
    const base = cleanBaseUrl(baseUrl).replace(/\/v1$/, "");
    const target = `${base}/api/v0/models`;
    const response = await fetch(target, {
      headers: { authorization: `Bearer ${apiKey || "lm-studio"}` },
      signal: AbortSignal.timeout(4000)
    });
    if (!response.ok) {
      // v0 endpoint not supported (e.g. non-LM Studio server) — return empty gracefully
      return sendJson(res, 200, { data: [] });
    }
    const payload = await response.json();
    return sendJson(res, 200, payload);
  } catch {
    return sendJson(res, 200, { data: [] }); // fail silently — this is optional enrichment
  }
}

async function proxyChat(req, res) {
  try {
    const { baseUrl, apiKey, request } = await readJson(req);
    const target = `${cleanBaseUrl(baseUrl)}/chat/completions`;
    const response = await fetch(target, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey || "lm-studio"}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(request)
    });

    // Streaming: pipe SSE events directly to the browser instead of buffering.
    if (request?.stream) {
      if (!response.ok) {
        const errText = await response.text();
        let errPayload;
        try { errPayload = errText ? JSON.parse(errText) : {}; } catch { errPayload = { raw: errText }; }
        const message = errPayload?.error?.message || errPayload?.error || errPayload?.raw || "LM Studio returned an error.";
        return sendJson(res, response.status, toLmStudioError(new Error(String(message)), response.status));
      }
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        "x-accel-buffering": "no"
      });
      for await (const chunk of response.body) {
        if (!res.writableEnded) res.write(chunk);
      }
      if (!res.writableEnded) res.end();
      return;
    }

    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }
    if (!response.ok) {
      const message = payload?.error?.message || payload?.error || payload?.raw || "LM Studio returned an error.";
      return sendJson(res, response.status, toLmStudioError(new Error(String(message)), response.status));
    }
    return sendJson(res, 200, payload);
  } catch (error) {
    return sendJson(res, 502, toLmStudioError(error, 502));
  }
}

async function proxyEmbeddings(req, res) {
  try {
    const { baseUrl, apiKey, request } = await readJson(req);
    const target = `${cleanBaseUrl(baseUrl)}/embeddings`;
    const response = await fetch(target, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey || "lm-studio"}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(request)
    });
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }
    if (!response.ok) {
      const message = payload?.error?.message || payload?.error || payload?.raw || "LM Studio returned an error.";
      return sendJson(res, response.status, toLmStudioError(new Error(String(message)), response.status));
    }
    return sendJson(res, 200, payload);
  } catch (error) {
    return sendJson(res, 502, toLmStudioError(error, 502));
  }
}

async function toolExecute(req, res) {
  try {
    const { tool, args } = await readJson(req);

    if (tool === "web_search") {
      const query = String(args?.query || "").trim();
      if (!query) return sendJson(res, 400, { error: "Missing search query." });

      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const response = await fetch(searchUrl, {
        headers: { "user-agent": "Forum/1.0" },
        signal: AbortSignal.timeout(8000)
      });
      const html = await response.text();
      const $ = cheerio.load(html);
      const results = [];

      $(".result").each((_, el) => {
        if (results.length >= 5) return;
        const linkEl = $(el).find(".result__a");
        const snippetEl = $(el).find(".result__snippet");
        const rawUrl = linkEl.attr("href") || "";
        const title = linkEl.text().trim();
        const snippet = snippetEl.text().trim();
        
        let url = rawUrl;
        if (rawUrl.includes("uddg=")) {
          url = decodeURIComponent(rawUrl.split("uddg=")[1].split("&")[0]);
        }
        
        if (url && title) {
          results.push({ title, snippet, url });
        }
      });

      if (!results.length) {
        return sendJson(res, 200, { results: [{ title: "No results", snippet: `No results found for: ${query}`, url: "" }] });
      }
      return sendJson(res, 200, { results });
    }

    if (tool === "web_read") {
      const url = String(args?.url || "").trim();
      if (!url) return sendJson(res, 400, { error: "Missing URL." });

      const response = await fetch(url, {
        headers: { "user-agent": "Forum/1.0", "accept": "text/html,application/xhtml+xml,text/plain" },
        signal: AbortSignal.timeout(8000),
        redirect: "follow"
      });
      const contentType = response.headers.get("content-type") || "";
      const raw = await response.text();

      let text;
      if (contentType.includes("text/html") || contentType.includes("xhtml")) {
        const $ = cheerio.load(raw);
        $("script, style, nav, header, footer").remove();
        const title = $("title").text().trim();
        let cleaned = $("body").text().replace(/\s+/g, " ").trim();

        if (cleaned.length > 3000) cleaned = cleaned.slice(0, 3000) + "…[truncated]";
        text = title ? `Title: ${title}\n\n${cleaned}` : cleaned;
      } else {
        text = raw.slice(0, 3000);
        if (raw.length > 3000) text += "…[truncated]";
      }

      return sendJson(res, 200, { url, text });
    }

    return sendJson(res, 400, { error: `Unknown tool: ${tool}` });
  } catch (error) {
    return sendJson(res, 502, { error: error?.message || "Tool execution failed." });
  }
}

async function serveStatic(req, res) {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const rawPath = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
  const normalizedPath = normalize(rawPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, normalizedPath);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const file = await readFile(filePath);
    res.writeHead(200, {
      "content-type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(file);
  } catch {
    const fallback = await readFile(join(publicDir, "index.html"));
    res.writeHead(200, {
      "content-type": mimeTypes[".html"],
      "cache-control": "no-store"
    });
    res.end(fallback);
  }
}

async function githubPr(req, res) {
  const { url, token } = await readJson(req);
  const match = String(url || '').match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) return sendJson(res, 400, { error: "Not a valid GitHub PR URL." });
  const [, owner, repo, number] = match;
  const base = `https://api.github.com/repos/${owner}/${repo}`;
  const headers = {
    accept: "application/vnd.github.v3+json",
    "user-agent": "Forum/1.0",
    ...(token ? { authorization: `Bearer ${token}` } : {})
  };
  const prRes = await fetch(`${base}/pulls/${number}`, { headers, signal: AbortSignal.timeout(10000) });
  if (!prRes.ok) return sendJson(res, prRes.status, { error: `GitHub API: ${prRes.status}` });
  const pr = await prRes.json();
  const filesRes = await fetch(`${base}/pulls/${number}/files?per_page=100`, { headers, signal: AbortSignal.timeout(10000) });
  const files = filesRes.ok ? await filesRes.json() : [];
  const FILE_PATCH_CAP = 4000;
  const TOTAL_DIFF_CAP = 40000;
  let totalDiff = 0;
  const processedFiles = [];
  for (const f of files) {
    const patch = f.patch ? f.patch.slice(0, FILE_PATCH_CAP) : '';
    totalDiff += patch.length;
    if (totalDiff > TOTAL_DIFF_CAP) break;
    processedFiles.push({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, patch });
  }
  sendJson(res, 200, {
    title: pr.title, body: pr.body || '', state: pr.state,
    base: pr.base?.ref, head: pr.head?.ref,
    additions: pr.additions, deletions: pr.deletions, changed_files: pr.changed_files,
    user: pr.user?.login, files: processedFiles
  });
}

const server = createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/models") return proxyModels(req, res);
  if (req.method === "POST" && req.url === "/api/model-info") return proxyModelInfo(req, res);
  if (req.method === "POST" && req.url === "/api/chat") return proxyChat(req, res);
  if (req.method === "POST" && req.url === "/api/embeddings") return proxyEmbeddings(req, res);
  if (req.method === "POST" && req.url === "/api/tool-execute") return toolExecute(req, res);
  if (req.method === "POST" && req.url === "/api/github-pr") return githubPr(req, res);
  if (req.method === "GET") return serveStatic(req, res);
  sendJson(res, 405, { error: "Method not allowed." });
});

server.listen(port, host, () => {
  console.log(`Forum is running at http://${host}:${port}`);
  console.log("Point it at LM Studio's local server, usually http://127.0.0.1:1234");
});


