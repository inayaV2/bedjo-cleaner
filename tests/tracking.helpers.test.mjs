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

// ---------------------------------------------------------------------------
// Add Product feature -- item_kind='product' TIDAK PERNAH punya business
// line/jenis layanan/cabang pengerjaan laundry. isProductTrackingItem +
// renderOrderItems (baris Jenis Usaha/Jenis Layanan/Cabang Pengerjaan
// dihilangkan sama sekali untuk produk, bukan diisi fallback fabrikasi
// "Bedjo Cleaner"/"Cuci") harus terbukti lewat HTML yang benar-benar
// dihasilkan, bukan cuma helper murni.
// ---------------------------------------------------------------------------

test("isProductTrackingItem: true hanya untuk item_kind='product'", () => {
  assert.equal(mod.isProductTrackingItem({ item_kind: "product" }), true);
  assert.equal(mod.isProductTrackingItem({ item_kind: "PRODUCT" }), true);
  assert.equal(mod.isProductTrackingItem({ item_kind: "service" }), false);
  assert.equal(mod.isProductTrackingItem({}), false);
});

function loadTrackingModuleForItemsTests() {
  const itemsList = stubElement();
  const elementsById = { "order-items-list": itemsList };

  const sandbox = {
    console,
    URLSearchParams,
    fetch: async () => ({ ok: false }),
    window: {},
    document: {
      addEventListener: () => {},
      getElementById: (id) => elementsById[id] || stubElement(),
      querySelectorAll: () => [],
      createElement: () => stubElement(),
    },
  };
  sandbox.window.location = { search: "", pathname: "/" };
  sandbox.window.history = { replaceState: () => {} };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "tracking.js" });
  return { mod: sandbox, itemsList };
}

test("renderOrderItems: item produk TIDAK menampilkan Bedjo Cleaner/Cuci fabrikasi", () => {
  const { mod: itemsMod, itemsList } = loadTrackingModuleForItemsTests();

  itemsMod.renderOrderItems(
    [
      {
        item_kind: "product",
        item_type: "Paperbag",
        service_id: null,
        service_type: null,
        services: null,
        handling_type: null,
        handling_branch_id: null,
        handling_branch_name: null,
        quantity: 3,
        price: 5000,
        subtotal: 15000,
        notes: "Bungkus rapi",
        status: "active",
      },
    ],
    "Bedjo BEST",
  );

  const html = itemsList.innerHTML;
  assert.ok(html.includes("Paperbag"), "nama produk harus tampil");
  assert.ok(html.includes("3 x"), "qty harus tampil");
  assert.ok(html.includes("Rp 5.000"), "harga satuan harus tampil");
  assert.ok(html.includes("Rp 15.000"), "subtotal harus tampil");
  assert.ok(html.includes("Bungkus rapi"), "catatan harus tampil");
  assert.ok(!html.includes("Jenis Usaha"), "baris Jenis Usaha harus dihilangkan untuk produk");
  assert.ok(!html.includes("Jenis Layanan"), "baris Jenis Layanan harus dihilangkan untuk produk");
  assert.ok(!html.includes("Cabang Pengerjaan"), "baris Cabang Pengerjaan harus dihilangkan untuk produk");
  assert.ok(!html.includes("Bedjo Cleaner"), "tidak boleh fabrikasi Bedjo Cleaner untuk produk");
  assert.ok(!html.includes(">Cuci<"), "tidak boleh fabrikasi label Cuci untuk produk");
  assert.ok(!html.includes("undefined"), "tidak boleh ada 'undefined' di HTML");
  assert.ok(!html.includes(">null<"), "tidak boleh ada 'null' mentah di HTML");
});

