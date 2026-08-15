// js/admin-cleanup.js
//
// STEP 21D -- "Arsip & Cleanup" page. Lists verified backup periods
// (export_backup_verifications, admin-only SELECT RLS), lets admin preview
// a cleanup (dry_run:true, ZERO deletions) and, once retention (60 hari
// sejak end_date) is reached and the admin types the exact confirmation
// phrase "HAPUS MEDIA" (STEP 22F.2 -- replaces the old single-checkbox
// gate, matching the Flutter Admin app's typed-confirmation standard),
// trigger the real cleanup (dry_run:false) via the cleanup-media Edge
// Function -- same authenticated-fetch pattern as export-data/
// verify-export-backup (never supabaseClient.functions.invoke(), see
// admin-export.js for why).

const session = JSON.parse(sessionStorage.getItem("bc_session") || localStorage.getItem("bedjo_session") || "null");
if (!session || session.role !== "admin") window.location.href = "../login.html";

const RETENTION_DAYS = 60;

// STEP 22F.2 -- frasa konfirmasi ketik-ulang, SAMA PERSIS dengan
// kCleanupConfirmationPhrase di Flutter
// (lib/features/admin/archive_cleanup/archive_cleanup_helpers.dart).
// Dipakai lewat isCleanupConfirmationValid() di bawah -- TIDAK diduplikasi
// sebagai literal string di handler lain.
const CLEANUP_CONFIRMATION_PHRASE = "HAPUS MEDIA";

let verifications = [];
let activeVerificationId = null;
let previewInProgress = false;
let cleanupInProgress = false;
// Sekali real cleanup SUKSES untuk verification_id yang sedang dibuka,
// modal ini tidak boleh mengizinkan submit lagi (cegah dobel-klik hapus
// untuk verifikasi yang sama) -- direset setiap kali Preview modal baru
// dibuka (openPreview) atau ditutup (closePreviewModal).
let cleanupCompleted = false;

document.addEventListener("DOMContentLoaded", async () => {
  initShell();
  await loadVerifications();
  document.getElementById("closePreviewBtn")?.addEventListener("click", closePreviewModal);
  document.getElementById("cleanupConfirmInput")?.addEventListener("input", updateConfirmButtonState);
  document.getElementById("confirmCleanupBtn")?.addEventListener("click", runRealCleanup);
});

// Perbandingan EXACT (case-sensitive) setelah trim -- TIDAK menerima huruf
// kecil, teks sebagian, maupun frasa lain. Fungsi murni, gampang diuji
// tanpa DOM sama sekali.
function isCleanupConfirmationValid(value) {
  return String(value ?? "").trim() === CLEANUP_CONFIRMATION_PHRASE;
}

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

// ---------------------------------------------------------------------------
// List verified backups.
// ---------------------------------------------------------------------------

async function loadVerifications() {
  const listEl = document.getElementById("verificationsList");
  const errorEl = document.getElementById("cleanupListError");
  setText("cleanupListError", "");

  const { data, error } = await supabaseClient
    .from("export_backup_verifications")
    .select("id, branch_id, start_date, end_date, verified_at, branches(name)")
    .order("verified_at", { ascending: false });

  if (error) {
    console.error("Gagal load export_backup_verifications:", error);
    if (errorEl) errorEl.textContent = "Gagal memuat daftar backup terverifikasi.";
    if (listEl) listEl.innerHTML = "";
    return;
  }

  verifications = data || [];
  renderVerifications();
}

