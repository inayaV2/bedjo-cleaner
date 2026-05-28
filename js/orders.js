const session = getSession();
if (!session || !["operator", "admin"].includes(session.role)) window.location.replace("../login.html");

const PAGE_SIZE = 8;
let currentPage = 1;
let allOrders = [];
let filtered = [];
let filterVal = "";
let searchVal = "";
let ordersPageInitialized = false;
let currentProfile = null;

console.log("orders.js loaded");

async function loadOrders() {
  showTableMessage("Memuat data order...");
  console.log("loadOrders start");
  currentProfile = currentProfile || await loadCurrentProfile();

  if (isOperatorScoped() && !currentProfile?.branch_id) {
    allOrders = [];
    filtered = [];
    showTableMessage("Branch operator belum diset");
    renderPagination();
    return;
  }

  let didFinish = false;
  const loadingGuard = setTimeout(() => {
    if (!didFinish) {
      console.log("orders loading guard fired");
      showTableMessage("Gagal memuat data order. Coba refresh halaman.");
      renderPagination();
    }
  }, 10000);

  try {
    const { data, error } = await withTimeout(
      fetchOrdersOnly(),
      "Query orders sederhana terlalu lama.",
      8000
    );

    if (error) {
      console.log("orders Supabase simple error:", error);
      throw error;
    }

    allOrders = data || [];
    console.log("orders fetched count:", allOrders.length, allOrders);
    applyFilter();
    loadOrderRelationsInBackground();
  } catch (error) {
    console.log("orders load error:", error);
    console.error("Error load orders:", error);
    allOrders = [];
    filtered = [];
    showTableMessage("Gagal memuat data order");
    renderPagination();
  } finally {
    didFinish = true;
    clearTimeout(loadingGuard);
  }
}

async function loadOrderRelationsInBackground() {
  try {
    const { data, error } = await withTimeout(
      fetchOrdersWithRelations(),
      "Query relasi orders terlalu lama.",
      8000
    );

    if (error) {
      console.log("orders relation refresh error:", error);
      return;
    }

    allOrders = data || allOrders;
    console.log("orders relation refresh count:", allOrders.length, allOrders);
    applyFilter();
  } catch (error) {
    console.log("orders relation refresh timeout/error:", error);
  }
}

function fetchOrdersWithRelations() {
  let query = supabaseClient
    .from("orders")
    .select(`
      id,
      order_code,
      customer_name,
      customer_phone,
      customer_email,
      status,
      branch_id,
      created_at,
      order_items (
        item_type,
        color,
        notes,
        services (
          name,
          price,
          category
        )
      ),
      payments (
        method,
        amount,
        paid_amount,
        status
      )
    `)
    .order("created_at", { ascending: false });

  if (isOperatorScoped()) query = query.eq("branch_id", currentProfile.branch_id);
  return query;
}

function fetchOrdersOnly() {
  let query = supabaseClient
    .from("orders")
    .select("id, order_code, customer_name, customer_phone, customer_email, status, branch_id, created_at")
    .order("created_at", { ascending: false });

  if (isOperatorScoped()) query = query.eq("branch_id", currentProfile.branch_id);
  return query;
}

function withTimeout(promise, message, timeout = 8000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeout);
    }),
  ]);
}

function applyFilter() {
  const q = searchVal.trim().toLowerCase();
  const selectedStatus = normalizeStatus(filterVal);

  filtered = allOrders.filter(order => {
    const status = normalizeStatus(order.status);
    const matchStatus = !selectedStatus || status === selectedStatus;
    const matchSearch = !q ||
      (order.customer_name || "").toLowerCase().includes(q) ||
      (order.customer_phone || "").toLowerCase().includes(q) ||
      (order.order_code || "").toLowerCase().includes(q);

    return matchStatus && matchSearch;
  });

  currentPage = 1;
  renderTable();
  renderPagination();
}

