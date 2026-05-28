const session = JSON.parse(sessionStorage.getItem("bc_session") || localStorage.getItem("bedjo_session") || "null");
if (!session || !["operator", "admin"].includes(session.role)) window.location.replace("../login.html");

document.addEventListener("DOMContentLoaded", () => {
  initProfile();
  initDrawer();
  loadTransactionDetail();
});

let currentPaymentId = "";
let proofChannel = null;
let currentProfile = null;

async function loadTransactionDetail() {
  const id = new URLSearchParams(window.location.search).get("id");
  if (!id) {
    window.location.replace("transactions.html");
    return;
  }

  renderLoading();
  currentProfile = currentProfile || await loadCurrentProfile();

  if (isOperatorScoped() && !currentProfile?.branch_id) {
    renderEmpty();
    return;
  }

  let query = supabaseClient
    .from("payments")
    .select(`
      id,
      order_id,
      method,
      amount,
      paid_amount,
      status,
      created_at,
      orders!inner (
        id,
        order_code,
        customer_name,
        customer_phone,
        status,
        branch_id,
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
    .eq("id", id);

  if (isOperatorScoped()) query = query.eq("orders.branch_id", currentProfile.branch_id);

  const { data: payment, error } = await query.maybeSingle();

  if (error) {
    console.error("Error load payment detail:", error);
    renderEmpty();
    return;
  }

  if (!payment) {
    renderEmpty();
    return;
  }

  const transaction = mapPayment(payment);
  currentPaymentId = payment.id;
  renderTransaction(transaction);
  await loadPaymentProof(payment.id);
  subscribePaymentProof(payment.id);
}

function mapPayment(payment) {
  const order = payment.orders || {};
  const amount = Number(payment.amount || 0);
  const paidAmount = Number(payment.paid_amount || 0);
  const status = normalizePaymentStatus(payment.status, amount, paidAmount);
  return {
    id: payment.id,
    orderId: order.id || payment.order_id,
    idLabel: `TRX-${String(payment.id).slice(0, 8).toUpperCase()}`,
    orderCode: order.order_code || payment.order_id || "-",
    customer: order.customer_name || "-",
    phone: order.customer_phone || "-",
    date: formatDate(payment.created_at, true),
    method: payment.method || "-",
    amount,
    paidAmount,
    status,
    serviceType: serviceNames(order),
    itemType: itemTypes(order),
    orderStatus: formatOrderStatus(order.status),
  };
}

function renderLoading() {
  ["trxId", "orderId", "customerName", "phoneNumber", "trxDate", "paymentStatus", "paymentMethod", "totalAmount", "paidAmount", "remainingBalance", "serviceType", "itemDetails", "notes", "proofName", "timelineStatus", "orderStatus"].forEach(id => setText(id, "Memuat..."));
}

function renderEmpty() {
  setText("trxId", "Transaction not found");
  ["orderId", "customerName", "phoneNumber", "trxDate", "paymentStatus", "paymentMethod", "totalAmount", "paidAmount", "remainingBalance", "serviceType", "itemDetails", "notes", "proofName", "timelineStatus", "orderStatus"].forEach(id => setText(id, "-"));
}

function renderTransaction(transaction) {
  const remaining = Math.max(transaction.amount - transaction.paidAmount, 0);
  const displayStatus = statusLabel(transaction.status);

  setText("trxId", `#${transaction.idLabel}`);
  setText("orderId", `#${transaction.orderCode}`);
  setText("customerName", transaction.customer);
  setText("phoneNumber", transaction.phone);
  setText("trxDate", transaction.date);
  setText("paymentStatus", displayStatus);
  setText("paymentMethod", transaction.method);
  setText("totalAmount", formatRupiah(transaction.amount));
  setText("paidAmount", formatRupiah(transaction.paidAmount));
  setText("remainingBalance", formatRupiah(remaining));
  setText("serviceType", transaction.serviceType);
  setText("itemDetails", transaction.itemType);
  setText("notes", "-");
  setText("proofName", "Belum ada bukti pembayaran");
  renderProofImage("");
  setText("orderStatus", transaction.orderStatus);
  setText("timelineStatus", transaction.orderStatus);

  const statusPill = document.getElementById("overviewStatus");
  if (statusPill) {
    statusPill.textContent = displayStatus;
    statusPill.className = `td-status-pill ${transaction.status}`;
  }

  const paidBar = document.getElementById("paymentStatus");
  if (paidBar) paidBar.className = `td-paid-bar ${transaction.status}`;
}

async function loadPaymentProof(paymentId) {
  try {
    const { data, error } = await supabaseClient
      .from("payment_proofs")
      .select("id, payment_id, proof_url, file_path, created_at")
      .eq("payment_id", paymentId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw error;
    const proof = data?.[0] || null;
    renderProofImage(proof?.proof_url || "");
    setText("proofName", proof?.file_path || (proof?.proof_url ? "Payment proof uploaded" : "Belum ada bukti pembayaran"));
  } catch (error) {
    console.warn("Gagal load payment proof:", error);
    renderProofImage("");
    setText("proofName", "Belum ada bukti pembayaran");
  }
}

function renderProofImage(url) {
  const img = document.getElementById("proofImage");
  const placeholder = document.getElementById("proofPlaceholder");
  if (img && url) {
    img.src = url;
    img.style.display = "block";
    if (placeholder) placeholder.style.display = "none";
    return;
  }
  if (img) {
    img.removeAttribute("src");
    img.style.display = "none";
  }
  if (placeholder) placeholder.style.display = "";
}

function subscribePaymentProof(paymentId) {
  if (!paymentId || !supabaseClient.channel) return;
  if (proofChannel) supabaseClient.removeChannel(proofChannel);
  proofChannel = supabaseClient
    .channel(`payment-proof-${paymentId}`)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "payment_proofs",
      filter: `payment_id=eq.${paymentId}`,
    }, () => loadPaymentProof(paymentId))
    .subscribe();
}

