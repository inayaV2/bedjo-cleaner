// Mapping status database -> label bisnis, selaras dengan Order Detail Flutter:
// pending=Menunggu, on_process=Sedang Diproses, completed=Selesai,
// picked_up=Barang Sudah Diambil, cancelled=Dibatalkan.
const STATUS_CONFIG = {
  pending: { label: "Menunggu", badgeClass: "badge-pending" },
  on_process: { label: "Sedang Diproses", badgeClass: "badge-process" },
  completed: { label: "Selesai", badgeClass: "badge-completed" },
  picked_up: { label: "Barang Sudah Diambil", badgeClass: "badge-completed" },
  cancelled: { label: "Dibatalkan", badgeClass: "badge-cancelled" },
  // Alias legacy (kemungkinan data lama), dipetakan ke label bisnis yang sama.
  received: { label: "Menunggu", badgeClass: "badge-pending" },
  processing: { label: "Sedang Diproses", badgeClass: "badge-process" },
  process: { label: "Sedang Diproses", badgeClass: "badge-process" },
};

const TIMELINE_STEPS = [
  { key: "pending", label: "Menunggu" },
  { key: "on_process", label: "Sedang Diproses" },
  { key: "completed", label: "Selesai" },
  { key: "picked_up", label: "Barang Sudah Diambil" },
];

const STATUS_STEP_INDEX = {
  pending: 0,
  received: 0,
  on_process: 1,
  processing: 1,
  process: 1,
  completed: 2,
  picked_up: 3,
  cancelled: -1,
};

const loadingEl = document.getElementById("loading-state");
const errorEl = document.getElementById("error-state");
const orderCardEl = document.getElementById("order-card");
const helpCardEl = document.getElementById("help-card");
const formEl = document.getElementById("tracking-form");
const inputEl = document.getElementById("tracking-input");

