// js/admin-export.js
//
// STEP 21B -- Admin Data Export Center. Admin-only UI: pilih cabang +
// rentang tanggal (WIB) + tipe data, lalu unduh ZIP dari Edge Function
// export-data.
//
// PENTING soal cara memanggil Edge Function: TIDAK memakai
// supabaseClient.functions.invoke() -- diaudit (STEP 21B) bahwa
// @supabase/functions-js hanya meng-.blob()-kan response dengan
// Content-Type persis "application/octet-stream" atau "application/pdf";
// "application/zip" (Content-Type yang benar untuk file ini) akan JATUH ke
// cabang default .text(), yang MERUSAK byte biner ZIP. Sesuai instruksi
// STEP 21B bagian J ("jika invoke() tidak aman, pakai authenticated fetch
// langsung"), export ini memakai fetch() manual + Authorization bearer
// token dari sesi supabase-js yang sedang aktif, lalu response.blob()
// langsung -- blob() TIDAK bergantung pada Content-Type sniffing apa pun,
// jadi aman untuk biner apa pun.

const session = JSON.parse(sessionStorage.getItem("bc_session") || localStorage.getItem("bedjo_session") || "null");
if (!session || session.role !== "admin") window.location.href = "../login.html";

const ALLOWED_DATA_TYPES = [
  "orders",
  "order_photos",
  "attendance",
  "attendance_selfies",
  "payments",
  "payment_proofs",
];
const MAX_RANGE_DAYS = 31;

let branches = [];
let activePreset = null;
let exportInProgress = false;
// STEP 21D -- konteks export TERAKHIR yang berhasil diunduh, dipakai untuk
// memanggil verify-export-backup. Direset setiap kali admin men-download
// ZIP baru (verifikasi selalu untuk backup yang PALING BARU diunduh).
let lastExportContext = null;
let verifyInProgress = false;

document.addEventListener("DOMContentLoaded", async () => {
  initShell();
  initPresets();
  initDateValidation();
  await loadBranches();
  applyPreset("today");
  document.getElementById("downloadBtn")?.addEventListener("click", downloadZip);
  document.getElementById("copySha256Btn")?.addEventListener("click", copySha256);
  document.getElementById("verifyCheckbox")?.addEventListener("change", updateVerifyButtonState);
  document.getElementById("verifyBackupBtn")?.addEventListener("click", verifyBackup);
});

function initShell() {
  setText("topbarName", session?.name || "Admin");
  setText("topbarRole", "Admin");

  const sidebar = document.getElementById("sidebar");
  const mainWrapper = document.getElementById("mainWrapper");
  const hamburger = document.getElementById("hamburgerBtn");
  hamburger?.addEventListener("click", () => {
    if (window.innerWidth <= 700) sidebar?.classList.toggle("open");
    else {
      sidebar?.classList.toggle("collapsed");
      mainWrapper?.classList.toggle("collapsed");
    }
  });

  const dropdownToggle = document.getElementById("userDropdownToggle");
  const dropdown = document.getElementById("userDropdown");
  dropdownToggle?.addEventListener("click", event => {
    event.stopPropagation();
    dropdown?.classList.toggle("open");
  });
  document.addEventListener("click", () => dropdown?.classList.remove("open"));
  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    sessionStorage.removeItem("bc_session");
    sessionStorage.removeItem("bedjo_session");
    localStorage.removeItem("bc_session");
    localStorage.removeItem("bedjo_session");
    window.location.href = "../login.html";
  });
}