function renderVerifications() {
  const listEl = document.getElementById("verificationsList");
  if (!listEl) return;

  if (verifications.length === 0) {
    listEl.innerHTML = `<p class="cleanup-empty">Belum ada backup yang diverifikasi. Verifikasi backup dulu di halaman Export Data.</p>`;
    return;
  }

  const today = todayWib();
  listEl.innerHTML = verifications.map(v => {
    const branchLabel = v.branches?.name || (v.branch_id ? "Cabang" : "Semua Cabang");
    const retentionUntil = addDaysToIsoDate(v.end_date, RETENTION_DAYS);
    const eligible = today >= retentionUntil;
    const verifiedDate = new Date(v.verified_at).toLocaleDateString("id-ID", {
      day: "2-digit", month: "short", year: "numeric",
    });

    return `
      <div class="verification-row">
        <div class="verification-info">
          <div class="verification-branch">${escapeHtml(branchLabel)}</div>
          <div class="verification-period">${escapeHtml(v.start_date)} &ndash; ${escapeHtml(v.end_date)}</div>
          <div class="verification-meta">Backup verified: ${escapeHtml(verifiedDate)}</div>
          <div class="verification-meta ${eligible ? "retention-ready" : "retention-pending"}">
            ${eligible ? "Cleanup available" : `Cleanup available: ${escapeHtml(retentionUntil)}`}
          </div>
        </div>
        <div class="verification-action">
          <button type="button" class="btn-preset" ${eligible ? "" : "disabled"} onclick="openPreview('${v.id}')">
            Preview Cleanup
          </button>
        </div>
      </div>
    `;
  }).join("");
}

// ---------------------------------------------------------------------------
// Preview (dry_run:true) -- ZERO deletions, hanya membaca.
// ---------------------------------------------------------------------------

async function openPreview(verificationId) {
  if (previewInProgress) return;
  activeVerificationId = verificationId;
  // Verifikasi berbeda (atau preview diulang) -> confirmation state TIDAK
  // PERNAH terbawa dari dialog sebelumnya.
  cleanupCompleted = false;

  const modal = document.getElementById("previewModal");
  const loading = document.getElementById("previewLoading");
  const content = document.getElementById("previewContent");
  const confirmInput = document.getElementById("cleanupConfirmInput");
  const confirmBtn = document.getElementById("confirmCleanupBtn");

  modal?.classList.add("open");
  if (loading) loading.style.display = "block";
  if (content) content.style.display = "none";
  if (confirmInput) confirmInput.value = "";
  if (confirmBtn) confirmBtn.disabled = true;
  setText("cleanupError", "");
  setText("cleanupResultText", "");

  previewInProgress = true;
  try {
    const result = await callCleanupMedia(verificationId, true);
    if (!result.ok) {
      setText("cleanupError", result.message);
      return;
    }
    renderPreview(result.data);
    if (loading) loading.style.display = "none";
    if (content) content.style.display = "block";
  } finally {
    previewInProgress = false;
  }
}

function renderPreview(summary) {
  setText("previewOrderPhotos", formatFilesBytes(summary.order_photos));
  setText("previewAttendanceSelfies", formatFilesBytes(summary.attendance_selfies));
  setText("previewPaymentProofs", formatFilesBytes(summary.payment_proofs));
  setText("previewMissing", `${summary.already_missing} files`);
  setText("previewTotal", formatFilesBytes({ files: summary.total_files, bytes: summary.total_bytes }));

  const confirmBtn = document.getElementById("confirmCleanupBtn");
  // Preview HANYA dipanggil dari tombol yang sudah dicek eligible di
  // renderVerifications(), tapi server-side `eligible` tetap sumber
  // kebenaran akhir -- kalau server bilang belum eligible, tombol hapus
  // TETAP terkunci apa pun status checkbox.
  if (confirmBtn) confirmBtn.dataset.eligible = summary.eligible ? "true" : "false";
  updateConfirmButtonState();
}

function formatFilesBytes(stat) {
  const mb = (stat.bytes / (1024 * 1024)).toFixed(1);
  return `${stat.files} files / ${mb} MB`;
}

function closePreviewModal() {
  document.getElementById("previewModal")?.classList.remove("open");
  activeVerificationId = null;
  cleanupCompleted = false;
  // Buang nilai yang sudah diketik -- membuka modal lain (atau modal yang
  // sama lagi) TIDAK PERNAH mewarisi ketikan sebelumnya.
  const confirmInput = document.getElementById("cleanupConfirmInput");
  if (confirmInput) confirmInput.value = "";
}