document.addEventListener("DOMContentLoaded", () => {
  ensureTrackingDom();

  const params = new URLSearchParams(window.location.search);
  const token = normalizeTrackingToken(params.get("token"));
  const oldCode = normalizeTrackingToken(
    params.get("code") || params.get("order_id") || params.get("id")
  );

  // Bersihkan URL agar token tidak menetap di address bar / history browser.
  if (window.location.search) {
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  if (oldCode && !token) {
    showError(
      "Link tracking lama perlu diperbarui",
      "Silakan hubungi Bedjo Cleaner untuk mendapatkan link tracking terbaru."
    );
    return;
  }

  if (token) {
    if (inputEl) inputEl.value = token;
    loadOrder(token);
  }

  formEl?.addEventListener("submit", event => {
    event.preventDefault();

    const value = normalizeTrackingToken(inputEl?.value);
    if (!value) {
      showError(
        "Token tracking tidak ditemukan",
        "Masukkan token tracking terbaru dari Bedjo Cleaner."
      );
      return;
    }

    loadOrder(value);
  });
});

async function loadOrder(value) {
  showLoading();

  const token = normalizeTrackingToken(value);

  if (!token) {
    showError(
      "Token tracking tidak ditemukan",
      "Masukkan token tracking terbaru dari Bedjo Cleaner."
    );
    return;
  }

  const data = await fetchTrackingData(token);

  if (!data || !data.order) {
    // Pesan generik untuk token invalid maupun order tidak ditemukan.
    showError("Order tidak ditemukan", "Pastikan link atau QR code yang kamu scan sudah benar.");
    return;
  }

  const order = data.order;
  // remaining_amount dihitung server-side oleh Edge Function.
  order.remaining_amount = data.remaining_amount;
  // Cabang asal order -- dipakai sebagai fallback nama cabang pengerjaan
  // untuk item Cuci/null (bukan nama cabang tertentu yang di-hardcode).
  order.origin_branch_id = data.origin_branch_id ?? null;
  order.origin_branch_name = data.origin_branch_name ?? data.branch?.name ?? null;
  const orderItems = (data.items || []).map(item => ({
    ...item,
    services: item.service || null,
  }));
  const payment = data.payment || null;
  const payments = payment ? [payment] : [];
  const branch = data.branch || null;
  const orderPhotos = data.photos || [];

  renderTracking(order, orderItems, payments, branch, orderPhotos);
  requestAnimationFrame(() => renderTracking(order, orderItems, payments, branch, orderPhotos));
}

function renderTracking(order, orderItems = [], payments = [], branch = null, photos = []) {
  order.order_items = orderItems || [];
  order.payments = payments || [];
  order.branches = branch || null;
  order.order_photos = photos || [];

  renderOrder(order);
}

// Satu POST ke Edge Function public-tracking (verify_jwt=false).
// Tidak ada query langsung ke tabel, tidak ada service-role, tidak ada URL publik.
async function fetchTrackingData(token) {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/public-tracking`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (error) {
    return null;
  }
}

function renderOrder(order) {
  const name = order.customer_name || "Customer";
  const statusKey = normalizeStatus(order.status);
  const statusCfg = STATUS_CONFIG[statusKey] || STATUS_CONFIG.pending;
  const payment = trackingPayment(order);
  const renderedItemType = finalItemType(order.order_items || []);
  const renderedServiceType = finalServiceType(order.order_items || []);
  const renderedPaymentStatus = finalPaymentStatus(order, payment);

  setText("avatar-initials", name.charAt(0).toUpperCase());
  setText("customer-name", name);
  setText("order-id", `Order ID: #${order.order_code || order.id}`);
  setText("order-date", formatDate(order.created_at));
  setManyText(["service-type", "serviceType", "iServiceType", "tracking-service-type"], renderedServiceType);
  setManyText(["item-type", "itemType", "iItemType", "tracking-item-type"], renderedItemType);
  setManyText(["payment-status", "paymentStatus", "iPaymentStatus", "tracking-payment-status"], renderedPaymentStatus);
  setText("branch-name", order.branches?.name || "-");
  setValueByLabel("Jenis layanan", renderedServiceType);
  setValueByLabel("Jenis item", renderedItemType);
  setValueByLabel("Status pembayaran", renderedPaymentStatus);
  setText("order-note", notes(order));

  renderOrderItems(order.order_items || [], order.origin_branch_name);
  renderPaymentSummary(order, payment);

  const badge = document.getElementById("status-badge");
  if (badge) {
    badge.textContent = statusCfg.label;
    badge.className = `status-badge ${statusCfg.badgeClass}`;
  }

  renderPhoto(order);
  renderTimeline(statusKey);

  const waNumber = window.BedjoContact?.whatsappNumber?.() || "";
  // Hanya order code (bukan token public tracking) yang dimasukkan ke pesan.
  const waMsg = encodeURIComponent(
    `Halo Bedjo Cleaner, saya membutuhkan bantuan terkait order ${order.order_code || order.id}.`
  );
  const waLink = document.getElementById("wa-link");

  if (waLink) {
    waLink.href = waNumber
      ? `https://wa.me/${waNumber}?text=${waMsg}`
      : `https://wa.me/?text=${waMsg}`;
  }

  loadingEl?.classList.add("hidden");
  errorEl?.classList.add("hidden");
  orderCardEl?.classList.remove("hidden");
  helpCardEl?.classList.remove("hidden");
}

// handling_type kosong/tidak valid (data lama) -> 'cuci'. Sama persis
// dengan normalizeOrderItemHandlingType di order_status.dart dan
// normalizeHandlingType di Edge Function.
function itemHandlingType(item) {
  return String(item?.handling_type ?? "").trim().toLowerCase() === "service"
    ? "service"
    : "cuci";
}

function itemHandlingLabel(item) {
  return itemHandlingType(item) === "service" ? "Service" : "Cuci";
}

// TIDAK PERNAH hardcode nama cabang manapun. Prioritas:
// 1. handling_branch_name dari API (sudah di-resolve server-side).
// 2. handling_branch_id null -> cabang asal order (originBranchName).
// 3. handling_branch_id ada tapi tidak resolve -> "Cabang tidak diketahui".
function itemHandlingBranchLabel(item, originBranchName) {
  const resolvedName = cleanValue(item?.handling_branch_name);
  if (resolvedName !== "-") {
    return resolvedName;
  }

  const handlingBranchId = item?.handling_branch_id;
  const hasHandlingBranchId = handlingBranchId !== null &&
    handlingBranchId !== undefined &&
    String(handlingBranchId).trim() !== "";

  if (!hasHandlingBranchId) {
    return cleanValue(originBranchName);
  }

  return "Cabang tidak diketahui";
}

function itemStatusLabel(item) {
  return String(item?.status || "").trim().toLowerCase() === "cancelled"
    ? "Dibatalkan"
    : "Aktif";
}

function renderOrderItems(items, originBranchName = null) {
  const container = document.getElementById("order-items-list");
  if (!container) return;

  if (!items.length) {
    container.innerHTML = `<div class="order-item-empty">Detail item belum tersedia.</div>`;
    return;
  }

  container.innerHTML = items.map((item, index) => {
    const itemType = cleanValue(item.item_type || item.item_name || item.name);
    const businessLine = itemBusinessLineLabel(item);
    const service = itemServiceLabel(item, itemType);
    const handlingLabel = itemHandlingLabel(item);
    const handlingBranchLabel = itemHandlingBranchLabel(item, originBranchName);
    const variant = itemVariant(item);
    const quantity = positiveNumber(item.quantity, 1);
    const unitPrice = itemUnitPrice(item);
    const subtotal = itemSubtotal(item, unitPrice, quantity);
    const note = itemNote(item);
    const description = itemDescription(item);
    const title = [service, variant].filter(value => value !== "-").join(" - ") || itemType;

    // Item cancelled tetap ditampilkan (tidak dihilangkan), hanya ditandai
    // redup + line-through + badge, konsisten dengan Order Detail Flutter.
    const isCancelled = String(item.status || "").trim().toLowerCase() === "cancelled";
    const valueClass = isCancelled ? " order-item-value--cancelled" : "";
    const cancelReason = isCancelled ? cleanValue(item.cancel_reason) : "-";
    const cancelledAt = isCancelled ? formatDate(item.cancelled_at) : "-";

    return `
      <article class="order-item-detail${isCancelled ? " order-item-detail--cancelled" : ""}">
        <p class="order-item-number">Item ${index + 1}</p>
        <p class="order-item-title">${escapeHtml(title)}${isCancelled ? ' <span class="order-item-cancelled-badge">Dibatalkan</span>' : ""}</p>
        <dl class="order-item-fields">
          <div><dt>Jenis Usaha</dt><dd>${escapeHtml(businessLine)}</dd></div>
          <div><dt>Jenis item</dt><dd>${escapeHtml(itemType)}</dd></div>
          <div><dt>Layanan</dt><dd class="${valueClass}">${escapeHtml(service)}</dd></div>
          <div><dt>Jenis Layanan</dt><dd class="${valueClass}">${escapeHtml(handlingLabel)}</dd></div>
          <div><dt>Cabang Pengerjaan</dt><dd class="${valueClass}">${escapeHtml(handlingBranchLabel)}</dd></div>
          <div><dt>Variant</dt><dd class="${valueClass}">${escapeHtml(variant)}</dd></div>
          <div><dt>Qty</dt><dd class="${valueClass}">${quantity} x ${escapeHtml(formatRupiah(unitPrice, "-"))}</dd></div>
          <div><dt>Subtotal</dt><dd class="${valueClass}">${escapeHtml(formatRupiah(subtotal, "-"))}</dd></div>
          <div><dt>Status</dt><dd class="${valueClass}">${escapeHtml(itemStatusLabel(item))}</dd></div>
          ${description !== "-" ? `<div class="order-item-description"><dt>Keterangan</dt><dd>${escapeHtml(description)}</dd></div>` : ""}
          ${note !== "-" ? `<div class="order-item-note"><dt>Catatan</dt><dd>${escapeHtml(note)}</dd></div>` : ""}
          ${isCancelled ? `<div class="order-item-cancel-info"><dt>Alasan dibatalkan</dt><dd>${escapeHtml(cancelReason)}</dd></div>` : ""}
          ${isCancelled && cancelledAt !== "-" ? `<div class="order-item-cancel-info"><dt>Waktu dibatalkan</dt><dd>${escapeHtml(cancelledAt)}</dd></div>` : ""}
        </dl>
      </article>
    `;
  }).join("");
}

// Diskon lama tanpa field discount_* (order lama) -> discount_enabled
// undefined/null dianggap false, discount_amount undefined/null dianggap 0 ->
// resolveDiscountDisplay() mengembalikan null -> row disembunyikan. Dipisah
// sebagai fungsi murni (bukan langsung memanipulasi DOM) supaya bisa diuji
// ringan tanpa perlu render halaman penuh.
function resolveDiscountDisplay(order) {
  const enabled = order?.discount_enabled === true;
  const amount = numericValue(order?.discount_amount) ?? 0;
  if (!enabled || amount <= 0) {
    return null;
  }
  const type = order?.discount_type;
  const value = numericValue(order?.discount_value) ?? 0;
  const label = type === "percent"
    ? `Diskon ${formatPercentValue(value)}%`
    : "Diskon";
  return { label, formattedValue: `-${formatRupiah(amount)}` };
}

function formatPercentValue(value) {
  const number = numericValue(value) ?? 0;
  return Number.isInteger(number) ? String(number) : String(number);
}

function renderPaymentSummary(order, payment) {
  // Semua nominal berasal dari Edge Function (bukan REST langsung).
  const subtotal = numericValue(order.subtotal_amount) ?? 0;
  const taxPercent = numericValue(order.tax_percent) ?? 0;
  const taxAmount = numericValue(order.tax_amount) ?? 0;
  const deliveryFee = numericValue(order.delivery_fee) ?? 0;
  const total = numericValue(order.total_amount) ?? 0;
  const paid = numericValue(payment?.paid_amount) ?? 0;
  const serverRemaining = numericValue(order.remaining_amount);
  const remaining = serverRemaining !== null
    ? serverRemaining
    : Math.max(total - paid, 0);

  const discountRowEl = document.getElementById("discount-row");
  const discount = resolveDiscountDisplay(order);
  if (discount) {
    discountRowEl?.classList.remove("hidden");
    setText("discount-label", discount.label);
    setText("discount-amount", discount.formattedValue);
  } else {
    discountRowEl?.classList.add("hidden");
  }

  const taxLabelEl = document.getElementById("tax-label");
  if (taxLabelEl) {
    taxLabelEl.textContent = taxPercent > 0
      ? `Pajak (${taxPercent}%)`
      : "Pajak";
  }
  document.getElementById("tax-row")?.classList.toggle("hidden", taxAmount <= 0);
  document.getElementById("delivery-row")?.classList.toggle("hidden", deliveryFee <= 0);

  setText("subtotal-amount", formatRupiah(subtotal));
  setText("tax-amount", formatRupiah(taxAmount));
  setText("delivery-fee", formatRupiah(deliveryFee));
  setText("order-total", formatRupiah(total));
  setText("paid-amount", formatRupiah(paid));
  setText("remaining-amount", formatRupiah(remaining));
  setText("payment-method", paymentMethodText(payment?.method));
  setText("payment-status", finalPaymentStatus(order, payment));
}

function calculateItemsTotal(items) {
  return (items || []).reduce((sum, item) => {
    const quantity = positiveNumber(item.quantity, 1);
    const unitPrice = itemUnitPrice(item);
    const subtotal = itemSubtotal(item, unitPrice, quantity);
    return sum + (subtotal || 0);
  }, 0);
}

// business_line null/kosong (data lama sebelum STEP 12A, atau relasi
// service tidak resolve) -> fallback "Bedjo Cleaner", sama persis dengan
// serviceBusinessLine/businessLineLabel di lib/features/orders/order_status.dart.
function itemBusinessLineLabel(item) {
  const value = String(item.services?.business_line || "").trim().toLowerCase();
  switch (value) {
    case "homecare":
      return "Homecare";
    case "helmet":
      return "Helmet";
    case "autocare_mobil":
      return "Autocare Mobil";
    case "autocare_motor":
      return "Autocare Motor";
    default:
      return "Bedjo Cleaner";
  }
}

// "Premium Wash (Motor)" -> "Premium Wash" di tracking (Section 4 STEP
// 12B) -- nama database tetap dipertahankan sebagai unique key, hanya
// tampilan yang disederhanakan. Sama persis dengan displayServiceName di
// lib/features/orders/order_status.dart.
function displayServiceName(rawBaseName, businessLine) {
  if (businessLine !== "autocare_motor") return rawBaseName;
  return rawBaseName.replace(" (Motor)", "").trim();
}

function itemServiceLabel(item, itemType) {
  const relationName = cleanValue(item.services?.name);
  const relationBase = relationName === "-" ? "" : splitServiceName(relationName).base;
  const businessLine = String(item.services?.business_line || "").trim().toLowerCase();

  return cleanValue(
    displayServiceName(
      relationBase ||
      item.service_type ||
      item.service_name ||
      item.service ||
      serviceFromNotes(item.notes || item.note) ||
      "",
      businessLine,
    ) || "-"
  );
}

function itemDescription(item) {
  return cleanValue(item.services?.description || item.service?.description || item.description);
}

function itemVariant(item) {
  const serviceName = String(item.services?.name || "");
  const serviceVariant = cleanValue(splitServiceName(serviceName).variant);
  if (serviceVariant !== "-") return serviceVariant;

  return cleanValue(item.variant || variantFromNotes(item.notes || item.note) || item.color);
}

function itemUnitPrice(item) {
  const servicePrice = numericValue(item.services?.price);
  if (servicePrice !== null) return servicePrice;

  const direct = numericValue(item.price);
  if (direct !== null) return direct;

  const subtotal = numericValue(item.subtotal);
  const quantity = positiveNumber(item.quantity, 1);

  return subtotal !== null ? subtotal / quantity : null;
}

function itemUnitPriceFromRow(item) {
  const direct = numericValue(item.price);
  if (direct !== null) return direct;

  const subtotal = numericValue(item.subtotal);
  const quantity = positiveNumber(item.quantity, 1);

  return subtotal !== null ? subtotal / quantity : null;
}

function itemSubtotal(item, unitPrice, quantity) {
  const stored = numericValue(item.subtotal);
  return stored !== null ? stored : (unitPrice === null ? null : unitPrice * quantity);
}

function itemNote(item) {
  return cleanValue(
    String(item.notes || item.note || "")
      .replace(/\[service_type:[^\]]+\]\s*/ig, "")
      .replace(/\[variant:[^\]]+\]\s*/ig, "")
      .trim()
  );
}

