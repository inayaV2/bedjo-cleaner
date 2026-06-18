const STATUS_CONFIG = {
  pending: { label: "Diterima", badgeClass: "badge-pending" },
  received: { label: "Diterima", badgeClass: "badge-pending" },
  on_process: { label: "Diproses", badgeClass: "badge-process" },
  processing: { label: "Diproses", badgeClass: "badge-process" },
  process: { label: "Diproses", badgeClass: "badge-process" },
  completed: { label: "Selesai", badgeClass: "badge-completed" },
  cancelled: { label: "Dibatalkan", badgeClass: "badge-cancelled" },
};

const TIMELINE_STEPS = [
  { key: "received", label: "Diterima" },
  { key: "processing", label: "Diproses" },
  { key: "completed", label: "Selesai" },
];

const STATUS_STEP_INDEX = {
  pending: 0,
  received: 0,
  on_process: 1,
  processing: 1,
  process: 1,
  completed: 2,
  cancelled: -1
};

const loadingEl = document.getElementById("loading-state");
const errorEl = document.getElementById("error-state");
const orderCardEl = document.getElementById("order-card");
const helpCardEl = document.getElementById("help-card");
const formEl = document.getElementById("tracking-form");
const inputEl = document.getElementById("tracking-input");
let trackingPhotosChannel = null;

document.addEventListener("DOMContentLoaded", () => {
  ensureTrackingDom();
  const params = new URLSearchParams(window.location.search);
  const code = normalizeTrackingCode(params.get("code") || params.get("order_id") || params.get("id"));
  console.log("tracking URL code:", code);

  if (code) {
    if (inputEl) inputEl.value = code;
    loadOrder(code);
  }

  formEl?.addEventListener("submit", event => {
    event.preventDefault();
    const value = normalizeTrackingCode(inputEl?.value);
    if (!value) {
      showError();
      return;
    }
    loadOrder(value);
  });
});

async function loadOrder(value) {
  showLoading();

  const orderCode = normalizeTrackingCode(value);
  console.log("tracking code:", orderCode);
  if (!orderCode) {
    showError();
    return;
  }

  const { data: order, error } = await fetchTrackingOrder(orderCode);

  if (error) {
    console.error("Tracking fetch error:", error);
    showError();
    return;
  }

  if (!order) {
    showError();
    return;
  }

  console.log("tracking order.id:", order.id);
  console.log("fetched order:", order);
  console.log("tracking order:", order);

  const [orderItems, payments, branch, orderPhotos, paymentProofs] = await Promise.all([
    fetchOrderItems(order.id),
    fetchPayments(order.id),
    fetchBranch(order.branch_id),
    fetchOrderPhotos(order.id),
    fetchPaymentProofs(order.id),
  ]);

  console.log("fetched order_items:", orderItems);
  console.log("fetched payments:", payments);
  console.log("fetched branch:", branch);
  console.log("fetched order_photos:", orderPhotos);
  console.log("fetched payment_proofs:", paymentProofs);

  subscribeTrackingMedia(order);
  renderTracking(order, orderItems, payments, branch, orderPhotos, paymentProofs);
  requestAnimationFrame(() => renderTracking(order, orderItems, payments, branch, orderPhotos, paymentProofs));
}

function renderTracking(order, orderItems = [], payments = [], branch = null, photos = [], proofs = []) {
  order.order_items = orderItems || [];
  order.payments = payments || [];
  order.branches = branch || null;
  order.order_photos = photos || [];
  order.payment_proofs = proofs || [];
  console.log("tracking order_items:", order.order_items);
  console.log("tracking payment:", trackingPayment(order));
  renderOrder(order);
}

async function fetchTrackingOrder(orderCode) {
  return supabaseClient
    .from("orders")
    .select(`
      id,
      order_code,
      customer_name,
      customer_phone,
      status,
      branch_id,
      total_amount,
      created_at
    `)
    .eq("order_code", orderCode)
    .maybeSingle();
}

async function fetchBranch(branchId) {
  if (!branchId) return null;
  const { data, error } = await supabaseClient
    .from("branches")
    .select("id, name")
    .eq("id", branchId)
    .maybeSingle();

  if (error) {
    console.warn("Tracking branch fetch error:", error);
    return null;
  }

  return data || null;
}

