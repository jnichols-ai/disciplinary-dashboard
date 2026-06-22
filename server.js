/* Minimal static file server + monday.com API proxy.
   The browser can't call api.monday.com directly (no CORS support),
   so this same-origin proxy relays requests and avoids that restriction.
   It does not store or log the API token -- it only forwards the
   Authorization header the browser sends on each request. */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = __dirname;

const MIME = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function serveStatic(req, res) {
  let filePath = req.url === "/" ? "/index.html" : req.url;
  filePath = path.join(PUBLIC_DIR, decodeURIComponent(filePath.split("?")[0]));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not found");
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function proxyMonday(req, res) {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const auth = process.env.MONDAY_API_TOKEN || req.headers["authorization"] || "";
    const options = {
      hostname: "api.monday.com",
      path: "/v2",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        Authorization: auth,
        "API-Version": "2024-10",
      },
    };
    const proxyReq = https.request(options, (proxyRes) => {
      let responseBody = "";
      proxyRes.on("data", (chunk) => (responseBody += chunk));
      proxyRes.on("end", () => {
        res.writeHead(proxyRes.statusCode, { "Content-Type": "application/json" });
        res.end(responseBody);
      });
    });
    proxyReq.on("error", (err) => {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ errors: [{ message: err.message }] }));
    });
    proxyReq.write(body);
    proxyReq.end();
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/monday") {
    return proxyMonday(req, res);
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Disciplinary Action Dashboard running at http://localhost:${PORT}`);
});
