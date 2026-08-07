// Test ringan untuk helper murni di js/admin-cleanup.js (retensi 60 hari,
// escapeHtml) -- pola sandbox sama seperti tests/admin-export.helpers.test.mjs.
//
// Jalankan: node tests/admin-cleanup.helpers.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(__dirname, "..", "js", "admin-cleanup.js");
const code = fs.readFileSync(scriptPath, "utf8");

function stubElement() {
  const classList = new Set();
  return {
    textContent: "",
    innerHTML: "",
    disabled: false,
    dataset: {},
    style: {},
    classList: {
      add: (c) => classList.add(c),
      remove: (c) => classList.delete(c),
      contains: (c) => classList.has(c),
    },
    addEventListener: () => {},
  };
}

function loadAdminCleanupModule() {
  const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const sandbox = {
    console,
    fetch: async () => ({ ok: false }),
    sessionStorage: storage,
    localStorage: storage,
    document: {
      addEventListener: () => {},
      getElementById: () => stubElement(),
      querySelectorAll: () => [],
    },
  };
  sandbox.window = { location: { href: "" }, innerWidth: 1200 };
  sandbox.window.BEDJO_SUPABASE_URL = "https://example.supabase.co";
  sandbox.window.BEDJO_SUPABASE_ANON_KEY = "anon-key";
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "admin-cleanup.js" });
  return sandbox;
}

const mod = loadAdminCleanupModule();

test("addDaysToIsoDate: contoh dari spec -- 17 Aug 2026 + 60 hari = 16 Oct 2026", () => {
  assert.equal(mod.addDaysToIsoDate("2026-08-17", 60), "2026-10-16");
});

test("addDaysToIsoDate: mundur melewati batas bulan", () => {
  assert.equal(mod.addDaysToIsoDate("2026-08-01", -1), "2026-07-31");
});

test("todayWib: mengembalikan format YYYY-MM-DD", () => {
  assert.match(mod.todayWib(), /^\d{4}-\d{2}-\d{2}$/);
});

test("escapeHtml: mencegah HTML injection pada nama cabang", () => {
  assert.equal(
    mod.escapeHtml('<img src=x onerror="alert(1)">'),
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
  );
});
