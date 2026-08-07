// Test ringan untuk helper murni di js/admin-export.js (matematika rentang
// tanggal WIB dipakai untuk preset + validasi klien -- versi otoritatif ada
// di supabase/functions/export-data/helpers.ts, tapi logic klien ini
// SENGAJA di-mirror manual untuk UX cepat, jadi perlu di-test terpisah
// supaya kedua sisi tidak diam-diam berbeda).
//
// Pola sandbox sama seperti tests/tracking.helpers.test.mjs -- repo ini
// belum punya test runner/framework, jadi memakai node:test + node:vm
// bawaan Node untuk memuat js/admin-export.js apa adanya dengan stub DOM
// minimal, lalu memanggil langsung fungsi murninya.
//
// Jalankan: node tests/admin-export.helpers.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(__dirname, "..", "js", "admin-export.js");
const code = fs.readFileSync(scriptPath, "utf8");

function stubElement() {
  const classList = new Set();
  return {
    textContent: "",
    innerHTML: "",
    value: "",
    disabled: false,
    dataset: {},
    classList: {
      add: (c) => classList.add(c),
      remove: (c) => classList.delete(c),
      toggle: (c, force) => {
        if (force === undefined) {
          classList.has(c) ? classList.delete(c) : classList.add(c);
        } else if (force) {
          classList.add(c);
        } else {
          classList.delete(c);
        }
      },
      contains: (c) => classList.has(c),
    },
    addEventListener: () => {},
    appendChild: () => {},
    remove: () => {},
    click: () => {},
  };
}

function loadAdminExportModule() {
  const storage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  const sandbox = {
    console,
    fetch: async () => ({ ok: false }),
    URL: { createObjectURL: () => "blob://fake", revokeObjectURL: () => {} },
    sessionStorage: storage,
    localStorage: storage,
    document: {
      addEventListener: () => {},
      getElementById: () => stubElement(),
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => stubElement(),
      body: { appendChild: () => {} },
    },
  };
  sandbox.window = { location: { href: "" }, innerWidth: 1200 };
  sandbox.window.BEDJO_SUPABASE_URL = "https://example.supabase.co";
  sandbox.window.BEDJO_SUPABASE_ANON_KEY = "anon-key";
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "admin-export.js" });
  return sandbox;
}

const mod = loadAdminExportModule();

test("inclusiveDaySpan: tanggal sama = 1 hari", () => {
  assert.equal(mod.inclusiveDaySpan("2026-08-07", "2026-08-07"), 1);
});

test("inclusiveDaySpan: 2026-07-30 s/d 2026-08-03 = 5 hari (lintas bulan)", () => {
  assert.equal(mod.inclusiveDaySpan("2026-07-30", "2026-08-03"), 5);
});

test("inclusiveDaySpan: end sebelum start -> negatif/0 (invalid, ditolak pemanggil)", () => {
  assert.equal(mod.inclusiveDaySpan("2026-08-07", "2026-08-01"), -5);
});

test("inclusiveDaySpan: tepat 31 hari (2026-08-01 s/d 2026-08-31)", () => {
  assert.equal(mod.inclusiveDaySpan("2026-08-01", "2026-08-31"), 31);
});

test("addDaysToIsoDate: mundur melewati batas bulan", () => {
  assert.equal(mod.addDaysToIsoDate("2026-08-01", -1), "2026-07-31");
});

test("addDaysToIsoDate: maju melewati batas tahun", () => {
  assert.equal(mod.addDaysToIsoDate("2026-12-31", 1), "2027-01-01");
});

test("firstDayOfMonth: mengambil tanggal 01 di bulan yang sama", () => {
  assert.equal(mod.firstDayOfMonth("2026-08-07"), "2026-08-01");
});

test("escapeHtml: mencegah HTML injection sederhana pada nama cabang", () => {
  assert.equal(
    mod.escapeHtml('<img src=x onerror="alert(1)">'),
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
  );
});
