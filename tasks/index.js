require("dotenv").config();

const http   = require("http");
const { neon } = require("@neondatabase/serverless");

const PORT   = process.env.PORT         || 3002;
const DB_URL = process.env.DATABASE_URL;

if (!DB_URL) {
  throw new Error("DATABASE_URL is required");
}

const sql = neon(DB_URL);

async function initDB() {
  await sql`
    CREATE TABLE IF NOT EXISTS tasks (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL,
      title       VARCHAR(200) NOT NULL,
      description TEXT,
      status      VARCHAR(20) DEFAULT 'pending',   -- pending | in_progress | done
      priority    VARCHAR(10) DEFAULT 'medium',    -- low | medium | high
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log("[tasks] DB ready");
}

// ── Helpers ────────────────────────────────────────────────
function readBody(req) {
  return new Promise((res, rej) => {
    let data = "";
    req.on("data", c => data += c);
    req.on("end", () => { try { res(JSON.parse(data || "{}")); } catch { res({}); } });
    req.on("error", rej);
  });
}

function getUserId(req) {
  // The gateway injects X-User-Id after validating the JWT
  return parseInt(req.headers["x-user-id"]);
}

// ── Route handlers ─────────────────────────────────────────
async function listTasks(userId, query) {
  const { status, priority } = query;
  let result;

  if (status && priority) {
    result = await sql`
      SELECT * FROM tasks
      WHERE user_id=${userId} AND status=${status} AND priority=${priority}
      ORDER BY created_at DESC
    `;
  } else if (status) {
    result = await sql`
      SELECT * FROM tasks
      WHERE user_id=${userId} AND status=${status}
      ORDER BY created_at DESC
    `;
  } else if (priority) {
    result = await sql`
      SELECT * FROM tasks
      WHERE user_id=${userId} AND priority=${priority}
      ORDER BY created_at DESC
    `;
  } else {
    result = await sql`
      SELECT * FROM tasks
      WHERE user_id=${userId}
      ORDER BY created_at DESC
    `;
  }

  return { status: 200, data: result };
}

async function createTask(userId, body) {
  const { title, description = "", priority = "medium" } = body;
  if (!title) return { status: 400, data: { error: "title is required" } };
  const result = await sql`
    INSERT INTO tasks (user_id, title, description, priority)
    VALUES (${userId}, ${title}, ${description}, ${priority})
    RETURNING *
  `;
  return { status: 201, data: result[0] };
}

async function getTask(userId, taskId) {
  const result = await sql`SELECT * FROM tasks WHERE id=${taskId} AND user_id=${userId}`;
  if (!result[0]) return { status: 404, data: { error: "Task not found" } };
  return { status: 200, data: result[0] };
}

async function updateTask(userId, taskId, body) {
  const { title, description, status, priority } = body;
  const result = await sql`
    UPDATE tasks SET
      title       = COALESCE(${title}, title),
      description = COALESCE(${description}, description),
      status      = COALESCE(${status}, status),
      priority    = COALESCE(${priority}, priority),
      updated_at  = NOW()
    WHERE id=${taskId} AND user_id=${userId}
    RETURNING *
  `;
  if (!result[0]) return { status: 404, data: { error: "Task not found" } };
  return { status: 200, data: result[0] };
}

async function deleteTask(userId, taskId) {
  const result = await sql`DELETE FROM tasks WHERE id=${taskId} AND user_id=${userId} RETURNING id`;
  if (!result[0]) return { status: 404, data: { error: "Task not found" } };
  return { status: 200, data: { message: "Task deleted" } };
}

async function getStats(userId) {
  const result = await sql`
    SELECT status, COUNT(*) as count
    FROM tasks
    WHERE user_id=${userId}
    GROUP BY status
  `;
  const stats = { pending: 0, in_progress: 0, done: 0, total: 0 };
  result.forEach(r => {
    stats[r.status] = parseInt(r.count);
    stats.total += parseInt(r.count);
  });
  return { status: 200, data: stats };
}

// ── HTTP Server ────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  const send = (status, data) => { res.writeHead(status); res.end(JSON.stringify(data)); };

  const url    = req.url.split("?")[0];
  const query  = Object.fromEntries(new URL(req.url, "http://x").searchParams);
  const userId = getUserId(req);
  const match  = url.match(/^\/tasks\/(\d+)$/);
  const taskId = match ? parseInt(match[1]) : null;

  try {
    if (req.method === "GET"    && url === "/health")      return send(200, { status: "ok", service: "tasks" });
    if (!userId)                                           return send(401, { error: "Unauthorized" });
    if (req.method === "GET"    && url === "/stats")       return send(...Object.values(await getStats(userId)));
    if (req.method === "GET"    && url === "/tasks")       { const r = await listTasks(userId, query);              return send(r.status, r.data); }
    if (req.method === "POST"   && url === "/tasks")       { const b = await readBody(req); const r = await createTask(userId, b); return send(r.status, r.data); }
    if (req.method === "GET"    && taskId)                 { const r = await getTask(userId, taskId);               return send(r.status, r.data); }
    if (req.method === "PATCH"  && taskId)                 { const b = await readBody(req); const r = await updateTask(userId, taskId, b); return send(r.status, r.data); }
    if (req.method === "DELETE" && taskId)                 { const r = await deleteTask(userId, taskId);            return send(r.status, r.data); }
    send(404, { error: "Not found" });
  } catch (e) {
    console.error("[tasks] Error:", e.message);
    send(500, { error: "Internal server error" });
  }
});

initDB().then(() => {
  server.listen(PORT, () => console.log(`[tasks] listening on :${PORT}`));
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
