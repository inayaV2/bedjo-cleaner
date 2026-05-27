const TRANSACTIONS = [];
let currentStatusFilter = "all";
let currentDateFilter = "all";

const tbody = document.getElementById("transactionTable");
const searchInput = document.getElementById("searchInput");
const operatorSession = JSON.parse(sessionStorage.getItem("bc_session") || "null");

if (!operatorSession || operatorSession.role !== "operator") {
  window.location.replace("../login.html");
} else {
  const el = document.getElementById("uName");
  if (el) el.textContent = operatorSession.name || "Operator";
}

async function loadTransactions() {
  renderSummary([]);
  renderTableMessage("Memuat data transaksi...");

  const { data, error } = await supabaseClient
    .from("payments")
    .select(`
      id,
      order_id,
      method,
      amount,
      paid_amount,
      status,
      created_at,
      orders (
        id,
        order_code,
        customer_name,
        customer_phone,
        status,
        created_at,
        order_items (
          item_type,
          services (
            name,
            price,
            category
          )
        )
      )
    `)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error load payments:", error);
    TRANSACTIONS.splice(0);
    renderTableMessage("Gagal memuat data transaksi");
    return;
  }

  const mapped = (data || []).map(mapPayment);
  TRANSACTIONS.splice(0, TRANSACTIONS.length, ...mapped);
  sessionStorage.setItem("bc_transactions_cache", JSON.stringify(TRANSACTIONS));
  applyFilters();
}

function mapPayment(payment) {
  const order = payment.orders || {};
  const amount = Number(payment.amount || 0);
  const paidAmount = Number(payment.paid_amount || 0);
  return {
    id: payment.id,
    orderId: order.id || payment.order_id,
    idLabel: `TRX-${String(payment.id).slice(0, 8).toUpperCase()}`,
    orderCode: order.order_code || payment.order_id || "-",
    customer: order.customer_name || "-",
    phone: order.customer_phone || "-",
    method: payment.method || "-",
    amount,
    paidAmount,
    status: normalizePaymentStatus(payment.status, amount, paidAmount),
    date: formatDate(payment.created_at || order.created_at),
    createdAt: payment.created_at || order.created_at || null,
    orderStatus: order.status || "-",
    serviceType: serviceNames(order),
    itemType: itemTypes(order),
  };
}

function renderSummary(data) {
  const paidRevenue = data
    .filter(t => t.status === "paid")
    .reduce((sum, t) => sum + Number(t.paidAmount || 0), 0);

  setText("totalRevenue", formatRupiah(paidRevenue));
  setText("totalTransactions", data.length);
  setText("paidOrders", data.filter(t => t.status === "paid").length);
  setText("unpaidOrders", data.filter(t => t.status === "unpaid").length);
}

function renderTable(data) {
  if (!tbody) return;
  if (!data.length) {
    renderTableMessage("Belum ada data transaksi");
    return;
  }

  tbody.innerHTML = data.map(t => `
    <tr>
      <td>${escapeHtml(t.idLabel)}</td>
      <td>${escapeHtml(t.orderCode)}</td>
      <td>${escapeHtml(t.customer)}</td>
      <td>${escapeHtml(t.method)}</td>
      <td>${formatRupiah(t.amount)}</td>
      <td>${formatRupiah(t.paidAmount)}</td>
      <td><span class="badge ${badgeClass(t.status)}">${statusText(t.status)}</span></td>
      <td>${escapeHtml(t.date)}</td>
      <td>
        <div class="transaction-actions">
          <button class="act-btn" onclick="viewTransaction('${escapeHtml(t.id)}')">View Details</button>
          <button class="act-btn" onclick="openPaymentDrawer('${escapeHtml(t.id)}')">Update Payment</button>
        </div>
      </td>
    </tr>
  `).join("");
}

function renderTableMessage(message) {
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:24px; color:#6B7280;">${escapeHtml(message)}</td></tr>`;
}

