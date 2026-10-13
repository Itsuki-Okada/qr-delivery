import { createDemoBackend, DEMO_ACCOUNTS, type KeyValueStorage } from "@/lib/backend/demo";
import { defineBackendContract } from "../contract/backend-contract";

function memoryStorage(): KeyValueStorage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

defineBackendContract("デモ（ブラウザ内保存）", async () => ({
  backend: createDemoBackend({ data: memoryStorage(), session: memoryStorage() }),
  admin: { email: DEMO_ACCOUNTS[0].email, password: DEMO_ACCOUNTS[0].password, displayName: DEMO_ACCOUNTS[0].displayName },
}));