function updateConfirmButtonState() {
  const input = document.getElementById("cleanupConfirmInput");
  const btn = document.getElementById("confirmCleanupBtn");
  if (!btn) return;
  const eligible = btn.dataset.eligible === "true";
  const confirmed = isCleanupConfirmationValid(input?.value);
  btn.disabled = !eligible || !confirmed || cleanupInProgress || cleanupCompleted;
}

// ---------------------------------------------------------------------------
// Real cleanup (dry_run:false) -- SATU-SATUNYA tempat di seluruh Admin Web
// yang memanggil cleanup-media dengan dry_run:false.
// ---------------------------------------------------------------------------

async function runRealCleanup() {
  if (cleanupInProgress || cleanupCompleted || !activeVerificationId) return;
  // Defense-in-depth: cek ulang frasa konfirmasi di sini, bukan cuma
  // percaya confirmCleanupBtn.disabled (yang dikontrol updateConfirmButtonState)
  // -- pola yang sama seperti _confirmAndDelete() mengecek ulang _canDelete
  // di Flutter (archive_cleanup_page.dart).
  const input = document.getElementById("cleanupConfirmInput");
  if (!isCleanupConfirmationValid(input?.value)) return;

  cleanupInProgress = true;
  updateConfirmButtonState();
  setText("cleanupError", "");

  try {
    const result = await callCleanupMedia(activeVerificationId, false);
    if (!result.ok) {
      setText("cleanupError", result.message);
      return;
    }
    // HANYA hasil SUKSES yang mengunci submit lanjutan di modal ini --
    // error (mis. masalah koneksi) tetap boleh dicoba ulang tanpa perlu
    // membuka ulang modal.
    cleanupCompleted = true;
    const report = result.data;
    setText(
      "cleanupResultText",
      `Selesai. Dihapus: ${report.deleted}, sudah hilang sebelumnya: ${report.already_missing}, gagal: ${report.failed}.`,
    );
    await loadVerifications();
  } finally {
    cleanupInProgress = false;
    updateConfirmButtonState();
  }
}

// ---------------------------------------------------------------------------
// Shared cleanup-media caller.
// ---------------------------------------------------------------------------

async function callCleanupMedia(verificationId, dryRun) {
  const { data: sessionData } = await supabaseClient.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) {
    return { ok: false, message: "Sesi login tidak valid. Silakan login ulang." };
  }

  try {
    const response = await fetch(`${window.BEDJO_SUPABASE_URL}/functions/v1/cleanup-media`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "apikey": window.BEDJO_SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ verification_id: verificationId, dry_run: dryRun }),
    });

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const code = body?.error;
      return { ok: false, message: CLEANUP_ERROR_MESSAGES[code] || `Gagal (status ${response.status}).` };
    }
    return { ok: true, data: body };
  } catch (err) {
    console.error("cleanup-media call gagal:", err);
    return { ok: false, message: "Gagal karena masalah koneksi. Coba lagi." };
  }
}

const CLEANUP_ERROR_MESSAGES = {
  unauthorized: "Sesi login tidak valid. Silakan login ulang.",
  forbidden: "Akun ini tidak memiliki akses admin.",
  invalid_body: "Permintaan tidak valid.",
  invalid_verification_id: "ID verifikasi tidak valid.",
  invalid_dry_run: "Permintaan tidak valid.",
  invalid_manifest: "Manifest backup ini rusak/tidak valid -- cleanup dibatalkan demi keamanan.",
  cleanup_too_large: "Jumlah file terlalu besar untuk satu proses cleanup.",
  retention_not_reached: "Masa retensi 60 hari belum terlampaui.",
  verification_not_found: "Data verifikasi backup tidak ditemukan.",
  internal_error: "Terjadi kesalahan server. Coba lagi.",
};

// ---------------------------------------------------------------------------
// WIB date helpers -- identik js/admin-export.js.
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
