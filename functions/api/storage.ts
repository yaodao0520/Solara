const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

type Env = {
  DB?: D1Database;
};

type StorageData = Record<string, string | null>;

type JsonBody = {
  data?: Record<string, unknown>;
  keys?: unknown;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

function hasD1(env: Env): env is Required<Env> {
  return Boolean(env.DB && typeof env.DB.prepare === "function");
}

async function ensureTable(env: Env): Promise<void> {
  if (!hasD1(env)) {
    return;
  }
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)"
  ).run();
}

async function handleGet(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (!hasD1(env)) {
    return jsonResponse({ d1Available: false, data: {} });
  }

  const statusOnly = url.searchParams.get("status");
  if (statusOnly) {
    return jsonResponse({ d1Available: true });
  }

  const keysParam = url.searchParams.get("keys") || "";
  const keys = keysParam
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);

  await ensureTable(env);

  const data: StorageData = {};
  let rows: Array<{ key: string; value: string | null }> = [];
  if (keys.length > 0) {
    const placeholders = keys.map(() => "?").join(",");
    const statement = env.DB.prepare(
      `SELECT key, value FROM kv_store WHERE key IN (${placeholders})`
    ).bind(...keys);
    const result = await statement.all();
    rows = (result as any).results || result.results || [];
    keys.forEach((key) => {
      data[key] = null;
    });
  } else {
    const result = await env.DB.prepare("SELECT key, value FROM kv_store").all();
    rows = (result as any).results || result.results || [];
  }

  rows.forEach((row) => {
    data[row.key] = row.value;
  });

  return jsonResponse({ d1Available: true, data });
}

async function handlePost(request: Request, env: Env): Promise<Response> {
  if (!hasD1(env)) {
    return jsonResponse({ d1Available: false, data: {} });
  }

  const body = (await request.json().catch(() => ({}))) as JsonBody;
  const payload = body.data && typeof body.data === "object" ? body.data : null;

  if (!payload || Array.isArray(payload)) {
    return jsonResponse({ error: "Invalid payload" }, 400);
  }

  const entries = Object.entries(payload).filter(([key]) => Boolean(key));
  if (entries.length === 0) {
    return jsonResponse({ d1Available: true, updated: 0 });
  }

  await ensureTable(env);

  const statements = entries.map(([key, value]) => {
    const storedValue = value == null ? "" : String(value);
    return env.DB.prepare(
      "INSERT INTO kv_store (key, value, updated_at) VALUES (?1, ?2, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    ).bind(key, storedValue);
  });

  await env.DB.batch(statements);
  return jsonResponse({ d1Available: true, updated: entries.length });
}

async function handleDelete(request: Request, env: Env): Promise<Response> {
  if (!hasD1(env)) {
    return jsonResponse({ d1Available: false });
  }

  const body = (await request.json().catch(() => ({}))) as JsonBody;
  const keys = Array.isArray(body.keys)
    ? body.keys.filter((key): key is string => typeof key === "string" && Boolean(key))
    : [];

  if (keys.length === 0) {
    return jsonResponse({ d1Available: true, deleted: 0 });
  }

  await ensureTable(env);
  const statements = keys.map((key) => env.DB.prepare("DELETE FROM kv_store WHERE key = ?1").bind(key));
  await env.DB.batch(statements);
  return jsonResponse({ d1Available: true, deleted: keys.length });
}

export async function onRequest(context: any): Promise<Response> {
  const { request, env } = context;
  const method = (request.method || "GET").toUpperCase();

  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }

  if (method === "GET") {
    return handleGet(request, env);
  }

  if (method === "POST") {
    return handlePost(request, env);
  }

  if (method === "DELETE") {
    return handleDelete(request, env);
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
}