function applyFilters() {
  const keyword = (searchInput?.value || "").toLowerCase();
  const filtered = TRANSACTIONS.filter(t => {
    const matchKeyword = !keyword ||
      t.customer.toLowerCase().includes(keyword) ||
      t.phone.toLowerCase().includes(keyword) ||
      t.orderCode.toLowerCase().includes(keyword) ||
      t.idLabel.toLowerCase().includes(keyword);
    const matchStatus = currentStatusFilter === "all" || t.status === currentStatusFilter;
    return matchKeyword && matchStatus && matchesDateFilter(t);
  });

  renderSummary(filtered);
  renderTable(filtered);
}

function matchesDateFilter(transaction) {
  if (currentDateFilter === "all") return true;
  if (!transaction.createdAt) return false;
  const date = new Date(transaction.createdAt);
  const now = new Date();
  const diffMs = now - date;
  const dayMs = 24 * 60 * 60 * 1000;
  if (currentDateFilter === "today") return isSameDay(date, now);
  if (currentDateFilter === "week") return diffMs >= 0 && diffMs <= 7 * dayMs;
  if (currentDateFilter === "month") return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  return true;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

searchInput?.addEventListener("input", applyFilters);

document.querySelectorAll("#statusTabs .seg-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#statusTabs .seg-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentStatusFilter = btn.dataset.status;
    applyFilters();
  });
});

document.querySelectorAll("#dateTabs .seg-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#dateTabs .seg-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentDateFilter = btn.dataset.date;
    applyFilters();
  });
});

const drawer = document.getElementById("drawer");
const mainWrap = document.getElementById("mainWrap");
const overlay = document.getElementById("overlay");
const hamburger = document.getElementById("hamburger");
let drawerOpen = true;

hamburger?.addEventListener("click", () => {
  drawerOpen = !drawerOpen;
  drawer?.classList.toggle("collapsed", !drawerOpen);
  mainWrap?.classList.toggle("expanded", !drawerOpen);
  if (drawerOpen) overlay?.classList.remove("show");
});

const userPill = document.getElementById("userPill");
const uDropdown = document.getElementById("uDropdown");
userPill?.addEventListener("click", e => {
  e.stopPropagation();
  uDropdown?.classList.toggle("open");
});
uDropdown?.addEventListener("click", e => e.stopPropagation());
document.addEventListener("click", () => uDropdown?.classList.remove("open"));

document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  sessionStorage.removeItem("bc_session");
  localStorage.removeItem("bedjo_session");
  localStorage.removeItem("bc_remember");
  window.location.href = "../login.html";
});

const paymentDrawer = document.getElementById("paymentDrawer");
const closePaymentDrawer = document.getElementById("closePaymentDrawer");
const selectedTransactionId = document.getElementById("selectedTransactionId");
const paymentMethod = document.getElementById("paymentMethod");
const amountPaid = document.getElementById("amountPaid");
const paymentProof = document.getElementById("paymentProof");
const proofPreview = document.getElementById("proofPreview");
let selectedProofDataUrl = "";
let selectedProofFile = null;

function openPaymentDrawer(id) {
  const trx = TRANSACTIONS.find(t => t.id === id);
  if (!trx) return;

  selectedTransactionId.value = trx.id;
  setPaymentStatus(trx.status);
  paymentMethod.value = paymentMethodValue(trx.method);
  amountPaid.value = trx.paidAmount;
  selectedProofDataUrl = "";
  selectedProofFile = null;
  loadPaymentProofPreview(trx.id);
  updatePaymentSummary(trx.amount, trx.paidAmount);

  paymentDrawer?.classList.add("show");
  overlay?.classList.add("show");
}

function closeDrawerPayment() {
  paymentDrawer?.classList.remove("show");
  overlay?.classList.remove("show");
}

function updatePaymentSummary(total, paid) {
  setText("sumSubtotal", formatRupiah(total));
  setText("sumPaid", formatRupiah(paid));
  setText("sumRemaining", formatRupiah(Math.max(Number(total || 0) - Number(paid || 0), 0)));
}