function paymentMethodText(method) {
  const normalized = normalizeStatus(method);
  if (normalized === "cod" || normalized === "cash") return "Cash";
  if (normalized === "transfer" || normalized === "bank_transfer") return "Transfer";
  if (["ewallet", "e_wallet", "qris"].includes(normalized)) return "E-wallet";
  return cleanValue(method);
}

function formatRupiah(value, fallback = "-") {
  const number = numericValue(value);
  return number === null ? fallback : `Rp ${Math.round(number).toLocaleString("id-ID")}`;
}

function numericValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveNumber(value, fallback) {
  const number = numericValue(value);
  return number !== null && number > 0 ? number : fallback;
}

function cleanValue(value) {
  const text = String(value ?? "").trim();
  return text && text.toLowerCase() !== "null" && text.toLowerCase() !== "undefined" ? text : "-";
}

function variantFromNotes(note) {
  return String(note || "").match(/\[variant:([^\]]+)\]/i)?.[1]?.trim() || "";
}

function splitServiceName(name) {
  const value = String(name || "").trim();
  const separators = [" - ", " – ", " — "];

  const indexes = separators
    .map(separator => ({ separator, index: value.lastIndexOf(separator) }))
    .filter(item => item.index >= 0);

  if (!value || !indexes.length) return { base: value, variant: "" };

  const match = indexes.sort((a, b) => b.index - a.index)[0];

  return {
    base: value.slice(0, match.index).trim(),
    variant: value.slice(match.index + match.separator.length).trim(),
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function renderPhoto(order) {
  const grid = document.getElementById("order-photos-grid");
  const noPhoto = document.getElementById("no-photo");

  if (!grid) return;

  const photos = order.order_photos || [];

  if (photos.length) {
    // Hanya memakai signed_url dari response Edge Function; tanpa fallback URL publik.
    grid.innerHTML = photos.map((photo, index) => {
      const url = typeof photo.signed_url === "string" ? photo.signed_url.trim() : "";
      if (!url) {
        return `<div class="no-photo">Foto tidak tersedia</div>`;
      }
      return `<img src="${escapeAttr(url)}" alt="Foto item ${index + 1}" loading="lazy" />`;
    }).join("");
    return;
  }

  grid.innerHTML = "";

  if (noPhoto) {
    noPhoto.classList.remove("hidden");
    grid.appendChild(noPhoto);
  } else {
    grid.innerHTML = `<div class="no-photo">Tidak ada foto</div>`;
  }
}

function renderTimeline(statusKey) {
  const container = document.getElementById("timeline");
  if (!container) return;

  container.innerHTML = "";
  const activeIndex = STATUS_STEP_INDEX[statusKey] ?? 0;

  if (statusKey === "cancelled") {
    container.innerHTML = `
      <div class="timeline-item">
        <div class="timeline-left">
          <div class="timeline-dot done" style="background:#b91c1c;border-color:#b91c1c;">x</div>
        </div>
        <div class="timeline-right">
          <p class="timeline-label done">Order dibatalkan</p>
        </div>
      </div>
    `;
    return;
  }

  TIMELINE_STEPS.forEach((step, idx) => {
    const isDone = idx < activeIndex;
    const isActive = idx === activeIndex;
    const isLast = idx === TIMELINE_STEPS.length - 1;
    const item = document.createElement("div");
    item.className = "timeline-item";
    item.innerHTML = `
      <div class="timeline-left">
        <div class="timeline-dot ${isDone ? "done" : isActive ? "active" : ""}">${isDone ? "&#10003;" : ""}</div>
        ${!isLast ? `<div class="timeline-line ${isDone ? "done" : ""}"></div>` : ""}
      </div>
      <div class="timeline-right">
        <p class="timeline-label ${isDone ? "done" : isActive ? "active" : ""}">${step.label}</p>
      </div>
    `;
    container.appendChild(item);
  });
}

function showLoading() {
  loadingEl?.classList.remove("hidden");
  errorEl?.classList.add("hidden");
  orderCardEl?.classList.add("hidden");
}

function showError(
  title = "Order tidak ditemukan",
  message = "Pastikan link atau QR code yang kamu scan sudah benar."
) {
  loadingEl?.classList.add("hidden");
  orderCardEl?.classList.add("hidden");

  const titleEl = errorEl?.querySelector(".state-title");
  const textEl = errorEl?.querySelector(".state-text");

  if (titleEl) titleEl.textContent = title;
  if (textEl) textEl.textContent = message;

  errorEl?.classList.remove("hidden");
  helpCardEl?.classList.remove("hidden");
}

function serviceNames(order) {
  const names = (order.order_items || []).map(serviceValue).filter(Boolean);
  return [...new Set(names)].join(", ") || "-";
}

function itemTypes(order) {
  const names = (order.order_items || []).map(item => item.item_type).filter(Boolean);
  return [...new Set(names)].join(", ") || "-";
}

function finalItemType(orderItems) {
  const values = (orderItems || []).map(item => item.item_type).filter(Boolean);
  return [...new Set(values)].join(", ") || "-";
}

function finalServiceType(orderItems) {
  const values = (orderItems || [])
    .map(serviceValue)
    .filter(Boolean);

  return [...new Set(values)].join(", ") || "-";
}

function finalPaymentStatus(order, payment) {
  const status = payment?.status || order?.payment_status || "-";
  const normalized = normalizeStatus(status);

  if (normalized === "paid") return "DIBAYAR";
  if (normalized === "unpaid") return "BELUM DIBAYAR";
  if (normalized === "partial") return "SEBAGIAN";

  return status === "-"
    ? "-"
    : String(status).charAt(0).toUpperCase() + String(status).slice(1);
}

function notes(order) {
  return (order.order_items || [])
    .map(itemNote)
    .filter(value => value && value !== "-")
    .join(", ") || "-";
}

function serviceFromNotes(note) {
  return String(note || "").match(/\[service_type:([^\]]+)\]/i)?.[1]?.trim() || "";
}

function serviceValue(item) {
  const resolved = itemServiceLabel(item, cleanValue(item.item_type));

  if (resolved && resolved !== "-") return resolved;

  return item.service_type ||
    item.service_name ||
    item.service ||
    item.services?.name ||
    serviceFromNotes(item.notes || item.note);
}

function stripServiceFromNotes(note) {
  return String(note || "").replace(/^\[service_type:[^\]]+\]\s*/i, "").trim();
}

