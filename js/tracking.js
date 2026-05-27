const STATUS_CONFIG = {
  pending: { label: "Received", badgeClass: "badge-pending" },
  received: { label: "Received", badgeClass: "badge-pending" },
  on_process: { label: "Processing", badgeClass: "badge-process" },
  processing: { label: "Processing", badgeClass: "badge-process" },
  process: { label: "Processing", badgeClass: "badge-process" },
  completed: { label: "Completed", badgeClass: "badge-completed" },
  cancelled: { label: "Dibatalkan", badgeClass: "badge-cancelled" },
};

const TIMELINE_STEPS = [
  { key: "received", label: "Received" },
  { key: "processing", label: "Processing" },
  { key: "completed", label: "Completed" },
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

  const [orderItems, payments, orderPhotos, paymentProofs] = await Promise.all([
    fetchOrderItems(order.id),
    fetchPayments(order.id),
    fetchOrderPhotos(order.id),
    fetchPaymentProofs(order.id),
  ]);

  console.log("fetched order_items:", orderItems);
  console.log("fetched payments:", payments);
  console.log("fetched order_photos:", orderPhotos);
  console.log("fetched payment_proofs:", paymentProofs);

  subscribeTrackingMedia(order);
  renderTracking(order, orderItems, payments, orderPhotos, paymentProofs);
  requestAnimationFrame(() => renderTracking(order, orderItems, payments, orderPhotos, paymentProofs));
}

function renderTracking(order, orderItems = [], payments = [], photos = [], proofs = []) {
  order.order_items = orderItems || [];
  order.payments = payments || [];
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
      created_at
    `)
    .eq("order_code", orderCode)
    .maybeSingle();
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
  if (!serviceIds.length) return;

  const { data, error } = await supabaseClient
    .from("services")
    .select("id, name, price, category")
    .in("id", serviceIds);

  if (error) {
    console.warn("Tracking services fetch error:", error);
    return;
  }

  const map = new Map((data || []).map(service => [String(service.id), service]));
  items.forEach(item => {
    item.services = map.get(String(item.service_id)) || null;
  });
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
  setValueByLabel("Jenis layanan", renderedServiceType);
  setValueByLabel("Jenis item", renderedItemType);
  setValueByLabel("Payment status", renderedPaymentStatus);
  setText("order-note", notes(order));
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
  const img = document.getElementById("item-photo");
  const noPhoto = document.getElementById("no-photo");
  const photoUrl = order.order_photos?.[0]?.photo_url || "";

  if (img && photoUrl) {
    img.src = photoUrl;
    img.classList.remove("hidden");
    noPhoto?.classList.add("hidden");
    return;
  }

  img?.classList.add("hidden");
  noPhoto?.classList.remove("hidden");
}

function renderPaymentProof(order) {
  const img = document.getElementById("payment-proof-photo");
  const noProof = document.getElementById("no-payment-proof");
  const proofUrl = order.payment_proofs?.[0]?.proof_url || "";

  if (img && proofUrl) {
    img.src = proofUrl;
    img.classList.remove("hidden");
    noProof?.classList.add("hidden");
    return;
  }

  img?.classList.add("hidden");
  noProof?.classList.remove("hidden");
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
    .map(item => item.service_type || serviceFromNotes(item.notes || item.note))
    .filter(Boolean);
  return [...new Set(values)].join(", ") || "-";
}

function finalPaymentStatus(order, payment) {
  const status = payment?.status || order?.payment_status || "-";
  const normalized = normalizeStatus(status);
  if (normalized === "paid") return "Paid";
  if (normalized === "unpaid") return "Unpaid";
  if (normalized === "partial") return "Partial";
  return status === "-" ? "-" : String(status).charAt(0).toUpperCase() + String(status).slice(1);
}

function notes(order) {
  return (order.order_items || []).map(item => stripServiceFromNotes(item.notes)).filter(Boolean).join(", ") || "-";
}

function serviceFromNotes(note) {
  return String(note || "").match(/^\[service_type:([^\]]+)\]/i)?.[1]?.trim() || "";
}

function serviceValue(item) {
  return item.service_type ||
    item.service_name ||
    serviceFromNotes(item.notes || item.note);
}

function stripServiceFromNotes(note) {
  return String(note || "").replace(/^\[service_type:[^\]]+\]\s*/i, "").trim();
}

function paymentStatusText(payment) {
  if (!payment) return "-";
  const status = normalizeStatus(payment.status);
  if (status === "paid") return "Paid";
  if (status === "partial") return "Partial";
  if (status === "unpaid") return "Unpaid";
  const total = Number(payment.amount || 0);
  const paid = Number(payment.paid_amount || 0);
  if (total > 0 && paid >= total) return "Paid";
  if (paid > 0) return "Partial";
  return "Unpaid";
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