amountPaid?.addEventListener("input", () => {
  const trx = TRANSACTIONS.find(t => t.id === selectedTransactionId.value);
  if (trx) updatePaymentSummary(trx.amount, Number(amountPaid.value));
});

document.getElementById("paymentForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const trx = TRANSACTIONS.find(t => t.id === selectedTransactionId.value);
  if (!trx) return;

  const nextStatus = getPaymentStatus();
  const nextMethod = normalizePaymentMethod(paymentMethod.value);
  const nextPaidAmount = normalizePaidAmount(nextStatus, Number(amountPaid.value || 0), trx.amount);
  const submitBtn = e.submitter || document.querySelector("#paymentForm button[type='submit']");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Saving...";
  }

  const { error } = await updatePaymentRecord(trx.id, {
    status: nextStatus,
    method: nextMethod,
    paid_amount: nextPaidAmount,
  });

  if (error) {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Save Changes";
    }
    console.error("Error update payment:", error);
    alert("Gagal update payment: " + (error.message || error));
    return;
  }

  if (selectedProofFile) await savePaymentProof(trx, selectedProofFile);
  await createNotification({
    type: "payment_updated",
    title: "Payment updated",
    message: `Payment ${trx.orderCode} diupdate menjadi ${nextStatus}.`,
    order_id: trx.orderId,
    order_code: trx.orderCode,
    customer_name: trx.customer,
    customer_phone: trx.phone,
  });
  closeDrawerPayment();
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = "Save Changes";
  }
  alert("Payment updated successfully!");
  await loadTransactions();
});

closePaymentDrawer?.addEventListener("click", closeDrawerPayment);
overlay?.addEventListener("click", closeDrawerPayment);

document.querySelectorAll('input[name="paymentStatus"]').forEach(input => {
  input.addEventListener("change", () => {
    const trx = TRANSACTIONS.find(t => t.id === selectedTransactionId.value);
    if (!trx) return;
    if (input.value === "paid") amountPaid.value = trx.amount;
    if (input.value === "unpaid") amountPaid.value = 0;
    updatePaymentSummary(trx.amount, Number(amountPaid.value));
  });
});

paymentProof?.addEventListener("change", async () => {
  const file = paymentProof.files?.[0];
  if (!file) return;
  selectedProofFile = file;
  selectedProofDataUrl = await fileToDataUrl(file);
  renderProofPreview(selectedProofDataUrl);
});

async function updatePaymentRecord(paymentId, payload) {
  const direct = await supabaseClient
    .from("payments")
    .update(payload)
    .eq("id", paymentId);

  if (!direct.error) return direct;
  console.warn("Retry update payment without method:", direct.error);

  const noMethod = await supabaseClient
    .from("payments")
    .update({ status: payload.status, paid_amount: payload.paid_amount })
    .eq("id", paymentId);

  if (!noMethod.error) return noMethod;
  console.warn("Retry update payment with status derived from paid_amount only:", noMethod.error);

  return supabaseClient
    .from("payments")
    .update({ paid_amount: payload.paid_amount })
    .eq("id", paymentId);
}

function normalizePaidAmount(status, paidAmount, totalAmount) {
  if (status === "paid") return Number(totalAmount || 0);
  if (status === "unpaid") return 0;
  return Math.max(0, paidAmount);
}

function normalizePaymentMethod(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("transfer")) return "transfer";
  if (normalized.includes("wallet") || normalized.includes("qris")) return "ewallet";
  if (normalized.includes("cod") || normalized.includes("cash")) return "cod";
  return normalized || "transfer";
}

function paymentMethodValue(value) {
  const method = normalizePaymentMethod(value);
  if (method === "transfer") return "Transfer";
  if (method === "ewallet") return "E-wallet";
  if (method === "cod") return "COD";
  return value || "Transfer";
}