async function fetchOrderItems(orderId) {
  if (!orderId) return [];
  const simple = await supabaseClient
    .from("order_items")
    .select("*")
    .eq("order_id", orderId)
    .order("id", { ascending: true });

  if (simple.error) {
    console.warn("Tracking order_items fetch error:", simple.error);
    return [];
  }

  const items = simple.data || [];
  console.log("raw tracking order_items:", items);
  await attachServices(items);
  return items;
}

async function attachServices(items) {
  const serviceIds = [...new Set(items.map(item => item.service_id).filter(Boolean))];
  let services = [];

  if (serviceIds.length) {
    const { data, error } = await supabaseClient
      .from("services")
      .select("id, name, price, category, description")
      .in("id", serviceIds);

    if (error) {
      console.warn("Tracking services fetch error:", error);
    } else {
      services = data || [];
    }
  }

  const unresolvedItems = items.filter(item =>
    !item.service_id ||
    !services.some(service => String(service.id) === String(item.service_id))
  );
  const fallbackServices = await fetchFallbackServices(unresolvedItems);
  const allServices = mergeServices(services, fallbackServices);

  const map = new Map(allServices.map(service => [String(service.id), service]));
  items.forEach(item => {
    item.services = map.get(String(item.service_id)) || matchServiceByItem(allServices, item) || null;
  });
}

async function fetchFallbackServices(items) {
  const categories = [...new Set((items || [])
    .map(item => cleanValue(item.item_type))
    .filter(value => value !== "-"))];

  if (!categories.length) return [];

  const chunks = await Promise.all(categories.map(category =>
    supabaseClient
      .from("services")
      .select("id, name, price, category, description")
      .eq("category", category)
      .then(result => {
        if (result.error) {
          console.warn("Tracking fallback services fetch error:", result.error);
          return [];
        }
        return result.data || [];
      })
  ));

  return chunks.flat();
}

