import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

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
      headers: {
        authorization: `Bearer ${apiKey || "lm-studio"}`
      }
    });
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }
    if (!response.ok) {
      return sendJson(res, response.status, toLmStudioError(payload?.error || payload, response.status));
    }
    return sendJson(res, 200, payload);
  } catch (error) {
    return sendJson(res, 502, toLmStudioError(error, 502));
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

      const results = [];
      const resultRegex = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
      let match;
      while ((match = resultRegex.exec(html)) !== null && results.length < 5) {
        const url = decodeURIComponent(String(match[1]).replace(/.*uddg=/, "").replace(/&.*/, ""));
        const title = String(match[2]).replace(/<[^>]*>/g, "").trim();
        const snippet = String(match[3]).replace(/<[^>]*>/g, "").trim();
        if (url && title) results.push({ title, snippet, url });
      }

      if (!results.length) {
        return sendJson(res, 200, { results: [{ title: "No results", snippet: `No results found for: ${query}`, url: "" }] });
      }
      return sendJson(res, 200, { results });
    }

    if (tool === "read_webpage") {
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
        // Extract title
        const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const title = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, "").trim() : "";

        // Remove script, style, nav, header, footer
        let cleaned = raw
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
          .replace(/<header[\s\S]*?<\/header>/gi, " ")
          .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/\s+/g, " ")
          .trim();

        // Truncate
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

const server = createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/models") {
    return proxyModels(req, res);
  }
  if (req.method === "POST" && req.url === "/api/chat") {
    return proxyChat(req, res);
  }
  if (req.method === "POST" && req.url === "/api/embeddings") {
    return proxyEmbeddings(req, res);
  }
  if (req.method === "POST" && req.url === "/api/tool-execute") {
    return toolExecute(req, res);
  }
  if (req.method === "GET") {
    return serveStatic(req, res);
  }
  sendJson(res, 405, { error: "Method not allowed." });
});

server.listen(port, host, () => {
  console.log(`Forum is running at http://${host}:${port}`);
  console.log("Point it at LM Studio's local server, usually http://127.0.0.1:1234");
});


