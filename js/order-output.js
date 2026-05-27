/**
 * js/order-output.js — Bedjo Cleaner
 * Halaman Output QR setelah Create/Edit Order
 *
 * ══════════════════════════════════════════════════════════════
 *  PENJELASAN SISTEM QR CODE
 * ══════════════════════════════════════════════════════════════
 *
 *  QR code yang dibuat di sini berisi sebuah URL:
 *
 *    public/tracking.html?code={order_code}
 *
 *  URL ini adalah halaman public (public/tracking.html) yang
 *  bisa dibuka siapa saja — pelanggan tidak perlu login.
 *
 *  ALUR LENGKAP:
 *  1. Operator buat/edit order → klik Save
 *  2. Data order disimpan ke database (Supabase)
 *  3. Halaman ini muncul, QR digenerate dari URL tracking
 *  4. Operator bisa:
 *     - Download QR → cetak / kirim manual
 *     - Send to WhatsApp → buka wa.me dengan pesan + link
 *  5. Pelanggan scan QR → buka URL tracking → lihat status order
 *
 *  LIBRARY: qrcode.js (via CDN, tidak butuh server/API)
 *  qrcode.js mengubah string URL menjadi gambar QR di browser.
 * ══════════════════════════════════════════════════════════════
 */

// ── Auth Guard ────────────────────────────────────────────────────────────────
function getSession() {
  try { return JSON.parse(sessionStorage.getItem("bc_session")); } catch { return null; }
}

const _session = getSession();
if (!_session || _session.role !== "operator") {
  window.location.replace("../login.html");
}

// ── Ambil data order dari sessionStorage ──────────────────────────────────────
// Data ini disimpan oleh order-create.js saat klik Save
let order = null;
try {
  order = JSON.parse(sessionStorage.getItem("bc_saved_order"));
} catch (e) { order = null; }

// Jika tidak ada data → redirect ke orders
if (!order) {
  window.location.replace("orders.html");
}

// ── Konfigurasi ───────────────────────────────────────────────────────────────
// URL yang akan diencode ke dalam QR.
// Mengikuti host aplikasi saat ini, bukan domain eksternal yang belum dikonfigurasi.
const orderTrackingCode = order.order_code || order.id;
const trackingUrl = buildTrackingUrl(orderTrackingCode, order.id);
const waNumber      = order.wa ? order.wa.replace(/[^0-9]/g, "") : "";

// ── Generate QR Code ──────────────────────────────────────────────────────────
// qrcode.js diload dari CDN di HTML → tersedia sebagai global QRCode
let qrInstance = null;

