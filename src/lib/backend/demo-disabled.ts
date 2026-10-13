// 本番ビルドでは @/lib/backend/demo をこのスタブに置き換える（next.config.ts の resolveAlias）。
// デモ用のコード・アカウント情報を本番の配布物に含めないため。
import type { Backend } from "./types";

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const DEMO_ACCOUNTS: readonly { email: string; password: string; displayName: string }[] = [];

export function createDemoBackend(opts: unknown): Backend & { reset(): void } {
  void opts;
  throw new Error("デモモードはこのビルドでは無効です");
}
