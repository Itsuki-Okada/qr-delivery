// ローカル検証用 Supabase エミュレーター本体（開発・テスト専用。本番では使用しない）
//
// supabase-js が使う REST（PostgREST）と Auth（GoTrue）の一部だけを模倣し、
// クエリは実 PostgreSQL 上でロール（anon / authenticated / service_role）を切り替えて実行する。
// DB 関数・RLS・権限は本物だが、PostgREST / GoTrue の挙動を完全には再現しない。

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import http from "node:http";

const JWT_SECRET = "local-emulator-jwt-secret";

/**
 * @param {{ pool: import("pg").Pool, port: number, seed: any }} opts
 */
export async function startEmulator({ pool, port, seed }) {
  const users = new Map(); // email -> { id, password, email }
  for (const u of [...seed.admins, ...seed.non_admins]) {
    const { rows } = await pool.query("select id from auth.users where email = $1", [u.email]);
    const id = rows[0]?.id ?? randomUUID();
    if (!rows[0]) await pool.query("insert into auth.users (id, email) values ($1, $2)", [id, u.email]);
    if (u.display_name) {
      await pool.query(
        "insert into public.admin_users (user_id, display_name) values ($1, $2) on conflict (user_id) do nothing",
        [id, u.display_name],
      );
    }
    users.set(u.email, { id, password: u.password, email: u.email });
  }
  const HTTP_PORT = port;

  // ---------------------------------------------------------------------------
  // JWT（HS256、ローカル専用）
  // ---------------------------------------------------------------------------
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  function sign(payload) {
    const head = `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}`;
    return `${head}.${createHmac("sha256", JWT_SECRET).update(head).digest("base64url")}`;
  }
  function verify(token) {
    const [h, p, s] = String(token).split(".");
    if (!h || !p || !s) return null;
    const expected = createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest();
    const actual = Buffer.from(s, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    return payload.exp * 1000 > Date.now() ? payload : null;
  }

  function userObject(u) {
    return {
      id: u.id,
      aud: "authenticated",
      role: "authenticated",
      email: u.email,
      app_metadata: { provider: "email" },
      user_metadata: {},
      created_at: "2026-01-01T00:00:00Z",
    };
  }
  function session(u) {
    const now = Math.floor(Date.now() / 1000);
    const access_token = sign({ sub: u.id, role: "authenticated", aud: "authenticated", email: u.email, iat: now, exp: now + 3600 });
    return {
      access_token,
      token_type: "bearer",
      expires_in: 3600,
      expires_at: now + 3600,
      refresh_token: Buffer.from(`${u.email}:${now}`).toString("base64url"),
      user: userObject(u),
    };
  }

  // ---------------------------------------------------------------------------
  // リクエストの実行ロール
  // ---------------------------------------------------------------------------
  function resolveRole(req) {
    const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const apikey = req.headers.apikey ?? "";
    const token = bearer || apikey;
    if (token === seed.keys.secret) return { role: "service_role", sub: null };
    if (token === seed.keys.publishable) return { role: "anon", sub: null };
    const payload = verify(token);
    if (payload) return { role: "authenticated", sub: payload.sub };
    return null;
  }

  function requestHeaders(req) {
    const h = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
    if (!h["x-forwarded-for"] && !h["cf-connecting-ip"]) h["x-forwarded-for"] = req.socket.remoteAddress ?? "unknown";
    delete h.authorization;
    delete h.apikey;
    delete h.cookie;
    return h;
  }

  async function asRole({ role, sub, headers = {} }, fn) {
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query(`set local role ${role}`);
      await c.query("select set_config('request.jwt.claims', $1, true)", [sub ? JSON.stringify({ sub, role }) : ""]);
      await c.query("select set_config('request.headers', $1, true)", [JSON.stringify(headers)]);
      const r = await fn(c);
      await c.query("commit");
      return r;
    } catch (e) {
      await c.query("rollback").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  // ---------------------------------------------------------------------------
  // PostgREST サブセット
  // ---------------------------------------------------------------------------
  const IDENT = /^[a-z_][a-z0-9_]*$/;
  const COLUMN = /^([a-z_][a-z0-9_]*)(?:->>([a-z_][a-z0-9_]*))?$/;

  function col(name) {
    const m = COLUMN.exec(name);
    if (!m) throw Object.assign(new Error(`invalid column ${name}`), { status: 400 });
    return m[2] ? `"${m[1]}"->>'${m[2]}'` : `"${m[1]}"`;
  }

  function parseInList(v) {
    const inner = v.replace(/^\(/, "").replace(/\)$/, "");
    return inner.length ? inner.split(",").map((s) => s.replace(/^"|"$/g, "")) : [];
  }

  function buildWhere(params, values) {
    const clauses = [];
    for (const [key, raw] of params) {
      if (["select", "order", "limit", "offset"].includes(key)) continue;
      const dot = raw.indexOf(".");
      const op = raw.slice(0, dot);
      const v = raw.slice(dot + 1);
      const c = col(key);
      const ops = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" };
      if (ops[op]) {
        values.push(v);
        clauses.push(`${c} ${ops[op]} $${values.length}`);
      } else if (op === "in") {
        values.push(parseInList(v));
        clauses.push(`${c}::text = any($${values.length}::text[])`);
      } else if (op === "is" && v === "null") {
        clauses.push(`${c} is null`);
      } else {
        throw Object.assign(new Error(`unsupported operator ${op}`), { status: 400 });
      }
    }
    return clauses.length ? ` where ${clauses.join(" and ")}` : "";
  }

  async function handleSelect(req, res, auth, table, url) {
    if (!IDENT.test(table)) return send(res, 404, { message: "not found" });
    const params = [...url.searchParams.entries()];
    const select = url.searchParams.get("select") ?? "*";
    const cols = select === "*" ? "*" : select.split(",").map((s) => col(s.trim())).join(", ");
    const values = [];
    const where = buildWhere(params, values);
    const order = url.searchParams.get("order");
    const orderSql = order
      ? ` order by ${order
          .split(",")
          .map((part) => {
            const [c, dir, nulls] = part.split(".");
            return `${col(c)} ${dir === "desc" ? "desc" : "asc"}${nulls === "nullsfirst" ? " nulls first" : nulls === "nullslast" ? " nulls last" : ""}`;
          })
          .join(", ")}`
      : "";
    const limit = url.searchParams.get("limit");
    const offset = url.searchParams.get("offset");
    const limitSql = `${limit ? ` limit ${Number(limit)}` : ""}${offset ? ` offset ${Number(offset)}` : ""}`;
    const wantCount = /count=exact/.test(req.headers.prefer ?? "");
    const wantObject = /vnd\.pgrst\.object/.test(req.headers.accept ?? "");

    const { rows, total } = await asRole(auth, async (c) => {
      const r = await c.query(`select ${cols} from public."${table}"${where}${orderSql}${limitSql}`, values);
      const t = wantCount ? (await c.query(`select count(*)::int as n from public."${table}"${where}`, values)).rows[0].n : null;
      return { rows: r.rows, total: t };
    });

    const start = Number(offset ?? 0);
    const headers = { "content-range": `${rows.length ? `${start}-${start + rows.length - 1}` : "*"}/${total ?? "*"}` };
    if (wantObject) {
      if (rows.length !== 1) return send(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
      return send(res, 200, rows[0], headers);
    }
    return send(res, 200, rows, headers);
  }

  async function handleRpc(req, res, auth, fn) {
    if (!IDENT.test(fn)) return send(res, 404, { message: "not found" });
    const body = await readJson(req);
    const names = Object.keys(body);
    if (!names.every((n) => IDENT.test(n))) return send(res, 400, { message: "invalid argument" });
    const args = names.map((n, i) => `"${n}" => $${i + 1}`).join(", ");
    const result = await asRole(auth, (c) => c.query(`select public."${fn}"(${args}) as r`, names.map((n) => body[n])));
    return send(res, 200, result.rows[0].r);
  }

  // ---------------------------------------------------------------------------
  // GoTrue サブセット
  // ---------------------------------------------------------------------------
  async function handleAuth(req, res, url) {
    const p = url.pathname.replace(/^\/auth\/v1/, "");
    if (p === "/token" && req.method === "POST") {
      const body = await readJson(req);
      const grant = url.searchParams.get("grant_type");
      if (grant === "password") {
        const u = users.get(String(body.email ?? "").toLowerCase());
        if (!u || u.password !== body.password) {
          return send(res, 400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
        }
        return send(res, 200, session(u));
      }
      if (grant === "refresh_token") {
        const email = Buffer.from(String(body.refresh_token ?? ""), "base64url").toString().split(":")[0];
        const u = users.get(email);
        return u ? send(res, 200, session(u)) : send(res, 400, { error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
      }
    }
    if (p === "/user" && req.method === "GET") {
      const payload = verify((req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""));
      const u = payload && [...users.values()].find((x) => x.id === payload.sub);
      return u ? send(res, 200, userObject(u)) : send(res, 401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
    }
    if (p === "/logout") {
      res.writeHead(204).end();
      return;
    }
    if (p === "/signup") return send(res, 422, { error_code: "signup_disabled", msg: "Signups not allowed for this instance" });
    return send(res, 404, { msg: "not found" });
  }

  // ---------------------------------------------------------------------------
  // HTTP
  // ---------------------------------------------------------------------------
  function send(res, status, body, headers = {}) {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  }
  function readJson(req) {
    return new Promise((resolve) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch {
          resolve({});
        }
      });
    });
  }


  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${HTTP_PORT}`);
    try {
      if (url.pathname.startsWith("/auth/v1/")) return await handleAuth(req, res, url);
      const auth = resolveRole(req);
      if (!auth) return send(res, 401, { code: "PGRST301", message: "JWT invalid" });
      auth.headers = requestHeaders(req);
      const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([^/]+)$/);
      if (rpc && req.method === "POST") return await handleRpc(req, res, auth, rpc[1]);
      const table = url.pathname.match(/^\/rest\/v1\/([^/]+)$/);
      if (table && req.method === "GET") return await handleSelect(req, res, auth, table[1], url);
      return send(res, 404, { message: "not found" });
    } catch (e) {
      const status = e.status ?? (e.code === "42501" ? 403 : 400);
      // エミュレーターのログにも入力値を出さない（コードのみ）
      if (!process.env.VITEST) console.error(`[emulator] ${req.method} ${url.pathname.replace(/\/rest\/v1\/rpc\//, "rpc:")} -> ${status} ${e.code ?? ""}`);
      return send(res, status, { code: e.code ?? "", message: e.message, details: null, hint: null });
    }
  });

  await new Promise((resolve) => server.listen(HTTP_PORT, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${HTTP_PORT}`,
    users,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
