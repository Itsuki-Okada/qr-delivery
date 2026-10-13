import { randomBytes, randomUUID, createHash } from "node:crypto";
import pg from "pg";
import { inject } from "vitest";

export type Role = "anon" | "authenticated" | "service_role";

export interface TestDb {
  pool: pg.Pool;
  /** 指定ロール（＋JWT の sub）で 1 トランザクション内の処理を実行する。Supabase の PostgREST と同じ振る舞い。 */
  as<T>(role: Role, sub: string | null, fn: (c: pg.PoolClient) => Promise<T>, headers?: Record<string, string>): Promise<T>;
  /** 指定ロールで 1 クエリを実行する */
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    role: Role,
    sub: string | null,
    sql: string,
    params?: unknown[],
  ): Promise<pg.QueryResult<T>>;
  close(): Promise<void>;
}

function connString(port: number, db: string) {
  return `postgres://postgres:postgres@127.0.0.1:${port}/${db}`;
}

/** テンプレートから独立したテスト用 DB を作成する */
export async function createTestDb(): Promise<TestDb> {
  const port = inject("pgPort");
  const name = `t_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: connString(port, "postgres") });
  await admin.connect();
  await admin.query(`create database ${name} template qr_template`);
  await admin.end();

  const pool = new pg.Pool({ connectionString: connString(port, name), max: 40 });

  async function as<T>(
    role: Role,
    sub: string | null,
    fn: (c: pg.PoolClient) => Promise<T>,
    headers: Record<string, string> = {},
  ) {
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query(`set local role ${role}`);
      await c.query("select set_config('request.jwt.claims', $1, true)", [
        sub ? JSON.stringify({ sub, role }) : "",
      ]);
      // PostgREST と同様にリクエストヘッダーを request.headers に設定する
      await c.query("select set_config('request.headers', $1, true)", [JSON.stringify(headers)]);
      const result = await fn(c);
      await c.query("commit");
      return result;
    } catch (e) {
      await c.query("rollback").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  return {
    pool,
    as,
    query: (role, sub, sql, params) => as(role, sub, (c) => c.query(sql, params)),
    async close() {
      await pool.end();
      const a = new pg.Client({ connectionString: connString(port, "postgres") });
      await a.connect();
      await a.query(`drop database if exists ${name} with (force)`);
      await a.end();
    },
  };
}

/** auth.users と admin_users に管理者を作成する（スーパーユーザーで直接挿入） */
export async function createAdmin(db: TestDb, opts: { active?: boolean; name?: string } = {}) {
  const id = randomUUID();
  await db.pool.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@example.test`]);
  await db.pool.query(
    "insert into public.admin_users (user_id, display_name, is_active) values ($1, $2, $3)",
    [id, opts.name ?? "管理者", opts.active ?? true],
  );
  return id;
}

/** 管理者ではない認証済みユーザーを作成する */
export async function createPlainUser(db: TestDb) {
  const id = randomUUID();
  await db.pool.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@example.test`]);
  return id;
}

export function newToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: createHash("sha256").update(token).digest("hex") };
}

export function sha256Hex(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

/** 管理者として QR を発行する（トークンは DB が生成して 1 度だけ返す） */
export async function issue(db: TestDb, adminId: string) {
  const { rows } = await db.query<{ r: { id: string; serial_no: number; token: string } }>(
    "authenticated",
    adminId,
    "select public.issue_qr_code() as r",
  );
  const { id, serial_no, token } = rows[0].r;
  return { token, hash: sha256Hex(token), id, serial: serial_no };
}

export const sampleAddress = {
  recipient_name: "山田 太郎",
  postal_code: "100-0001",
  prefecture: "東京都",
  city: "千代田区",
  address_line: "千代田1-1",
  building: "テストビル101",
  phone: "09012345678",
};

export type AddressInput = typeof sampleAddress;

export function redeemSql() {
  return "select public.redeem_qr_code($1,$2,$3,$4,$5,$6,$7,$8) as result";
}

export function redeemParams(hash: string, a: AddressInput = sampleAddress) {
  return [hash, a.recipient_name, a.postal_code, a.prefecture, a.city, a.address_line, a.building, a.phone];
}

export async function redeem(db: TestDb, hash: string, a: AddressInput = sampleAddress) {
  const { rows } = await db.query<{ result: string }>("service_role", null, redeemSql(), redeemParams(hash, a));
  return rows[0].result;
}