async function loadBranches() {
  const select = document.getElementById("branchSelect");
  const { data, error } = await supabaseClient
    .from("branches")
    .select("id, name, status")
    .order("name", { ascending: true });

  if (error) {
    console.error("Gagal load branches:", error);
    showError("Gagal memuat daftar cabang. Coba muat ulang halaman.");
    return;
  }

  // "Active" branches -- status 'open'. TIDAK memakai allow-list 5 nama
  // lama (BEC/Ciwalk/PVJ/TSM/BTC) -- semua cabang produksi ditampilkan,
  // sesuai keputusan STEP 21B.
  branches = (data || []).filter(b => (b.status || "open") === "open");

  select.innerHTML = `<option value="all">Semua Cabang</option>` +
    branches.map(b => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}</option>`).join("");
}

// ---------------------------------------------------------------------------
// Date presets -- dihitung dalam kalender WIB (Asia/Jakarta) eksplisit lewat
// Intl.DateTimeFormat, BUKAN bergantung pada timezone device admin (device
// bisa saja di-set ke timezone lain saat testing/travel).
// ---------------------------------------------------------------------------

function todayWib() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDaysToIsoDate(isoDate, amount) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + amount);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function firstDayOfMonth(isoDate) {
  const [y, m] = isoDate.split("-").map(Number);
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

function initPresets() {
  document.querySelectorAll(".btn-preset").forEach(btn => {
    btn.addEventListener("click", () => applyPreset(btn.dataset.preset));
  });
}

function applyPreset(preset) {
  activePreset = preset;
  document.querySelectorAll(".btn-preset").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.preset === preset);
  });

  const today = todayWib();
  const startInput = document.getElementById("startDateInput");
  const endInput = document.getElementById("endDateInput");

  switch (preset) {
    case "today":
      startInput.value = today;
      endInput.value = today;
      break;
    case "yesterday": {
      const y = addDaysToIsoDate(today, -1);
      startInput.value = y;
      endInput.value = y;
      break;
    }
    case "last3":
      startInput.value = addDaysToIsoDate(today, -2);
      endInput.value = today;
      break;
    case "last7":
      startInput.value = addDaysToIsoDate(today, -6);
      endInput.value = today;
      break;
    case "thisMonth":
      startInput.value = firstDayOfMonth(today);
      endInput.value = today;
      break;
    case "custom":
      // Biarkan input tanggal saat ini apa adanya, admin edit manual.
      break;
  }
  validateDateRange();
}

function initDateValidation() {
  document.getElementById("startDateInput")?.addEventListener("input", () => {
    activePreset = "custom";
    setActivePresetButton("custom");
    validateDateRange();
  });
  document.getElementById("endDateInput")?.addEventListener("input", () => {
    activePreset = "custom";
    setActivePresetButton("custom");
    validateDateRange();
  });
}

function setActivePresetButton(preset) {
  document.querySelectorAll(".btn-preset").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.preset === preset);
  });
}

// Validasi klien -- mirror aturan server (start<=end, maks 31 hari,
// tanggal wajib diisi) supaya admin dapat feedback SEBELUM klik Download.
// Validasi FINAL/otoritatif tetap di Edge Function (klien bisa dilewati).
function validateDateRange() {
  const hint = document.getElementById("rangeHint");
  const startValue = document.getElementById("startDateInput").value;
  const endValue = document.getElementById("endDateInput").value;

  if (!startValue || !endValue) {
    hint.textContent = "Maksimum rentang export: 31 hari.";
    hint.classList.remove("range-error");
    return { ok: false, message: "Tanggal mulai dan tanggal akhir wajib diisi." };
  }

  const span = inclusiveDaySpan(startValue, endValue);
  if (span < 1) {
    hint.textContent = "Tanggal mulai tidak boleh setelah tanggal akhir.";
    hint.classList.add("range-error");
    return { ok: false, message: "Tanggal mulai tidak boleh setelah tanggal akhir." };
  }
  if (span > MAX_RANGE_DAYS) {
    hint.textContent = `Rentang terlalu panjang (${span} hari). Maksimum ${MAX_RANGE_DAYS} hari.`;
    hint.classList.add("range-error");
    return { ok: false, message: `Rentang maksimum export adalah ${MAX_RANGE_DAYS} hari.` };
  }

  hint.textContent = `Rentang: ${span} hari (maksimum ${MAX_RANGE_DAYS} hari).`;
  hint.classList.remove("range-error");
  return { ok: true };
}

function inclusiveDaySpan(startIso, endIso) {
  const [sy, sm, sd] = startIso.split("-").map(Number);
  const [ey, em, ed] = endIso.split("-").map(Number);
  const startMs = Date.UTC(sy, sm - 1, sd);
  const endMs = Date.UTC(ey, em - 1, ed);
  return Math.round((endMs - startMs) / 86400000) + 1;
}

function selectedDataTypes() {
  return Array.from(document.querySelectorAll('#dataTypeGrid input[type="checkbox"]:checked'))
    .map(el => el.value)
    .filter(v => ALLOWED_DATA_TYPES.includes(v));
}

// ---------------------------------------------------------------------------
// Download.
// ---------------------------------------------------------------------------

async function downloadZip() {
  if (exportInProgress) return; // cegah double-submit dari double-click.
  hideError();
  resetVerificationPanel();

  const dateCheck = validateDateRange();
  if (!dateCheck.ok) {
    showError(dateCheck.message);
    return;
  }

  const dataTypes = selectedDataTypes();
  if (dataTypes.length === 0) {
    showError("Pilih minimal satu tipe data untuk di-export.");
    return;
  }

  const branchId = document.getElementById("branchSelect").value || "all";
  const startDate = document.getElementById("startDateInput").value;
  const endDate = document.getElementById("endDateInput").value;

  const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (sessionError || !accessToken) {
    showError("Sesi login tidak valid atau sudah habis. Silakan login ulang.");
    return;
  }

  setLoading(true);
  try {
    const response = await fetch(`${window.BEDJO_SUPABASE_URL}/functions/v1/export-data`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "apikey": window.BEDJO_SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        branch_id: branchId,
        start_date: startDate,
        end_date: endDate,
        data_types: dataTypes,
      }),
    });

    if (!response.ok) {
      const message = await extractErrorMessage(response);
      showError(message);
      return;
    }

    // STEP 21D bagian C -- hash ZIP final dikirim server lewat header
    // (dibaca SEBELUM .blob() supaya headers masih utuh di semua browser).
    const zipSha256 = response.headers.get("x-bedjo-zip-sha256") || "";

    const blob = await response.blob();
    const filename = extractFilename(response) || `Bedjo_export_${startDate}_${endDate}.zip`;
    triggerBlobDownload(blob, filename);

    if (zipSha256) {
      await showVerificationPanel({ blob, zipSha256, branchId, startDate, endDate, dataTypes });
    }
  } catch (err) {
    console.error("Export gagal:", err);
    showError("Export gagal karena masalah koneksi. Coba lagi.");
  } finally {
    setLoading(false);
  }
}

// ---------------------------------------------------------------------------
// STEP 21D -- verifikasi backup. archive_manifest.json HANYA ada di DALAM
// ZIP (bukan field response terpisah), jadi ZIP hasil download dibaca
// ulang di browser (read-only) lewat JSZip untuk mengekstrak manifest-nya
// sebelum dikirim ke verify-export-backup -- satu-satunya alasan JSZip
// ditambahkan ke browser di sini (bukan untuk MEMBUAT ZIP, hanya membaca).
// ---------------------------------------------------------------------------

async function showVerificationPanel(context) {
  const panel = document.getElementById("verificationPanel");
  const shaText = document.getElementById("zipShaText");
  if (!panel || !shaText) return;

  shaText.textContent = context.zipSha256;
  panel.classList.add("visible");

  try {
    const zip = await JSZip.loadAsync(context.blob);
    const manifestEntry = zip.file("archive_manifest.json");
    if (!manifestEntry) throw new Error("archive_manifest.json tidak ditemukan di ZIP");
    const manifestText = await manifestEntry.async("string");
    const manifest = JSON.parse(manifestText);

    lastExportContext = {
      branchId: context.branchId,
      startDate: context.startDate,
      endDate: context.endDate,
      dataTypes: context.dataTypes,
      zipSha256: context.zipSha256,
      manifest,
    };
    updateVerifyButtonState();
  } catch (err) {
    console.error("Gagal membaca archive_manifest.json dari ZIP:", err);
    lastExportContext = null;
    setText(
      "verifyPanelError",
      "ZIP berhasil diunduh, tapi manifest di dalamnya gagal dibaca -- verifikasi backup tidak bisa dilanjutkan otomatis. Coba download ulang.",
    );
  }
}

function resetVerificationPanel() {
  lastExportContext = null;
  const panel = document.getElementById("verificationPanel");
  panel?.classList.remove("visible");
  const checkbox = document.getElementById("verifyCheckbox");
  if (checkbox) checkbox.checked = false;
  setText("verifyPanelError", "");
  setText("verifySuccessText", "");
  updateVerifyButtonState();
}

function updateVerifyButtonState() {
  const checkbox = document.getElementById("verifyCheckbox");
  const btn = document.getElementById("verifyBackupBtn");
  if (!btn) return;
  btn.disabled = !lastExportContext || !checkbox?.checked || verifyInProgress;
}

async function copySha256() {
  const shaText = document.getElementById("zipShaText")?.textContent || "";
  if (!shaText) return;
  try {
    await navigator.clipboard.writeText(shaText);
    const btn = document.getElementById("copySha256Btn");
    if (btn) {
      const original = btn.textContent;
      btn.textContent = "Tersalin!";
      setTimeout(() => { btn.textContent = original; }, 1500);
    }
  } catch (err) {
    console.warn("Gagal menyalin SHA256:", err);
  }
}

async function verifyBackup() {
  if (verifyInProgress || !lastExportContext) return;
  const checkbox = document.getElementById("verifyCheckbox");
  if (!checkbox?.checked) return;

  verifyInProgress = true;
  updateVerifyButtonState();
  setText("verifyPanelError", "");

  try {
    const { data: sessionData } = await supabaseClient.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    if (!accessToken) {
      setText("verifyPanelError", "Sesi login tidak valid. Silakan login ulang.");
      return;
    }

    const response = await fetch(`${window.BEDJO_SUPABASE_URL}/functions/v1/verify-export-backup`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "apikey": window.BEDJO_SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        branch_id: lastExportContext.branchId,
        start_date: lastExportContext.startDate,
        end_date: lastExportContext.endDate,
        data_types: lastExportContext.dataTypes,
        zip_sha256: lastExportContext.zipSha256,
        manifest: lastExportContext.manifest,
      }),
    });

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const code = body?.error;
      setText(
        "verifyPanelError",
        VERIFY_ERROR_MESSAGES[code] || `Verifikasi gagal (status ${response.status}).`,
      );
      return;
    }

    setText("verifySuccessText", `Backup terverifikasi. ID verifikasi: ${body.verification_id}`);
    lastExportContext = null;
    checkbox.checked = false;
    updateVerifyButtonState();
  } catch (err) {
    console.error("Verifikasi backup gagal:", err);
    setText("verifyPanelError", "Verifikasi gagal karena masalah koneksi. Coba lagi.");
  } finally {
    verifyInProgress = false;
    updateVerifyButtonState();
  }
}

const VERIFY_ERROR_MESSAGES = {
  unauthorized: "Sesi login tidak valid. Silakan login ulang.",
  forbidden: "Akun ini tidak memiliki akses admin.",
  invalid_body: "Permintaan verifikasi tidak valid.",
  invalid_branch: "Cabang tidak valid.",
  invalid_date: "Format tanggal tidak valid.",
  invalid_date_range: "Rentang tanggal tidak valid.",
  invalid_data_types: "Tipe data tidak valid.",
  invalid_sha256: "Hash ZIP tidak valid -- coba download ulang.",
  invalid_manifest: "Manifest ZIP tidak valid -- coba download ulang.",
  manifest_mismatch: "Manifest tidak cocok dengan permintaan export ini -- coba download ulang.",
  internal_error: "Terjadi kesalahan server saat menyimpan verifikasi. Coba lagi.",
};

const ERROR_MESSAGES = {
  unauthorized: "Sesi login tidak valid. Silakan login ulang.",
  forbidden: "Akun ini tidak memiliki akses admin untuk export data.",
  invalid_body: "Permintaan export tidak valid.",
  invalid_branch: "Cabang yang dipilih tidak valid.",
  invalid_date: "Format tanggal tidak valid.",
  invalid_date_range: "Tanggal mulai tidak boleh setelah tanggal akhir.",
  date_range_too_large: `Rentang tanggal melebihi maksimum ${MAX_RANGE_DAYS} hari.`,
  invalid_data_types: "Pilih minimal satu tipe data yang valid.",
  export_too_large: "Data pada rentang ini terlalu besar untuk satu export. Persempit rentang tanggal atau cabang.",
  method_not_allowed: "Terjadi kesalahan pada server export.",
  internal_error: "Terjadi kesalahan pada server saat membuat export. Coba lagi.",
};

async function extractErrorMessage(response) {
  try {
    const body = await response.clone().json();
    if (body?.error && ERROR_MESSAGES[body.error]) return ERROR_MESSAGES[body.error];
    if (body?.error) return `Export gagal: ${body.error}`;
  } catch {
    // response bukan JSON, lanjut ke fallback generic di bawah.
  }
  return `Export gagal (status ${response.status}). Coba lagi.`;
}

function extractFilename(response) {
  const header = response.headers.get("content-disposition") || "";
  const match = /filename="([^"]+)"/.exec(header);
  return match ? match[1] : null;
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function setLoading(isLoading) {
  exportInProgress = isLoading;
  const btn = document.getElementById("downloadBtn");
  const label = document.getElementById("downloadBtnLabel");
  if (!btn || !label) return;
  btn.disabled = isLoading;
  label.innerHTML = isLoading
    ? `<i class="fa-solid fa-spinner"></i> Menyiapkan ZIP...`
    : `<i class="fa-solid fa-file-zipper"></i> Download ZIP`;
}

function showError(message) {
  const box = document.getElementById("exportError");
  if (!box) return;
  box.textContent = message;
  box.classList.add("visible");
}

function hideError() {
  const box = document.getElementById("exportError");
  if (!box) return;
  box.textContent = "";
  box.classList.remove("visible");
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val || "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
