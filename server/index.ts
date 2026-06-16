import http from "http";
import fs from "fs";
import path from "path";
import { Server as SocketServer } from "socket.io";
import { RoomManager } from "./roomManager";

const parsedPort = Number(process.env.PORT ?? 4949);
const PORT = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : 4949;
const serveClient = process.argv.includes("--serve-static") || process.env.NODE_ENV === "production";
const rootDir = path.resolve(__dirname, "../..");
const distDir = path.join(rootDir, "dist");
const playPassword = cleanPassword(process.env.CURSEWORDS_PLAY_PASSWORD ?? process.env.PLAY_PASSWORD);

const roomManager = new RoomManager({ playPassword });

const server = http.createServer((req, res) => {
  if (isHealthcheckRequest(req)) {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }

  if (isAuthConfigRequest(req)) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ passwordRequired: Boolean(playPassword) }));
    return;
  }

  if (!serveClient) {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("Cursewords server is running.");
    return;
  }

  serveStatic(req, res);
});

const io = new SocketServer(server, {
  cors: { origin: "*" }
});

roomManager.bind(io);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Cursewords server listening on :${PORT} (${serveClient ? "serving client" : "development"})`);
});

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  let pathname = "/";
  try {
    pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
  } catch {
    res.writeHead(400, { "content-type": "text/plain" });
    res.end("Bad request");
    return;
  }

  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(distDir, relativePath);

  if (!isPathInside(filePath, distDir)) {
    res.writeHead(403).end();
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
    res.writeHead(200, { "content-type": contentType });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  const indexPath = path.join(distDir, "index.html");
  if (fs.existsSync(indexPath)) {
    res.writeHead(200, { "content-type": "text/html" });
    fs.createReadStream(indexPath).pipe(res);
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not found");
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2"
};

function isHealthcheckRequest(req: http.IncomingMessage) {
  return (req.url?.split("?")[0] ?? "") === "/healthz";
}

function isAuthConfigRequest(req: http.IncomingMessage) {
  return (req.url?.split("?")[0] ?? "") === "/auth-config";
}

function cleanPassword(password?: string) {
  const cleaned = password?.trim();
  return cleaned || undefined;
}

function isPathInside(filePath: string, parentDir: string) {
  const relative = path.relative(parentDir, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
