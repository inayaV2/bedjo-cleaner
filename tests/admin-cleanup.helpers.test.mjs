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

// ---------------------------------------------------------------------------
// STEP 22F.2 -- isCleanupConfirmationValid: fungsi murni untuk frasa
// konfirmasi ketik-ulang "HAPUS MEDIA", menggantikan checkbox lama.
// ---------------------------------------------------------------------------

test("isCleanupConfirmationValid: match persis diterima", () => {
  assert.equal(mod.isCleanupConfirmationValid("HAPUS MEDIA"), true);
});

test("isCleanupConfirmationValid: leading/trailing whitespace di-trim", () => {
  assert.equal(mod.isCleanupConfirmationValid("  HAPUS MEDIA  "), true);
});

test("isCleanupConfirmationValid: huruf kecil ditolak", () => {
  assert.equal(mod.isCleanupConfirmationValid("hapus media"), false);
});

test("isCleanupConfirmationValid: teks sebagian ditolak", () => {
  assert.equal(mod.isCleanupConfirmationValid("HAPUS"), false);
  assert.equal(mod.isCleanupConfirmationValid("MEDIA"), false);
});

test("isCleanupConfirmationValid: frasa lain ditolak", () => {
  assert.equal(mod.isCleanupConfirmationValid("HAPUS SEKARANG"), false);
});

test("isCleanupConfirmationValid: whitespace internal TIDAK di-trim (bukan match)", () => {
  // trim() hanya membuang spasi di ujung -- "HAPUS  MEDIA" (dua spasi di
  // tengah) BUKAN "HAPUS MEDIA" yang sah, harus tetap ditolak.
  assert.equal(mod.isCleanupConfirmationValid("HAPUS  MEDIA"), false);
});

test("isCleanupConfirmationValid: kosong/null/undefined ditolak", () => {
  assert.equal(mod.isCleanupConfirmationValid(""), false);
  assert.equal(mod.isCleanupConfirmationValid(null), false);
  assert.equal(mod.isCleanupConfirmationValid(undefined), false);
});

// ---------------------------------------------------------------------------
// STEP 22F.2 -- alur penuh openPreview -> confirmation input -> runRealCleanup,
// lewat fake DOM + fake supabaseClient/fetch (TIDAK PERNAH memanggil network
// sungguhan, apalagi production cleanup-media).
// ---------------------------------------------------------------------------

function createFakeNode() {
  return {
    value: "",
    textContent: "",
    disabled: false,
    dataset: {},
    style: {},
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
    addEventListener: () => {},
  };
}

const PREVIEW_SUMMARY_ELIGIBLE = {
  eligible: true,
  retention_until: "2026-10-05",
  order_photos: { files: 1, bytes: 168585 },
  attendance_selfies: { files: 0, bytes: 0 },
  payment_proofs: { files: 0, bytes: 0 },
  already_missing: 0,
  total_files: 1,
  total_bytes: 168585,
};

const REAL_RUN_RESULT = {
  deleted: 1,
  already_missing: 0,
  failed: 0,
  skipped_unsafe: 0,
  results: [],
};

function loadAdminCleanupModuleForConfirmTests({
  previewResponse = PREVIEW_SUMMARY_ELIGIBLE,
  previewOk = true,
  realResponse = REAL_RUN_RESULT,
} = {}) {
  const elementsById = {
    previewModal: createFakeNode(),
    previewLoading: createFakeNode(),
    previewContent: createFakeNode(),
    cleanupConfirmInput: createFakeNode(),
    confirmCleanupBtn: createFakeNode(),
    cleanupError: createFakeNode(),
    cleanupResultText: createFakeNode(),
    verificationsList: createFakeNode(),
    cleanupListError: createFakeNode(),
    previewOrderPhotos: createFakeNode(),
    previewAttendanceSelfies: createFakeNode(),
    previewPaymentProofs: createFakeNode(),
    previewMissing: createFakeNode(),
    previewTotal: createFakeNode(),
  };

  const capturedBodies = [];
  const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const supabaseClient = {
    auth: {
      getSession: async () => ({
        data: { session: { access_token: "fake-token-not-real" } },
      }),
    },
    // runRealCleanup() memanggil loadVerifications() lagi setelah sukses --
    // stub minimal supaya tidak melempar, TIDAK PERNAH menyentuh network.
    from: () => ({
      select: () => ({
        order: async () => ({ data: [], error: null }),
      }),
    }),
  };

  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    capturedBodies.push(body);
    if (body.dry_run === true) {
      return {
        ok: previewOk,
        json: async () => (previewOk ? previewResponse : { error: "internal_error" }),
      };
    }
    // dry_run:false -- SATU-SATUNYA yang boleh terjadi lewat runRealCleanup(),
    // dan di sini hanya menuju fetch STUB ini, TIDAK PERNAH jaringan sungguhan.
    return { ok: true, json: async () => realResponse };
  };

  const sandbox = {
    console,
    fetch: fetchImpl,
    sessionStorage: storage,
    localStorage: storage,
    supabaseClient,
    document: {
      addEventListener: () => {},
      getElementById: (id) => elementsById[id] ?? createFakeNode(),
      querySelectorAll: () => [],
    },
  };
  sandbox.window = { location: { href: "" }, innerWidth: 1200 };
  sandbox.window.BEDJO_SUPABASE_URL = "https://example.supabase.co";
  sandbox.window.BEDJO_SUPABASE_ANON_KEY = "anon-key";
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "admin-cleanup.js" });
  return { mod: sandbox, elementsById, capturedBodies };
}