function initProfile() {
  setText("uName", session.name || "Operator");
  const userPill = document.getElementById("userPill");
  const uDropdown = document.getElementById("uDropdown");
  userPill?.addEventListener("click", event => {
    event.stopPropagation();
    uDropdown?.classList.toggle("open");
  });
  uDropdown?.addEventListener("click", event => event.stopPropagation());
  document.addEventListener("click", () => uDropdown?.classList.remove("open"));
  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    sessionStorage.removeItem("bc_session");
    localStorage.removeItem("bedjo_session");
    localStorage.removeItem("bc_remember");
    window.location.href = "../login.html";
  });
}

function initDrawer() {
  const drawer = document.getElementById("drawer");
  const mainWrap = document.getElementById("mainWrap");
  const overlay = document.getElementById("overlay");
  const hamburger = document.getElementById("hamburger");
  let drawerOpen = window.innerWidth >= 768;
  function syncDrawer() {
    drawer?.classList.toggle("collapsed", !drawerOpen);
    mainWrap?.classList.toggle("expanded", !drawerOpen);
    overlay?.classList.toggle("show", !drawerOpen && window.innerWidth < 768);
  }
  if (window.innerWidth < 768) drawerOpen = false;
  syncDrawer();
  hamburger?.addEventListener("click", () => {
    drawerOpen = !drawerOpen;
    syncDrawer();
  });
  overlay?.addEventListener("click", () => {
    drawerOpen = false;
    syncDrawer();
  });
}

function serviceNames(order) {
  const names = (order.order_items || []).map(item => item.service_type || item.service_name || item.services?.name || serviceFromNotes(item.notes)).filter(Boolean);
  return [...new Set(names)].join(", ") || "-";
}

function serviceFromNotes(note) {
  return String(note || "").match(/\[service_type:([^\]]+)\]/i)?.[1]?.trim() || "";
}

function itemTypes(order) {
  const names = (order.order_items || []).map(item => item.item_type).filter(Boolean);
  return [...new Set(names)].join(", ") || "-";
}

function normalizePaymentStatus(status, amount, paidAmount) {
  const raw = String(status || "").toLowerCase();
  if (["paid", "partial", "unpaid"].includes(raw)) return raw;
  if (Number(amount || 0) > 0 && Number(paidAmount || 0) >= Number(amount || 0)) return "paid";
  if (Number(paidAmount || 0) > 0) return "partial";
  return "unpaid";
}

function statusLabel(status) {
  if (status === "paid") return "Paid";
  if (status === "unpaid") return "Unpaid";
  if (status === "partial") return "Partial";
  return status || "-";
}

function formatOrderStatus(status) {
  const value = String(status || "pending").toLowerCase().replaceAll(" ", "_");
  if (value === "on_process" || value === "process") return "ON PROCESS";
  if (value === "completed") return "COMPLETED";
  if (value === "pending") return "PENDING";
  return String(status || "-").toUpperCase();
}

function formatDate(dateString, withTime = false) {
  if (!dateString) return "-";
  const options = { day: "2-digit", month: "short", year: "numeric" };
  if (withTime) {
    options.hour = "2-digit";
    options.minute = "2-digit";
  }
  return new Date(dateString).toLocaleString("id-ID", options);
}

function formatRupiah(value) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value || 0);
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value || "-";
}

async function loadCurrentProfile() {
  const userId = await currentUserId();
  if (!userId) return { role: session?.role || "operator", branch_id: session?.branch_id || null };

  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, role, branch_id")
    .eq("id", userId)
    .maybeSingle();

  if (error) console.error("Error load operator profile:", error);
  return data || { role: session?.role || "operator", branch_id: session?.branch_id || null };
}

async function currentUserId() {
  try {
    const { data } = await supabaseClient.auth.getUser();
    return data?.user?.id || session?.user_id || session?.id || null;
  } catch {
    return session?.user_id || session?.id || null;
  }
}

function isOperatorScoped() {
  return String(currentProfile?.role || session?.role || "").toLowerCase() === "operator";
}
