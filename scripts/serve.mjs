import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const rootDirectory = resolve(projectRoot, process.argv[2] ?? "dist");
const port = Number(process.env.PORT ?? 8080);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json",
};

if (!existsSync(rootDirectory)) {
  throw new Error(`Directory does not exist: ${rootDirectory}`);
}

const server = createServer((request, response) => {
  try {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    const requestedPath = decodeURIComponent(requestUrl.pathname);
    const candidate = resolve(rootDirectory, `.${requestedPath}`);

    if (candidate !== rootDirectory && !candidate.startsWith(`${rootDirectory}/`)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    const filePath = existsSync(candidate) && statSync(candidate).isDirectory()
      ? resolve(candidate, "index.html")
      : candidate;

    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Cache-Control": "no-cache",
      "Content-Type": contentTypes[extname(filePath)] ?? "application/octet-stream",
    });
    createReadStream(filePath).pipe(response);
  } catch (error) {
    response.writeHead(400);
    response.end(error instanceof Error ? error.message : "Bad request");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Serving ${rootDirectory} at http://127.0.0.1:${port}/`);
});