test("1. tombol Hapus Media Terarsip disabled saat Preview baru dibuka", async () => {
  const { mod, elementsById } = loadAdminCleanupModuleForConfirmTests();
  const previewPromise = mod.openPreview("verif-1");
  // Disetel disabled=true SEBELUM await selesai (lihat openPreview()).
  assert.equal(elementsById.confirmCleanupBtn.disabled, true);
  await previewPromise;
  // Preview sukses TAPI belum ada ketikan -> tetap disabled.
  assert.equal(elementsById.confirmCleanupBtn.disabled, true);
});

test("2. frasa salah tetap membuat tombol disabled", async () => {
  const { mod, elementsById } = loadAdminCleanupModuleForConfirmTests();
  await mod.openPreview("verif-1");

  elementsById.cleanupConfirmInput.value = "hapus media";
  mod.updateConfirmButtonState();
  assert.equal(elementsById.confirmCleanupBtn.disabled, true);

  elementsById.cleanupConfirmInput.value = "HAPUS";
  mod.updateConfirmButtonState();
  assert.equal(elementsById.confirmCleanupBtn.disabled, true);
});

test('3. "HAPUS MEDIA" persis mengaktifkan tombol', async () => {
  const { mod, elementsById } = loadAdminCleanupModuleForConfirmTests();
  await mod.openPreview("verif-1");

  elementsById.cleanupConfirmInput.value = "HAPUS MEDIA";
  mod.updateConfirmButtonState();
  assert.equal(elementsById.confirmCleanupBtn.disabled, false);
});

test("4. menutup modal (Tutup/Batal) tidak pernah memanggil cleanup, dan membuang ketikan", async () => {
  const { mod, elementsById, capturedBodies } = loadAdminCleanupModuleForConfirmTests();
  await mod.openPreview("verif-1");
  elementsById.cleanupConfirmInput.value = "HAPUS MEDIA";
  mod.updateConfirmButtonState();

  mod.closePreviewModal();

  assert.equal(elementsById.cleanupConfirmInput.value, "");
  // Mencoba jalur real-cleanup setelah modal ditutup (mis. event tersisa)
  // tidak melakukan apa pun -- activeVerificationId sudah null.
  await mod.runRealCleanup();
  assert.equal(capturedBodies.some((b) => b.dry_run === false), false);
});

test("5. membuka verifikasi lain mereset confirmation (tidak mewarisi ketikan sebelumnya)", async () => {
  const { mod, elementsById } = loadAdminCleanupModuleForConfirmTests();
  await mod.openPreview("verif-A");
  elementsById.cleanupConfirmInput.value = "HAPUS MEDIA";
  mod.updateConfirmButtonState();
  assert.equal(elementsById.confirmCleanupBtn.disabled, false);

  await mod.openPreview("verif-B");
  assert.equal(elementsById.cleanupConfirmInput.value, "");
  assert.equal(elementsById.confirmCleanupBtn.disabled, true);
});

test("6. preview gagal -> confirmation tidak bisa dipakai walau diketik benar", async () => {
  const { mod, elementsById } = loadAdminCleanupModuleForConfirmTests({
    previewOk: false,
  });
  await mod.openPreview("verif-1");

  elementsById.cleanupConfirmInput.value = "HAPUS MEDIA";
  mod.updateConfirmButtonState();
  // dataset.eligible tidak pernah diset "true" karena preview gagal.
  assert.equal(elementsById.confirmCleanupBtn.disabled, true);
});

test("7. request real cleanup persis {verification_id, dry_run:false} -- tanpa field lain", async () => {
  const { mod, elementsById, capturedBodies } = loadAdminCleanupModuleForConfirmTests();
  await mod.openPreview("verif-xyz");
  elementsById.cleanupConfirmInput.value = "HAPUS MEDIA";
  mod.updateConfirmButtonState();

  await mod.runRealCleanup();

  const realBody = capturedBodies.find((b) => b.dry_run === false);
  assert.ok(realBody, "harus ada satu request dry_run:false");
  assert.deepEqual(Object.keys(realBody).sort(), ["dry_run", "verification_id"]);
  assert.equal(realBody.verification_id, "verif-xyz");
  assert.equal(realBody.dry_run, false);
});

test("8. tidak ada pemanggilan cleanup otomatis/berkala di source", () => {
  assert.equal(/setInterval|setTimeout/.test(code), false);
  // runRealCleanup HANYA didaftarkan sekali, sebagai click handler tombol
  // konfirmasi -- bukan dipanggil di tempat lain (mis. langsung saat modal
  // dibuka, atau dari loadVerifications).
  const callSites = code.match(/runRealCleanup/g) || [];
  // 1x deklarasi fungsi + 1x pendaftaran addEventListener = 2 kemunculan
  // total di seluruh file.
  assert.equal(callSites.length, 2);
});

test("submit berulang di modal yang sama setelah sukses tidak dikirim ulang (guard dobel klik)", async () => {
  const { mod, elementsById, capturedBodies } = loadAdminCleanupModuleForConfirmTests();
  await mod.openPreview("verif-1");
  elementsById.cleanupConfirmInput.value = "HAPUS MEDIA";
  mod.updateConfirmButtonState();

  await mod.runRealCleanup();
  const realCallsAfterFirst = capturedBodies.filter((b) => b.dry_run === false).length;
  assert.equal(realCallsAfterFirst, 1);
  assert.equal(elementsById.confirmCleanupBtn.disabled, true);

  // Coba submit lagi (mis. event tersisa/klik ganda) -- tidak boleh
  // mengirim request kedua untuk verifikasi yang sama.
  await mod.runRealCleanup();
  const realCallsAfterSecondAttempt = capturedBodies.filter((b) => b.dry_run === false).length;
  assert.equal(realCallsAfterSecondAttempt, 1);
});
