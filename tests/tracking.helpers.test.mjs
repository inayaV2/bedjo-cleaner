// Test ringan untuk helper murni di js/tracking.js (diskon, jenis layanan
// Cuci/Service, cabang pengerjaan, item batal).
//
// Repo ini belum punya test runner/framework (tidak ada package.json/jest).
// Daripada menambah dependency besar, test ini memakai modul bawaan Node
// (node:test, node:assert, node:vm) untuk memuat js/tracking.js apa adanya
// di dalam sandbox dengan stub DOM minimal, lalu memanggil langsung
// fungsi-fungsi murni yang sudah dipisahkan dari manipulasi DOM
// (resolveDiscountDisplay, itemHandlingType, itemHandlingLabel,
// itemHandlingBranchLabel, itemStatusLabel, formatRupiah, dll).
//
// Jalankan: node tests/tracking.helpers.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(__dirname, "..", "js", "tracking.js");
const code = fs.readFileSync(scriptPath, "utf8");

function stubElement() {
  const classList = new Set();
  return {
    textContent: "",
    className: "",
    href: "",
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
    appendChild: () => {},
    querySelector: () => null,
  };
}

function loadTrackingModule() {
  const sandbox = {
    console,
    URLSearchParams,
    fetch: async () => ({ ok: false }),
    window: {},
    document: {
      addEventListener: () => {},
      getElementById: () => stubElement(),
      querySelectorAll: () => [],
      createElement: () => stubElement(),
    },
  };
  sandbox.window.location = { search: "", pathname: "/" };
  sandbox.window.history = { replaceState: () => {} };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "tracking.js" });
  return sandbox;
}

const mod = loadTrackingModule();

test("diskon nonaktif tidak tampil (resolveDiscountDisplay null)", () => {
  assert.equal(
    mod.resolveDiscountDisplay({ discount_enabled: false, discount_amount: 10000 }),
    null,
  );
  assert.equal(
    mod.resolveDiscountDisplay({ discount_enabled: true, discount_amount: 0 }),
    null,
  );
  // Data lama tanpa field discount_* sama sekali -> aman, tidak error.
  assert.equal(mod.resolveDiscountDisplay({}), null);
});

test("diskon Rp dirender benar", () => {
  const result = mod.resolveDiscountDisplay({
    discount_enabled: true,
    discount_type: "amount",
    discount_value: 10000,
    discount_amount: 10000,
  });
  assert.equal(result.label, "Diskon");
  assert.equal(result.formattedValue, `-${mod.formatRupiah(10000)}`);
});

test("diskon % dirender benar", () => {
  const result = mod.resolveDiscountDisplay({
    discount_enabled: true,
    discount_type: "percent",
    discount_value: 10,
    discount_amount: 10000,
  });
  assert.equal(result.label, "Diskon 10%");
  assert.equal(result.formattedValue, `-${mod.formatRupiah(10000)}`);
});

test("item Cuci dan Service dirender benar, data lama fallback ke Cuci", () => {
  assert.equal(mod.itemHandlingLabel({ handling_type: "service" }), "Service");
  assert.equal(mod.itemHandlingLabel({ handling_type: "cuci" }), "Cuci");
  assert.equal(mod.itemHandlingLabel({ handling_type: null }), "Cuci");
  assert.equal(mod.itemHandlingLabel({}), "Cuci");
});

test("cabang pengerjaan memakai hasil API, bukan literal Ciwalk", () => {
  const label = mod.itemHandlingBranchLabel(
    { handling_branch_id: "abc-123", handling_branch_name: "Bedjo Workshop" },
    "Bedjo BEC",
  );
  assert.equal(label, "Bedjo Workshop");
  assert.notEqual(label, "Ciwalk");
});

test("handling_branch_id null -> fallback ke cabang asal order", () => {
  const label = mod.itemHandlingBranchLabel(
    { handling_branch_id: null, handling_branch_name: null },
    "Bedjo BEC",
  );
  assert.equal(label, "Bedjo BEC");
});

test("handling_branch_id ada tapi tidak resolve -> Cabang tidak diketahui", () => {
  const label = mod.itemHandlingBranchLabel(
    { handling_branch_id: "unknown-id", handling_branch_name: null },
    "Bedjo BEC",
  );
  assert.equal(label, "Cabang tidak diketahui");
});

test("data lama tanpa handling_branch_id/handling_type sama sekali aman", () => {
  assert.equal(mod.itemHandlingLabel({}), "Cuci");
  assert.equal(mod.itemHandlingBranchLabel({}, "Bedjo BEC"), "Bedjo BEC");
  assert.equal(mod.itemHandlingBranchLabel({}, null), "-");
});

test("status item: aktif vs dibatalkan", () => {
  assert.equal(mod.itemStatusLabel({ status: "active" }), "Aktif");
  assert.equal(mod.itemStatusLabel({ status: "cancelled" }), "Dibatalkan");
  assert.equal(mod.itemStatusLabel({}), "Aktif");
});


test("business line label mendukung semua lini dan fallback data lama", () => {
  assert.equal(mod.itemBusinessLineLabel({ services: { business_line: "homecare" } }), "Homecare");
  assert.equal(mod.itemBusinessLineLabel({ services: { business_line: "helmet" } }), "Helmet");
  assert.equal(mod.itemBusinessLineLabel({ services: { business_line: "autocare_mobil" } }), "Autocare Mobil");
  assert.equal(mod.itemBusinessLineLabel({ services: { business_line: "autocare_motor" } }), "Autocare Motor");
  assert.equal(mod.itemBusinessLineLabel({ services: { business_line: "" } }), "Bedjo Cleaner");
  assert.equal(mod.itemBusinessLineLabel({}), "Bedjo Cleaner");
});

test("Premium Wash Motor tampil sebagai Premium Wash tanpa mengubah data sumber", () => {
  assert.equal(
    mod.itemServiceLabel({ services: { name: "Premium Wash (Motor)", business_line: "autocare_motor" } }, "Motor"),
    "Premium Wash",
  );
  assert.equal(
    mod.itemServiceLabel({ services: { name: "Premium Wash (Motor)", business_line: "autocare_mobil" } }, "Mobil"),
    "Premium Wash (Motor)",
  );
});

test("service description tampil sebagai Keterangan hanya jika tidak kosong", () => {
  assert.equal(
    mod.itemDescription({ services: { description: "Kategori: tas sedang, helm + jaket, kresek belanja" } }),
    "Kategori: tas sedang, helm + jaket, kresek belanja",
  );
  assert.equal(mod.itemDescription({ services: { description: null } }), "-");
  assert.equal(mod.itemDescription({ services: { description: "   " } }), "-");
});

test("description helper aman untuk Homecare/Helmet/Autocare dan data legacy", () => {
  assert.equal(mod.itemDescription({ services: { business_line: "homecare", description: "Sofa 1 sheet" } }), "Sofa 1 sheet");
  assert.equal(mod.itemDescription({ services: { business_line: "helmet", description: "Kategori: 1 helm" } }), "Kategori: 1 helm");
  assert.equal(mod.itemDescription({ services: { business_line: "autocare_mobil", description: "Small car" } }), "Small car");
  assert.equal(mod.itemDescription({ services: { business_line: "autocare_motor", description: null } }), "-");
  assert.equal(mod.itemDescription({}), "-");
});
test("tidak ada literal hardcode Ciwalk di source tracking.js", () => {
  assert.ok(
    !code.includes("Ciwalk"),
    "tracking.js tidak boleh mengandung string literal Ciwalk",
  );
});
