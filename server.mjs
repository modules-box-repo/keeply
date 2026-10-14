import { createServer } from "node:http";
import { readFile, writeFile, stat, mkdir } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const baseDir = dirname(fileURLToPath(import.meta.url));
const root = join(baseDir, "dist");
const dataFile = join(baseDir, "data.json");
const uploadsDir = join(baseDir, "uploads");
const port = Number(process.env.PORT) || 3000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

async function resolveFile(base, pathname) {
  const filePath = normalize(join(base, pathname));
  if (!filePath.startsWith(base)) return null;

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) {
      const index = join(filePath, "index.html");
      await stat(index);
      return index;
    }
    return filePath;
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = decodeURIComponent(url.pathname);

    // CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "*",
      });
      res.end();
      return;
    }

    // API: Persistent Data Storage (survives port and host changes)
    if (pathname === "/api/data") {
      if (req.method === "GET") {
        try {
          const raw = await readFile(dataFile, "utf8");
          const parsed = JSON.parse(raw);
          console.log(`[Keeply] Loaded ${parsed.notes?.length ?? 0} notes from ${dataFile}`);
          res.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            "access-control-allow-origin": "*",
          });
          res.end(raw);
        } catch {
          res.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            "access-control-allow-origin": "*",
          });
          res.end(JSON.stringify({ notes: [], labels: [], settings: {} }));
        }
        return;
      }

      if (req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", async () => {
          try {
            const parsed = JSON.parse(body);
            await writeFile(dataFile, JSON.stringify(parsed, null, 2), "utf8");
            console.log(`[Keeply] Saved ${parsed.notes?.length ?? 0} notes to ${dataFile}`);
            res.writeHead(200, {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store",
              "access-control-allow-origin": "*",
            });
            res.end(JSON.stringify({ ok: true, count: parsed.notes?.length ?? 0 }));
          } catch (e) {
            console.error("[Keeply] Save error:", e);
            res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ error: "Invalid JSON payload" }));
          }
        });
        return;
      }
    }

    // API: File Uploads
    if (pathname === "/api/upload" && req.method === "POST") {
      await mkdir(uploadsDir, { recursive: true });
      const rawHeader = req.headers["x-filename"];
      const rawFilename = typeof rawHeader === "string" ? decodeURIComponent(rawHeader) : "file.bin";
      const fileId = req.headers["x-file-id"] || `att_${Date.now()}`;
      const ext = extname(rawFilename) || ".bin";
      const filename = `${fileId}${ext}`;
      const filePath = join(uploadsDir, filename);

      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", async () => {
        try {
          await writeFile(filePath, Buffer.concat(chunks));
          res.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "access-control-allow-origin": "*",
          });
          res.end(JSON.stringify({ ok: true, id: fileId, url: `/uploads/${filename}` }));
        } catch (err) {
          res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
      return;
    }

    // Static: Serve uploaded files
    if (pathname.startsWith("/uploads/")) {
      const relPath = pathname.slice("/uploads/".length);
      const filePath = await resolveFile(uploadsDir, relPath);
      if (filePath) {
        const data = await readFile(filePath);
        res.writeHead(200, {
          "content-type": MIME[extname(filePath)] ?? "application/octet-stream",
          "cache-control": "public, max-age=86400",
        });
        res.end(data);
        return;
      }
    }

    // Static: SPA files from dist/
    const filePath = (await resolveFile(root, pathname)) ?? join(root, "index.html");
    const data = await readFile(filePath);

    res.writeHead(200, {
      "content-type": MIME[extname(filePath)] ?? "application/octet-stream",
      "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
      "pragma": "no-cache",
      "expires": "0",
    });
    res.end(data);
  } catch (error) {
    console.error(error);
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("Internal Server Error");
  }
});

server.listen(port, () => {
  console.log(`Keeply running at http://localhost:${port}`);
});