document.addEventListener("DOMContentLoaded", function () {

  // Set username
  const uNameEl = document.getElementById("uName");
  if (uNameEl && _session) uNameEl.textContent = _session.role === "operator" ? "Operator" : (_session.name || "Operator");

  // Set order ID label
  const orderIdEl = document.getElementById("qrOrderId");
  if (orderIdEl) orderIdEl.textContent = `Order #${orderTrackingCode}`;

  // Set tracking URL display
  const trackUrlEl = document.getElementById("trackingUrl");
  if (trackUrlEl) trackUrlEl.textContent = displayTrackingUrl(trackingUrl);

  // Generate QR menggunakan qrcode.js
  // qrcode.js membuat elemen <canvas> atau <img> di dalam container
  const container = document.getElementById("qrCodeContainer");
  if (container && typeof QRCode !== "undefined") {
    qrInstance = new QRCode(container, {
      text:         trackingUrl,   // ← isi QR = URL tracking order ini
      width:        180,
      height:       180,
      colorDark:    "#000000",
      colorLight:   "#ffffff",
      correctLevel: QRCode.CorrectLevel.H,  // High error correction
    });
  } else if (container) {
    // Fallback jika CDN gagal load: tampilkan pesan
    container.innerHTML = `<div style="font-size:0.8rem;color:#6B7280;text-align:center;padding:20px;">
      QR tidak dapat dimuat.<br>Cek koneksi internet.
    </div>`;
  }

  // ── Download QR ────────────────────────────────────────────────────────────
  document.getElementById("btnDlQR")?.addEventListener("click", () => {
    // qrcode.js membuat <canvas> di dalam container — ambil canvas-nya
    const canvas = document.querySelector("#qrCodeContainer canvas");
    if (canvas) {
      const link  = document.createElement("a");
      link.download = `QR_${order.id}.png`;
      link.href   = canvas.toDataURL("image/png");
      link.click();
      return;
    }
    // Jika render sebagai <img>
    const img = document.querySelector("#qrCodeContainer img");
    if (img) {
      const link = document.createElement("a");
      link.download = `QR_${order.id}.png`;
      link.href = img.src;
      link.click();
    }
  });

  // ── Send to WhatsApp ───────────────────────────────────────────────────────
  document.getElementById("btnWA")?.addEventListener("click", () => {
    const msg = encodeURIComponent(
      `Halo, berikut link tracking pesanan Bedjo Cleaner Anda: ${trackingUrl}`
    );

    // Jika ada nomor WA pelanggan → buka chat langsung ke nomor tersebut
    // Jika tidak ada → buka share umum
    const waTarget = waNumber
      ? `https://wa.me/${waNumber}?text=${msg}`
      : `https://wa.me/?text=${msg}`;

    window.open(waTarget, "_blank");
  });

  // ── Copy Tracking Link ─────────────────────────────────────────────────────
  document.getElementById("btnCopy")?.addEventListener("click", () => {
    navigator.clipboard.writeText(trackingUrl).then(() => {
      const btn = document.getElementById("btnCopy");
      if (btn) {
        btn.textContent = "Copied!";
        setTimeout(() => btn.textContent = "Copy Link", 2000);
      }
    }).catch(() => {
      // Fallback untuk browser yang tidak support clipboard API
      const ta = document.createElement("textarea");
      ta.value = trackingUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      const btn = document.getElementById("btnCopy");
      if (btn) {
        btn.textContent = "Copied!";
        setTimeout(() => btn.textContent = "Copy Link", 2000);
      }
    });
  });

  // ── Back to Dashboard ──────────────────────────────────────────────────────
  document.getElementById("btnBack")?.addEventListener("click", () => {
    // Hapus data order sementara dari session
    sessionStorage.removeItem("bc_saved_order");
    window.location.href = "operator-dashboard.html";
  });

  // ── Drawer ─────────────────────────────────────────────────────────────────
  let drawerOpen = window.innerWidth >= 768;

  function syncDrawer() {
    const drawer   = document.getElementById("drawer");
    const mainWrap = document.getElementById("mainWrap");
    const overlay  = document.getElementById("overlay");
    if (!drawer || !mainWrap) return;
    if (drawerOpen) {
      drawer.classList.remove("collapsed");
      mainWrap.classList.remove("expanded");
      if (overlay) overlay.classList.remove("show");
    } else {
      drawer.classList.add("collapsed");
      mainWrap.classList.add("expanded");
      if (overlay && window.innerWidth < 768) overlay.classList.add("show");
    }
  }

  if (window.innerWidth < 768) drawerOpen = false;
  syncDrawer();

  document.getElementById("hamburger")?.addEventListener("click", () => {
    drawerOpen = !drawerOpen;
    syncDrawer();
  });
  document.getElementById("overlay")?.addEventListener("click", () => {
    drawerOpen = false;
    syncDrawer();
  });

  // ── User dropdown ───────────────────────────────────────────────────────────
  const userPill  = document.getElementById("userPill");
  const uDropdown = document.getElementById("uDropdown");
  userPill?.addEventListener("click", e => {
    e.stopPropagation();
    uDropdown?.classList.toggle("open");
  });
  document.addEventListener("click", () => uDropdown?.classList.remove("open"));
  document.getElementById("logoutBtn")?.addEventListener("click", () => {
    sessionStorage.removeItem("bc_session");
    window.location.replace("../login.html");
  });

});

function buildTrackingUrl(orderCode) {
  if (window.BedjoUrl?.tracking) return window.BedjoUrl.tracking(orderCode);
  const url = new URL("../public/tracking.html", window.location.href);
  url.searchParams.set("code", orderCode);
  url.searchParams.set("v", "20260519-3");
  return url.href;
}

function displayTrackingUrl(url) {
  return url.replace(/^https?:\/\//, "").replace(/^file:\/+/, "");
}
