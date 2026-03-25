require("dotenv").config();

const http    = require("http");
const crypto  = require("crypto");
const { neon } = require("@neondatabase/serverless");

const PORT       = process.env.PORT       || 3001;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-prod";
const DB_URL     = process.env.DATABASE_URL;

if (!DB_URL) {
  throw new Error("DATABASE_URL is required");
}

const sql = neon(DB_URL);

async function initDB() {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id         SERIAL PRIMARY KEY,
      username   VARCHAR(50) UNIQUE NOT NULL,
      password   VARCHAR(64) NOT NULL,   -- SHA-256 hex
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log("[auth] DB ready");
}

// ── Minimal JWT (header.payload.signature) ────────────────
function signToken(payload) {
  const header  = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body    = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() })).toString("base64url");
  const sig     = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  try {
    const [header, body, sig] = token.split(".");
    const expected = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest("base64url");
    if (sig !== expected) return null;
    return JSON.parse(Buffer.from(body, "base64url").toString());
  } catch { return null; }
}

function hashPassword(pw) {
  return crypto.createHash("sha256").update(pw + JWT_SECRET).digest("hex");
}

// ── Route handlers ─────────────────────────────────────────
async function register(body) {
  const { username, password } = body;
  if (!username || !password) return { status: 400, data: { error: "username and password required" } };
  try {
    const result = await sql`
      INSERT INTO users (username, password)
      VALUES (${username}, ${hashPassword(password)})
      RETURNING id, username
    `;
    const user  = result[0];
    const token = signToken({ userId: user.id, username: user.username });
    return { status: 201, data: { token, user: { id: user.id, username: user.username } } };
  } catch (e) {
    if (e.code === "23505") return { status: 409, data: { error: "Username already exists" } };
    throw e;
  }
}

async function login(body) {
  const { username, password } = body;
  if (!username || !password) return { status: 400, data: { error: "username and password required" } };
  const result = await sql`SELECT * FROM users WHERE username=${username}`;
  const user   = result[0];
  if (!user || user.password !== hashPassword(password))
    return { status: 401, data: { error: "Invalid credentials" } };
  const token = signToken({ userId: user.id, username: user.username });
  return { status: 200, data: { token, user: { id: user.id, username: user.username } } };
}

function verify(body) {
  const { token } = body;
  if (!token) return { status: 400, data: { error: "token required" } };
  const payload = verifyToken(token);
  if (!payload)  return { status: 401, data: { error: "Invalid token" } };
  return { status: 200, data: { valid: true, payload } };
}

// ── HTTP Server ────────────────────────────────────────────
function readBody(req) {
  return new Promise((res, rej) => {
    let data = "";
    req.on("data", c => data += c);
    req.on("end", () => { try { res(JSON.parse(data || "{}")); } catch { res({}); } });
    req.on("error", rej);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  const send = (status, data) => { res.writeHead(status); res.end(JSON.stringify(data)); };

  try {
    if (req.method === "GET"  && req.url === "/health")    return send(200, { status: "ok", service: "auth" });
    if (req.method === "POST" && req.url === "/register")  { const b = await readBody(req); const r = await register(b); return send(r.status, r.data); }
    if (req.method === "POST" && req.url === "/login")     { const b = await readBody(req); const r = await login(b);    return send(r.status, r.data); }
    if (req.method === "POST" && req.url === "/verify")    { const b = await readBody(req); const r = verify(b);         return send(r.status, r.data); }
    send(404, { error: "Not found" });
  } catch (e) {
    console.error("[auth] Error:", e.message);
    send(500, { error: "Internal server error" });
  }
});

initDB().then(() => {
  server.listen(PORT, () => console.log(`[auth] listening on :${PORT}`));
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