test("renderOrderItems: item service TETAP tampil Jenis Usaha/Jenis Layanan/Cabang Pengerjaan seperti sebelumnya", () => {
  const { mod: itemsMod, itemsList } = loadTrackingModuleForItemsTests();

  itemsMod.renderOrderItems(
    [
      {
        item_kind: "service",
        item_type: "Sepatu",
        service_id: "svc-1",
        service_type: "Regular Clean Shoes",
        services: {
          name: "Regular Clean Shoes - Canvas",
          business_line: "bedjo_cleaner",
        },
        handling_type: "cuci",
        quantity: 1,
        price: 60000,
        subtotal: 60000,
        status: "active",
      },
    ],
    "Bedjo BEST",
  );

  const html = itemsList.innerHTML;
  assert.ok(html.includes("Jenis Usaha"), "item service tetap menampilkan Jenis Usaha");
  assert.ok(html.includes("Jenis Layanan"), "item service tetap menampilkan Jenis Layanan");
  assert.ok(html.includes("Cabang Pengerjaan"), "item service tetap menampilkan Cabang Pengerjaan");
  assert.ok(html.includes("Bedjo Cleaner"), "item service tetap menampilkan business line Bedjo Cleaner");
  assert.ok(html.includes(">Cuci<"), "item service tetap menampilkan label Cuci");
});

test("renderOrderItems: item produk tanpa catatan aman (tidak ada baris Catatan kosong, tidak error)", () => {
  const { mod: itemsMod, itemsList } = loadTrackingModuleForItemsTests();

  assert.doesNotThrow(() => {
    itemsMod.renderOrderItems(
      [
        {
          item_kind: "product",
          item_type: "Kantong Plastik Besar",
          service_id: null,
          service_type: null,
          services: null,
          handling_type: null,
          quantity: 1,
          price: 3000,
          subtotal: 3000,
          status: "active",
        },
      ],
      "Bedjo BEST",
    );
  });

  const html = itemsList.innerHTML;
  assert.ok(html.includes("Kantong Plastik Besar"));
  assert.ok(!html.includes("undefined"));
  assert.ok(!html.includes(">null<"));
});

// ---------------------------------------------------------------------------
// STEP 22D -- renderPhoto/buildPhotoElement: fallback foto hilang/gagal.
//
// stubElement() di atas (dipakai loadTrackingModule() untuk test lain)
// sengaja TIDAK mendukung createElement/appendChild/replaceWith/
// addEventListener secara stateful -- supaya test lain tidak berubah
// perilakunya, blok ini memakai loader + fake DOM node TERPISAH, khusus
// untuk menguji manipulasi DOM foto (bukan cuma fungsi murni).
// ---------------------------------------------------------------------------

function createFakeNode(tag) {
  const listeners = {};
  let innerHtmlValue = "";
  const node = {
    tagName: String(tag || "").toUpperCase(),
    children: [],
    parentNode: null,
    className: "",
    textContent: "",
    src: "",
    alt: "",
    loading: "",
    classList: {
      _set: new Set(),
      add(c) {
        this._set.add(c);
      },
      remove(c) {
        this._set.delete(c);
      },
      contains(c) {
        return this._set.has(c);
      },
    },
    addEventListener(type, cb) {
      (listeners[type] ||= []).push(cb);
    },
    appendChild(child) {
      node.children.push(child);
      child.parentNode = node;
      return child;
    },
    replaceWith(newNode) {
      const parent = node.parentNode;
      if (!parent) return;
      const idx = parent.children.indexOf(node);
      if (idx !== -1) {
        parent.children[idx] = newNode;
        newNode.parentNode = parent;
        node.parentNode = null;
      }
    },
    // Test-only helper -- mensimulasikan browser memicu event "error" pada
    // <img> ini (object Storage sudah dihapus / signed URL sudah expired
    // setelah response dibuat).
    _fireError() {
      (listeners.error || []).forEach((cb) => cb());
    },
  };
  Object.defineProperty(node, "innerHTML", {
    get() {
      return innerHtmlValue;
    },
    set(value) {
      innerHtmlValue = value;
      node.children = [];
    },
  });
  return node;
}

function loadTrackingModuleForPhotoTests() {
  const grid = createFakeNode("div");
  const noPhotoTemplate = createFakeNode("div");
  noPhotoTemplate.classList.add("hidden");

  const elementsById = {
    "order-photos-grid": grid,
    "no-photo": noPhotoTemplate,
  };

  const sandbox = {
    console,
    URLSearchParams,
    fetch: async () => ({ ok: false }),
    window: {},
    document: {
      addEventListener: () => {},
      getElementById: (id) => elementsById[id] || stubElement(),
      querySelectorAll: () => [],
      createElement: (tag) => createFakeNode(tag),
    },
  };
  sandbox.window.location = { search: "", pathname: "/" };
  sandbox.window.history = { replaceState: () => {} };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "tracking.js" });
  return { mod: sandbox, grid, noPhotoTemplate };
}