function renderProofPreview(dataUrl) {
  if (!proofPreview) return;
  proofPreview.innerHTML = dataUrl
    ? `<img src="${dataUrl}" alt="Payment proof" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">`
    : "";
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function savePaymentProof(trx, file) {
  const filePath = `${trx.orderId || trx.id}-${Date.now()}.${fileExtension(file.name)}`;
  const bucket = supabaseClient.storage.from("payment-proofs");
  try {
    const { error: uploadError } = await bucket.upload(filePath, file, {
      contentType: file.type || "image/jpeg",
      upsert: false,
    });
    if (uploadError) throw uploadError;

    const { data } = bucket.getPublicUrl(filePath);
    const publicUrl = data?.publicUrl || "";
    const { error: insertError } = await supabaseClient
      .from("payment_proofs")
      .insert({
        payment_id: trx.id,
        order_id: trx.orderId,
        proof_url: publicUrl,
        file_path: filePath,
      });
    if (insertError) throw insertError;
  } catch (error) {
    console.error("Gagal simpan payment proof ke Supabase:", error);
    alert("Payment terupdate, tapi upload bukti pembayaran gagal: " + (error.message || error));
  }
}

async function loadPaymentProofPreview(paymentId) {
  renderProofPreview("");
  try {
    const { data, error } = await supabaseClient
      .from("payment_proofs")
      .select("proof_url, file_path, created_at")
      .eq("payment_id", paymentId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw error;
    renderProofPreview(data?.[0]?.proof_url || "");
  } catch (error) {
    console.warn("Gagal load payment proof:", error);
  }
}

function fileExtension(name) {
  const ext = String(name || "").split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "");
  return ext || "jpg";
}

function setPaymentStatus(status) {
  const radio = document.querySelector(`input[name="paymentStatus"][value="${status}"]`);
  if (radio) radio.checked = true;
}

function getPaymentStatus() {
  return document.querySelector('input[name="paymentStatus"]:checked')?.value || "unpaid";
}

function viewTransaction(id) {
  window.location.href = `transaction-detail.html?id=${encodeURIComponent(id)}`;
}

function serviceNames(order) {
  const names = (order.order_items || []).map(item => item.services?.name).filter(Boolean);
  return [...new Set(names)].join(", ") || "-";
}

function itemTypes(order) {
  const names = (order.order_items || []).map(item => item.item_type).filter(Boolean);
  return [...new Set(names)].join(", ") || "-";
}

function normalizePaymentStatus(status, amount, paidAmount) {
  const raw = String(status || "").toLowerCase();
  if (["paid", "partial", "unpaid"].includes(raw)) return raw;
  const paid = Number(paidAmount || 0);
  const total = Number(amount || 0);
  if (total > 0 && paid >= total) return "paid";
  if (paid > 0) return "partial";
  return "unpaid";
}

function badgeClass(status) {
  if (status === "paid") return "badge-paid";
  if (status === "partial") return "badge-partial";
  return "badge-unpaid";
}

function statusText(status) {
  if (status === "paid") return "Paid";
  if (status === "partial") return "Partial";
  return "Unpaid";
}

function formatRupiah(num) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(num || 0));
}

function formatDate(dateString) {
  if (!dateString) return "-";
  return new Date(dateString).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function createNotification(payload) {
  if (window.BedjoNotification?.createNotification) {
    return window.BedjoNotification.createNotification(payload);
  }

  const notificationPayload = {
    type: payload.type || "payment_updated",
    title: payload.title || "Notification",
    message: payload.message || "",
    order_id: payload.order_id || null,
    order_code: payload.order_code || null,
    customer_name: payload.customer_name || null,
    customer_phone: payload.customer_phone || null,
    is_read: false,
    created_at: new Date().toISOString(),
  };

  console.log("insert notification payload:", notificationPayload);

  try {
    const result = await supabaseClient
      .from("notifications")
      .insert(notificationPayload);

    console.log("insert notification result:", result);

    if (result.error) {
      console.error("insert notification error:", result.error);
    }
  } catch (error) {
    console.error("insert notification exception:", error);
  }
}

renderSummary([]);
if (operatorSession && operatorSession.role === "operator") loadTransactions();