function renderTable() {
  const tbody = document.getElementById("tblBody");
  if (!tbody) return;

  const start = (currentPage - 1) * PAGE_SIZE;
  const slice = filtered.slice(start, start + PAGE_SIZE);

  if (!slice.length) {
    showTableMessage("Belum ada data order");
    return;
  }

  tbody.innerHTML = slice.map(order => {
    const status = normalizeStatus(order.status);
    const payment = primaryPayment(order);
    const badgeClass = status === "completed" ? "badge-ok" : ["on_process", "process"].includes(status) ? "badge-on" : "badge-pnd";

    return `
      <tr>
        <td>${escapeHtml(order.customer_name || "-")}</td>
        <td>${escapeHtml(order.customer_phone || "-")}</td>
        <td>${escapeHtml(serviceNames(order))}</td>
        <td>${escapeHtml(itemTypes(order))}</td>
        <td><span class="badge ${badgeClass}">${formatStatus(order.status)}</span></td>
        <td>${escapeHtml(formatPaymentStatus(payment))}</td>
        <td>${formatDate(order.created_at)}</td>
        <td>
          <div class="act-btns">
            <button class="act-btn" title="View Detail" onclick="goDetail('${order.id}')">View</button>
            <button class="act-btn" title="Edit Order" onclick="goEdit('${order.id}')">Edit</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function showTableMessage(message) {
  const tbody = document.getElementById("tblBody");
  if (!tbody) {
    console.log("tblBody not found:", message);
    return;
  }
  tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:32px;color:#6B7280;">${escapeHtml(message)}</td></tr>`;
}

function renderPagination() {
  const total = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pgLabel = document.getElementById("pgLabel");
  const pgPrev = document.getElementById("pgPrev");
  const pgNext = document.getElementById("pgNext");
  const btnPrev = document.getElementById("btnPrevPg");
  const btnNext = document.getElementById("btnNextPg");

  if (currentPage > total) currentPage = total;
  if (pgLabel) pgLabel.textContent = `Page ${currentPage} of ${total}`;
  [pgPrev, btnPrev].forEach(btn => { if (btn) btn.disabled = currentPage === 1; });
  [pgNext, btnNext].forEach(btn => { if (btn) btn.disabled = currentPage === total; });
}

function changePage(delta) {
  const total = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  currentPage = Math.max(1, Math.min(total, currentPage + delta));
  renderTable();
  renderPagination();
}

function serviceNames(order) {
  const names = (order.order_items || []).map(item => item.services?.name).filter(Boolean);
  return [...new Set(names)].join(", ") || "-";
}

function itemTypes(order) {
  const items = (order.order_items || []).map(item => item.item_type).filter(Boolean);
  return [...new Set(items)].join(", ") || "-";
}

function primaryPayment(order) {
  return order.payments?.[0] || null;
}

function getSession() {
  try {
    return JSON.parse(sessionStorage.getItem("bc_session") || localStorage.getItem("bedjo_session") || "null");
  } catch {
    return null;
  }
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

function normalizeStatus(status) {
  return String(status || "").toLowerCase().replaceAll(" ", "_").replaceAll("-", "_");
}

function formatStatus(status) {
  const normalized = normalizeStatus(status || "pending");
  if (normalized === "on_process" || normalized === "process") return "ON PROCESS";
  if (normalized === "completed") return "COMPLETED";
  if (normalized === "pending") return "PENDING";
  if (normalized === "cancelled") return "CANCELLED";
  return String(status || "-").toUpperCase();
}

function formatPaymentStatus(payment) {
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

function formatDate(dateString) {
  if (!dateString) return "-";
  return new Date(dateString).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

function goDetail(id) {
  window.location.href = `order-detail.html?id=${encodeURIComponent(id)}`;
}

function goEdit(id) {
  window.location.href = `order-create.html?edit=${encodeURIComponent(id)}`;
}

function initShell() {
  const el = document.getElementById("uName");
  if (el && session) el.textContent = session.name || "Operator";

  let drawerOpen = window.innerWidth >= 768;
  function syncDrawer() {
    const drawer = document.getElementById("drawer");
    const mainWrap = document.getElementById("mainWrap");
    const overlay = document.getElementById("overlay");
    drawer?.classList.toggle("collapsed", !drawerOpen);
    mainWrap?.classList.toggle("expanded", !drawerOpen);
    overlay?.classList.toggle("show", !drawerOpen && window.innerWidth < 768);
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

  const userPill = document.getElementById("userPill");
  const uDropdown = document.getElementById("uDropdown");
  userPill?.addEventListener("click", e => {
    e.stopPropagation();
    uDropdown?.classList.toggle("open");
  });
  document.addEventListener("click", () => uDropdown?.classList.remove("open"));
  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    sessionStorage.removeItem("bc_session");
    localStorage.removeItem("bedjo_session");
    localStorage.removeItem("bc_remember");
    window.location.replace("../login.html");
  });
}

function initFilterSelect() {
  const csDisplay = document.getElementById("csDisplay");
  const csDropdown = document.getElementById("csDropdown");
  const csText = document.getElementById("csText");
  if (!csDisplay || !csDropdown) return;

  csDisplay.addEventListener("click", e => {
    e.stopPropagation();
    csDropdown.classList.toggle("open");
  });

  csDropdown.querySelectorAll(".cs-opt").forEach(opt => {
    opt.addEventListener("click", () => {
      filterVal = opt.dataset.val || "";
      if (csText) csText.textContent = opt.textContent.trim();
      csDropdown.querySelectorAll(".cs-opt").forEach(o => o.classList.remove("active"));
      opt.classList.add("active");
      csDropdown.classList.remove("open");
      applyFilter();
    });
  });

  document.addEventListener("click", () => csDropdown.classList.remove("open"));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function initOrdersPage() {
  if (ordersPageInitialized) return;
  ordersPageInitialized = true;
  console.log("initOrdersPage");

  initShell();
  initFilterSelect();
  document.getElementById("searchInput")?.addEventListener("input", function () {
    searchVal = this.value;
    applyFilter();
  });
  document.getElementById("pgPrev")?.addEventListener("click", () => changePage(-1));
  document.getElementById("pgNext")?.addEventListener("click", () => changePage(1));
  document.getElementById("btnPrevPg")?.addEventListener("click", () => changePage(-1));
  document.getElementById("btnNextPg")?.addEventListener("click", () => changePage(1));
  document.getElementById("btnCreate")?.addEventListener("click", () => window.location.href = "order-create.html");
  loadOrders();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initOrdersPage);
} else {
  initOrdersPage();
}

setTimeout(() => {
  const tbody = document.getElementById("tblBody");
  if (tbody && !tbody.children.length) {
    console.log("orders table still empty after bootstrap fallback");
    showTableMessage("Memuat data order...");
    loadOrders();
  }
}, 500);
