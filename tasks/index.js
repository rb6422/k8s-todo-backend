const http   = require("http");
const { Pool } = require("pg");

const PORT   = process.env.PORT         || 3002;
const DB_URL = process.env.DATABASE_URL;

// ── PostgreSQL ─────────────────────────────────────────────
const pool = new Pool({ connectionString: DB_URL });

async function initDB() {
  await pool.query(`
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
  `);
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
  let sql    = "SELECT * FROM tasks WHERE user_id=$1";
  const vals = [userId];
  if (status)   { sql += ` AND status=$${vals.length+1}`;   vals.push(status); }
  if (priority) { sql += ` AND priority=$${vals.length+1}`; vals.push(priority); }
  sql += " ORDER BY created_at DESC";
  const result = await pool.query(sql, vals);
  return { status: 200, data: result.rows };
}

async function createTask(userId, body) {
  const { title, description = "", priority = "medium" } = body;
  if (!title) return { status: 400, data: { error: "title is required" } };
  const result = await pool.query(
    `INSERT INTO tasks (user_id, title, description, priority)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [userId, title, description, priority]
  );
  return { status: 201, data: result.rows[0] };
}

async function getTask(userId, taskId) {
  const result = await pool.query(
    "SELECT * FROM tasks WHERE id=$1 AND user_id=$2",
    [taskId, userId]
  );
  if (!result.rows[0]) return { status: 404, data: { error: "Task not found" } };
  return { status: 200, data: result.rows[0] };
}

async function updateTask(userId, taskId, body) {
  const { title, description, status, priority } = body;
  const result = await pool.query(
    `UPDATE tasks SET
       title       = COALESCE($3, title),
       description = COALESCE($4, description),
       status      = COALESCE($5, status),
       priority    = COALESCE($6, priority),
       updated_at  = NOW()
     WHERE id=$1 AND user_id=$2 RETURNING *`,
    [taskId, userId, title, description, status, priority]
  );
  if (!result.rows[0]) return { status: 404, data: { error: "Task not found" } };
  return { status: 200, data: result.rows[0] };
}

async function deleteTask(userId, taskId) {
  const result = await pool.query(
    "DELETE FROM tasks WHERE id=$1 AND user_id=$2 RETURNING id",
    [taskId, userId]
  );
  if (!result.rows[0]) return { status: 404, data: { error: "Task not found" } };
  return { status: 200, data: { message: "Task deleted" } };
}

async function getStats(userId) {
  const result = await pool.query(
    `SELECT status, COUNT(*) as count FROM tasks WHERE user_id=$1 GROUP BY status`,
    [userId]
  );
  const stats = { pending: 0, in_progress: 0, done: 0, total: 0 };
  result.rows.forEach(r => {
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