test("photos: [] -> placeholder 'Tidak ada foto' ditampilkan", () => {
  const { mod, grid, noPhotoTemplate } = loadTrackingModuleForPhotoTests();

  mod.renderPhoto({ order_photos: [] });

  assert.ok(grid.children.includes(noPhotoTemplate));
  assert.equal(noPhotoTemplate.classList.contains("hidden"), false);
});

test("satu signed_url null -> 'Foto tidak tersedia'", () => {
  const { mod, grid } = loadTrackingModuleForPhotoTests();

  mod.renderPhoto({ order_photos: [{ signed_url: null }] });

  assert.equal(grid.children.length, 1);
  assert.equal(grid.children[0].className, "no-photo");
  assert.equal(grid.children[0].textContent, "Foto tidak tersedia");
});

test("SEMUA signed_url null -> semua jadi placeholder, tidak ada <img>", () => {
  const { mod, grid } = loadTrackingModuleForPhotoTests();

  mod.renderPhoto({
    order_photos: [{ signed_url: null }, { signed_url: null }],
  });

  assert.equal(grid.children.length, 2);
  for (const child of grid.children) {
    assert.equal(child.className, "no-photo");
    assert.equal(child.textContent, "Foto tidak tersedia");
    assert.notEqual(child.tagName, "IMG");
  }
});

test("signed_url valid -> tetap render <img> normal", () => {
  const { mod, grid } = loadTrackingModuleForPhotoTests();

  mod.renderPhoto({
    order_photos: [{ signed_url: "https://signed.example/a.jpg" }],
  });

  assert.equal(grid.children.length, 1);
  assert.equal(grid.children[0].tagName, "IMG");
  assert.equal(grid.children[0].src, "https://signed.example/a.jpg");
  assert.equal(grid.children[0].alt, "Foto item 1");
});

test("kegagalan load <img> saat runtime -> gambar itu berubah jadi placeholder", () => {
  const { mod, grid } = loadTrackingModuleForPhotoTests();

  mod.renderPhoto({
    order_photos: [{ signed_url: "https://signed.example/a.jpg" }],
  });

  const img = grid.children[0];
  assert.equal(img.tagName, "IMG");

  // Simulasikan browser gagal memuat <img> (404/403/URL expired).
  img._fireError();

  assert.equal(grid.children.length, 1);
  assert.equal(grid.children[0].className, "no-photo");
  assert.equal(grid.children[0].textContent, "Foto tidak tersedia");
  assert.notEqual(grid.children[0], img);
});

test("satu <img> gagal load TIDAK mempengaruhi foto lain yang masih valid", () => {
  const { mod, grid } = loadTrackingModuleForPhotoTests();

  mod.renderPhoto({
    order_photos: [
      { signed_url: "https://signed.example/a.jpg" },
      { signed_url: "https://signed.example/b.jpg" },
    ],
  });

  assert.equal(grid.children.length, 2);
  const [imgA, imgB] = grid.children;
  assert.equal(imgA.tagName, "IMG");
  assert.equal(imgB.tagName, "IMG");

  imgA._fireError();

  assert.equal(grid.children.length, 2);
  assert.equal(grid.children[0].className, "no-photo");
  // Foto kedua tidak diganti/disentuh sama sekali -- object <img> yang
  // sama, src tetap utuh.
  assert.equal(grid.children[1], imgB);
  assert.equal(grid.children[1].tagName, "IMG");
  assert.equal(grid.children[1].src, "https://signed.example/b.jpg");
});

test("renderPhoto tidak pernah throw untuk kombinasi foto valid/null/gagal -- sisa halaman tracking tetap bisa lanjut render", () => {
  const { mod } = loadTrackingModuleForPhotoTests();

  assert.doesNotThrow(() => {
    mod.renderPhoto({
      order_photos: [
        { signed_url: "https://signed.example/a.jpg" },
        { signed_url: null },
        {},
      ],
    });
  });
});
