const http  = require("http");
const https = require("https");

const PORT         = process.env.PORT         || 3000;
const AUTH_SERVICE = process.env.AUTH_SERVICE || "http://auth-service:3001";
const TASKS_SERVICE= process.env.TASKS_SERVICE|| "http://tasks-service:3002";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "http://localhost:8080,http://127.0.0.1:8080,https://k8s-todo.vercel.app,https://k8s-todo.pages.dev")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// ── Proxy a un servicio interno ────────────────────────────
function proxy(req, res, targetBase, path, extraHeaders = {}) {
  const url    = new URL(path, targetBase);
  const mod    = url.protocol === "https:" ? https : http;
  const chunks = [];

  req.on("data", c => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const opts = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === "https:" ? 443 : 80),
      path:     url.pathname + (url.search || ""),
      method:   req.method,
      headers: {
        ...req.headers,
        ...extraHeaders,
        host:             url.hostname,
        "content-length": body.length,
      },
    };

    const proxyReq = mod.request(opts, proxyRes => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on("error", e => {
      console.error("[gateway] proxy error:", e.message);
      if (!res.headersSent) {
        res.writeHead(502); res.end(JSON.stringify({ error: "Service unavailable" }));
      }
    });

    proxyReq.write(body);
    proxyReq.end();
  });
}

// ── Verificar JWT llamando al auth-service ─────────────────
function verifyToken(token) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ token });
    const url  = new URL("/verify", AUTH_SERVICE);
    const req  = http.request({
      hostname: url.hostname, port: url.port, path: "/verify",
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.write(body); req.end();
  });
}

// ── Middleware de autenticación ────────────────────────────
async function authenticate(req, res) {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    res.writeHead(401); res.end(JSON.stringify({ error: "Missing Authorization header" }));
    return null;
  }
  const result = await verifyToken(token);
  if (!result || !result.valid) {
    res.writeHead(401); res.end(JSON.stringify({ error: "Invalid or expired token" }));
    return null;
  }
  return result.payload;
}

// ── CORS headers ───────────────────────────────────────────
function setCORS(req, res) {
  const origin = req.headers["origin"];
  if (!origin) {
    // Peticiones server-to-server o curl sin Origin.
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

// ── HTTP Server ────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  setCORS(req, res);
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

  const url = req.url.split("?")[0];
  const qs  = req.url.includes("?") ? "?" + req.url.split("?")[1] : "";

  console.log(`[gateway] ${req.method} ${req.url}`);

  // Health check del gateway
  if (req.method === "GET" && url === "/health") {
    res.writeHead(200); return res.end(JSON.stringify({ status: "ok", service: "gateway" }));
  }

  // ── Rutas públicas (sin autenticación) ──────────────────
  if (req.method === "POST" && url === "/auth/register") return proxy(req, res, AUTH_SERVICE, "/register");
  if (req.method === "POST" && url === "/auth/login")    return proxy(req, res, AUTH_SERVICE, "/login");

  // ── Rutas protegidas ────────────────────────────────────
  const user = await authenticate(req, res);
  if (!user) return;   // authenticate ya respondió con 401

  // Inyectar identidad del usuario para los servicios internos
  req.headers["x-user-id"]   = String(user.userId);
  req.headers["x-username"]  = user.username;

  // Rutas de tareas → tasks-service
  if (url.startsWith("/tasks") || url === "/stats") {
    return proxy(req, res, TASKS_SERVICE, url + qs, {
      "x-user-id":  String(user.userId),
      "x-username": user.username,
    });
  }

  res.writeHead(404); res.end(JSON.stringify({ error: "Route not found" }));
});

server.listen(PORT, () => console.log(`[gateway] listening on :${PORT}`));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