function paymentStatusText(payment) {
  if (!payment) return "-";

  const status = normalizeStatus(payment.status);
  if (status === "paid") return "DIBAYAR";
  if (status === "partial") return "SEBAGIAN";
  if (status === "unpaid") return "BELUM DIBAYAR";

  const total = Number(payment.amount || 0);
  const paid = Number(payment.paid_amount || 0);

  if (total > 0 && paid >= total) return "DIBAYAR";
  if (paid > 0) return "SEBAGIAN";

  return "BELUM DIBAYAR";
}

function trackingPayment(order) {
  return Array.isArray(order.payments) ? order.payments[0] || null : order.payment || null;
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value || "-";
}

function setManyText(ids, value) {
  ids.forEach(id => setText(id, value));
}

function setTrackingValue(id, labelText, value) {
  setText(id, value);
  setValueByLabel(labelText, value);
}

function setValueByLabel(labelText, value) {
  const normalizedLabel = normalizeLabel(labelText);
  const labels = [...document.querySelectorAll(".info-label, label, span, p")];
  const labelEl = labels.find(el => normalizeLabel(el.textContent) === normalizedLabel);

  if (!labelEl) {
    console.log("tracking label not found:", labelText);
    return;
  }

  const row = labelEl.closest(".info-row") || labelEl.parentElement;
  const valueEl = row?.querySelector(".info-value");

  if (valueEl) {
    valueEl.textContent = value || "-";
    return;
  }

  const next = labelEl.nextElementSibling;
  if (next) next.textContent = value || "-";
}

function normalizeLabel(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function ensureTrackingDom() {
  ["service-type", "item-type", "payment-status"].forEach(id => {
    console.log(`tracking DOM #${id}:`, document.getElementById(id));
  });
}

function normalizeStatus(status) {
  return String(status || "pending").toLowerCase().replaceAll(" ", "_").replaceAll("-", "_");
}

function normalizeTrackingToken(value) {
  return String(value || "").trim();
}

function formatDate(isoString) {
  if (!isoString) return "-";

  return new Date(isoString).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}