function mergeServices(primary, fallback) {
  const seen = new Set();
  return [...(primary || []), ...(fallback || [])].filter(service => {
    const key = service?.id ? `id:${service.id}` : `name:${service?.name || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function matchServiceByItem(services, item) {
  const itemType = normalizeLabel(item.item_type);
  const price = itemUnitPriceFromRow(item);
  const variant = normalizeLabel(item.variant || variantFromNotes(item.notes || item.note) || item.color);

  return (services || []).find(service => {
    const sameCategory = itemType && normalizeLabel(service.category) === itemType;
    const samePrice = price !== null && numericValue(service.price) === price;
    const sameVariant = !variant || normalizeLabel(service.name).includes(variant);
    return sameCategory && samePrice && sameVariant;
  }) || (services || []).find(service => {
    const sameCategory = itemType && normalizeLabel(service.category) === itemType;
    const samePrice = price !== null && numericValue(service.price) === price;
    return sameCategory && samePrice;
  }) || (services || []).find(service =>
    itemType && normalizeLabel(service.category) === itemType
  ) || null;
}

async function fetchPayments(orderId) {
  if (!orderId) return [];
  const { data, error } = await supabaseClient
    .from("payments")
    .select("id, order_id, method, amount, paid_amount, status, created_at")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false });
  if (error) {
    console.warn("Tracking payments fetch error:", error);
    return [];
  }
  return data || [];
}

function renderOrder(order) {
  const name = order.customer_name || "Customer";
  const statusKey = normalizeStatus(order.status);
  const statusCfg = STATUS_CONFIG[statusKey] || STATUS_CONFIG.pending;
  const payment = trackingPayment(order);
  const renderedItemType = finalItemType(order.order_items || []);
  const renderedServiceType = finalServiceType(order.order_items || []);
  const renderedPaymentStatus = finalPaymentStatus(order, payment);
  console.log("tracking DOM render targets:", {
    serviceTypeEl: document.getElementById("service-type"),
    itemTypeEl: document.getElementById("item-type"),
    paymentStatusEl: document.getElementById("payment-status"),
  });
  console.log("tracking final render values:", {
    serviceType: renderedServiceType,
    itemType: renderedItemType,
    paymentStatus: renderedPaymentStatus,
  });

  setText("avatar-initials", name.charAt(0).toUpperCase());
  setText("customer-name", name);
  setText("order-id", `Order ID: #${order.order_code || order.id}`);
  setText("order-date", formatDate(order.created_at));
  setText("customer-phone", order.customer_phone || "-");
  setManyText(["service-type", "serviceType", "iServiceType", "tracking-service-type"], renderedServiceType);
  setManyText(["item-type", "itemType", "iItemType", "tracking-item-type"], renderedItemType);
  setManyText(["payment-status", "paymentStatus", "iPaymentStatus", "tracking-payment-status"], renderedPaymentStatus);
  setText("branch-name", order.branches?.name || "-");
  setValueByLabel("Jenis layanan", renderedServiceType);
  setValueByLabel("Jenis item", renderedItemType);
  setValueByLabel("Status pembayaran", renderedPaymentStatus);
  setText("order-note", notes(order));
  renderOrderItems(order.order_items || []);
  renderPaymentSummary(order, payment);
  console.log("rendered service type:", renderedServiceType);
  console.log("rendered item type:", renderedItemType);
  console.log("rendered payment status:", renderedPaymentStatus);
  console.log("final itemType:", renderedItemType);
  console.log("final serviceType:", renderedServiceType);
  console.log("final paymentStatus:", renderedPaymentStatus);

  const badge = document.getElementById("status-badge");
  if (badge) {
    badge.textContent = statusCfg.label;
    badge.className = `status-badge ${statusCfg.badgeClass}`;
  }

  renderPhoto(order);
  renderPaymentProof(order);
  renderTimeline(statusKey);

  const waNumber = window.BedjoContact?.whatsappNumber?.() || "";
  const waMsg = encodeURIComponent(`Halo Bedjo Cleaner, saya ingin menanyakan status order #${order.order_code || order.id} atas nama ${name}.`);
  const waLink = document.getElementById("wa-link");
  if (waLink) waLink.href = waNumber
    ? `https://wa.me/${waNumber}?text=${waMsg}`
    : `https://wa.me/?text=${waMsg}`;

  loadingEl?.classList.add("hidden");
  errorEl?.classList.add("hidden");
  orderCardEl?.classList.remove("hidden");
  helpCardEl?.classList.remove("hidden");
}

function renderOrderItems(items) {
  const container = document.getElementById("order-items-list");
  if (!container) return;

  if (!items.length) {
    container.innerHTML = `<div class="order-item-empty">Detail item belum tersedia.</div>`;
    return;
  }

  container.innerHTML = items.map((item, index) => {
    const itemType = cleanValue(item.item_type || item.item_name || item.name);
    const service = itemServiceLabel(item, itemType);
    const variant = itemVariant(item);
    const quantity = positiveNumber(item.quantity, 1);
    const unitPrice = itemUnitPrice(item);
    const subtotal = itemSubtotal(item, unitPrice, quantity);
    const note = itemNote(item);
    const title = [service, variant].filter(value => value !== "-").join(" - ") || itemType;

    return `
      <article class="order-item-detail">
        <p class="order-item-number">Item ${index + 1}</p>
        <p class="order-item-title">${escapeHtml(title)}</p>
        <dl class="order-item-fields">
          <div><dt>Jenis item</dt><dd>${escapeHtml(itemType)}</dd></div>
          <div><dt>Layanan</dt><dd>${escapeHtml(service)}</dd></div>
          <div><dt>Variant</dt><dd>${escapeHtml(variant)}</dd></div>
          <div><dt>Qty</dt><dd>${quantity} x ${escapeHtml(formatRupiah(unitPrice, "-"))}</dd></div>
          <div><dt>Subtotal</dt><dd>${escapeHtml(formatRupiah(subtotal, "-"))}</dd></div>
          ${note !== "-" ? `<div class="order-item-note"><dt>Catatan</dt><dd>${escapeHtml(note)}</dd></div>` : ""}
        </dl>
      </article>
    `;
  }).join("");
}

function renderPaymentSummary(order, payment) {
  const itemsTotal = calculateItemsTotal(order.order_items || []);
  const paymentAmount = numericValue(payment?.amount);
  const orderAmount = numericValue(order.total_amount);
  const paymentStatus = normalizeStatus(payment?.status || order?.payment_status);
  const total = itemsTotal > 0
    ? itemsTotal
    : paymentAmount !== null
      ? paymentAmount
      : orderAmount;
  const storedPaid = numericValue(payment?.paid_amount);
  const paid = payment
    ? (paymentStatus === "paid" && (!storedPaid || storedPaid <= 0) ? total : (storedPaid ?? 0))
    : null;
  const remaining = total === null || paid === null ? null : Math.max(total - paid, 0);

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

function itemServiceLabel(item, itemType) {
  const relationName = cleanValue(item.services?.name);
  const relationBase = relationName === "-" ? "" : splitServiceName(relationName).base;
  return cleanValue(
    relationBase ||
    item.service_type ||
    item.service_name ||
    item.service ||
    serviceFromNotes(item.notes || item.note)
  );
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

async function fetchPaymentProofs(orderId) {
  if (!orderId) return [];
  try {
    const { data, error } = await supabaseClient
      .from("payment_proofs")
      .select("proof_url, file_path, created_at")
      .eq("order_id", orderId)
      .order("created_at", { ascending: false });
    if (error) {
      console.warn("Tracking payment_proofs fetch error:", error);
      return [];
    }
    return data || [];
  } catch (error) {
    console.warn("Tracking payment_proofs fetch error:", error);
    return [];
  }
}

async function fetchOrderPhotos(orderId) {
  if (!orderId) return [];
  try {
    const { data, error } = await supabaseClient
      .from("order_photos")
      .select("photo_url, file_path, created_at")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });
    if (error) {
      console.warn("Tracking order_photos fetch error:", error);
      return [];
    }
    return data || [];
  } catch (error) {
    console.warn("Tracking order_photos fetch error:", error);
    return [];
  }
}

function renderPhoto(order) {
  const grid = document.getElementById("order-photos-grid");
  const noPhoto = document.getElementById("no-photo");
  const photos = (order.order_photos || []).filter(photo => photo.photo_url);

  if (!grid) return;

  if (photos.length) {
    grid.innerHTML = photos.map((photo, index) => `
      <img src="${escapeAttr(photo.photo_url)}" alt="Foto item ${index + 1}" loading="lazy" />
    `).join("");
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

function renderPaymentProof(order) {
  const grid = document.getElementById("payment-proofs-grid");
  const noProof = document.getElementById("no-payment-proof");
  const proofs = (order.payment_proofs || []).filter(proof => proof.proof_url);

  if (!grid) return;

  if (proofs.length) {
    grid.innerHTML = proofs.map((proof, index) => `
      <img src="${escapeAttr(proof.proof_url)}" alt="Bukti pembayaran ${index + 1}" loading="lazy" />
    `).join("");
    return;
  }

  grid.innerHTML = "";
  if (noProof) {
    noProof.classList.remove("hidden");
    grid.appendChild(noProof);
  } else {
    grid.innerHTML = `<div class="no-photo">Tidak ada bukti pembayaran</div>`;
  }
}

function subscribeTrackingMedia(order) {
  if (!order?.id || !supabaseClient.channel) return;
  if (trackingPhotosChannel) supabaseClient.removeChannel(trackingPhotosChannel);
  trackingPhotosChannel = supabaseClient
    .channel(`tracking-media-${order.id}`)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "order_photos",
      filter: `order_id=eq.${order.id}`,
    }, async () => {
      order.order_photos = await fetchOrderPhotos(order.id);
      renderPhoto(order);
    })
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "payment_proofs",
      filter: `order_id=eq.${order.id}`,
    }, async () => {
      order.payment_proofs = await fetchPaymentProofs(order.id);
      renderPaymentProof(order);
    })
    .subscribe();
}

function renderTimeline(statusKey) {
  const container = document.getElementById("timeline");
  if (!container) return;
  container.innerHTML = "";
  const activeIndex = STATUS_STEP_INDEX[statusKey] ?? 0;

  if (statusKey === "cancelled") {
    container.innerHTML = `
      <div class="timeline-item">
        <div class="timeline-left"><div class="timeline-dot done" style="background:#b91c1c;border-color:#b91c1c;">x</div></div>
        <div class="timeline-right"><p class="timeline-label done">Order dibatalkan</p></div>
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

function showError() {
  loadingEl?.classList.add("hidden");
  orderCardEl?.classList.add("hidden");
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
  return status === "-" ? "-" : String(status).charAt(0).toUpperCase() + String(status).slice(1);
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

function normalizeTrackingCode(value) {
  return String(value || "")
    .trim()
    .replace(/^order\s*(id|code)?\s*:?\s*#?/i, "")
    .replace(/^#/, "")
    .trim()
    .toUpperCase();
}

function formatDate(isoString) {
  if (!isoString) return "-";
  return new Date(isoString).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
}
