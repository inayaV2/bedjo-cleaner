const session = JSON.parse(sessionStorage.getItem("bc_session") || "null");
let dashboardOrders = [];
let activeQrOrder = null;

if (session) {
  const uName = document.getElementById("uName");
  if (uName) uName.textContent = session.role === "operator" ? "Operator" : (session.name || "Operator");
}

const userPill = document.getElementById("userPill");
const uDropdown = document.getElementById("uDropdown");

userPill?.addEventListener("click", (e) => {
  e.stopPropagation();
  uDropdown?.classList.toggle("open");
});

uDropdown?.addEventListener("click", (e) => e.stopPropagation());
document.addEventListener("click", () => uDropdown?.classList.remove("open"));

document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  if (window.supabaseClient) await supabaseClient.auth.signOut();
  sessionStorage.removeItem("bc_session");
  localStorage.removeItem("bedjo_session");
  localStorage.removeItem("bc_remember");
  window.location.href = "../login.html";
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

async function loadDashboardData() {
  renderTableState("Memuat data order...");
  setText("sToday", "...");
  setText("sProgress", "...");
  setText("sCompleted", "...");
  setText("sRevenue", "...");

  const { data: orders, error } = await supabaseClient
    .from("orders")
    .select(`
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
      ),
      payments (
        method,
        amount,
        paid_amount,
        status
      )
    `)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error load dashboard orders:", error);
    renderTableState("Gagal memuat data dashboard");
    renderStats([]);
    return;
  }

  dashboardOrders = orders || [];
  renderStats(dashboardOrders);
  renderTable(dashboardOrders);
  setActiveQrOrder(dashboardOrders[0] || null);
}

function renderStats(orders) {
  const today = new Date().toLocaleDateString("en-CA");
  const todayOrders = orders.filter(order => localDateKey(order.created_at) === today);
  const inProgress = orders.filter(order => ["on_process", "process"].includes(normalizeStatus(order.status)));
  const completed = orders.filter(order => normalizeStatus(order.status) === "completed");
  const revenue = orders.reduce((sum, order) => {
    return sum + (order.payments || [])
      .filter(payment => normalizePaymentStatus(payment.status, payment.amount, payment.paid_amount) === "paid")
      .reduce((pSum, payment) => pSum + Number(payment.paid_amount || 0), 0);
  }, 0);

  setText("sToday", todayOrders.length);
  setText("sProgress", inProgress.length);
  setText("sCompleted", completed.length);
  setText("sRevenue", formatRupiah(revenue));
}

function renderTable(orders) {
  const tblBody = document.getElementById("tblBody");
  if (!tblBody) return;

  if (!orders.length) {
    renderTableState("Belum ada data order");
    return;
  }

  tblBody.innerHTML = orders.map(order => {
    const status = normalizeStatus(order.status);
    const statusClass = status === "completed" ? "badge-ok" : ["on_process", "process"].includes(status) ? "badge-on" : "badge-pnd";

    return `
      <tr>
        <td>${escapeHtml(order.customer_name || "-")}</td>
        <td>${escapeHtml(serviceNames(order))}</td>
        <td><span class="badge ${statusClass}">${formatStatus(order.status)}</span></td>
        <td>${formatDate(order.created_at)}</td>
        <td>
          <div class="act-btns">
            <button class="act-btn" title="View Detail" onclick="viewOrder('${order.id}')">View</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function renderTableState(message) {
  const tblBody = document.getElementById("tblBody");
  if (!tblBody) return;
  tblBody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px; color:#6B7280;">${escapeHtml(message)}</td></tr>`;
}

function setActiveQrOrder(order) {
  activeQrOrder = order;
  if (!order?.order_code) {
    document.querySelector(".qr-sub")?.replaceChildren(document.createTextNode("Belum ada order"));
    const label = document.querySelector(".track-url");
    if (label) label.textContent = "-";
    const container = document.getElementById("qrCanvas");
    if (container) container.innerHTML = `<span style="font-size:0.8rem;color:#6B7280;">Tidak ada QR</span>`;
    return;
  }

  const code = order.order_code;
  const trackingUrl = buildTrackingUrl(code);

  document.querySelector(".qr-sub")?.replaceChildren(document.createTextNode(`Order #${code}`));
  const label = document.querySelector(".track-url");
  if (label) label.textContent = displayTrackingUrl(trackingUrl);
  drawQR(trackingUrl);
}

function drawQR(text) {
  const container = document.getElementById("qrCanvas");
  if (!container) return;
  if (typeof QRCode !== "undefined") {
    container.innerHTML = "";
    new QRCode(container, {
      text,
      width: 160,
      height: 160,
      colorDark: "#000000",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.H,
    });
    return;
  }

  container.innerHTML = `<canvas width="160" height="160"></canvas>`;
  const canvas = container.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  const size = canvas.width;
  const cell = 8;
  const cols = size / cell;

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, size, size);

  function finder(x, y) {
    ctx.fillStyle = "#000";
    ctx.fillRect(x, y, 7 * cell, 7 * cell);
    ctx.fillStyle = "#fff";
    ctx.fillRect(x + cell, y + cell, 5 * cell, 5 * cell);
    ctx.fillStyle = "#000";
    ctx.fillRect(x + 2 * cell, y + 2 * cell, 3 * cell, 3 * cell);
  }

  finder(0, 0);
  finder((cols - 7) * cell, 0);
  finder(0, (cols - 7) * cell);

  let hash = 0;
  for (const char of text) hash = ((hash << 5) - hash) + char.charCodeAt(0);

  ctx.fillStyle = "#000";
  for (let r = 0; r < cols; r++) {
    for (let c = 0; c < cols; c++) {
      if ((r < 8 && c < 8) || (r < 8 && c > cols - 9) || (r > cols - 9 && c < 8)) continue;
      if (((hash * (r + 1) * 31 + (c + 1) * 17) & 255) > 110) ctx.fillRect(c * cell, r * cell, cell, cell);
    }
  }
}

document.getElementById("btnDlQR")?.addEventListener("click", () => {
  if (!activeQrOrder?.order_code) return alert("Belum ada QR untuk diunduh.");
  const canvas = document.querySelector("#qrCanvas canvas");
  const img = document.querySelector("#qrCanvas img");
  const code = activeQrOrder?.order_code || "tracking";
  const a = document.createElement("a");
  a.download = `QR_${code}.png`;
  a.href = canvas ? canvas.toDataURL("image/png") : (img?.src || "");
  if (a.href) a.click();
});

document.getElementById("btnWA")?.addEventListener("click", () => {
  if (!activeQrOrder?.order_code) return alert("Belum ada order untuk dikirim.");
  const code = activeQrOrder.order_code;
  const trackingUrl = buildTrackingUrl(code);
  const text = encodeURIComponent(`Halo, berikut link tracking pesanan Bedjo Cleaner Anda: ${trackingUrl}`);
  window.open(`https://wa.me/?text=${text}`, "_blank");
});

document.getElementById("btnCopy")?.addEventListener("click", () => {
  if (!activeQrOrder?.order_code) return alert("Belum ada link tracking untuk disalin.");
  const code = activeQrOrder.order_code;
  navigator.clipboard.writeText(buildTrackingUrl(code));
  const btn = document.getElementById("btnCopy");
  if (btn) {
    btn.textContent = "Copied!";
    setTimeout(() => btn.textContent = "Copy Link", 1500);
  }
});

document.getElementById("btnNewOrder")?.addEventListener("click", () => {
  window.location.href = "order-create.html";
});

document.getElementById("searchInput")?.addEventListener("input", function () {
  const keyword = this.value.toLowerCase();
  const filtered = dashboardOrders.filter(order =>
    (order.customer_name || "").toLowerCase().includes(keyword) ||
    (order.customer_phone || "").toLowerCase().includes(keyword) ||
    (order.order_code || "").toLowerCase().includes(keyword) ||
    serviceNames(order).toLowerCase().includes(keyword)
  );
  renderTable(filtered);
});

function viewOrder(id) {
  window.location.href = `order-detail.html?id=${encodeURIComponent(id)}`;
}

function serviceNames(order) {
  const names = (order.order_items || []).map(item => item.services?.name || item.item_type).filter(Boolean);
  return [...new Set(names)].join(", ") || "-";
}

function normalizeStatus(status) {
  return String(status || "pending").toLowerCase().replaceAll(" ", "_").replaceAll("-", "_");
}

function normalizePaymentStatus(status, amount, paidAmount) {
  const raw = String(status || "").toLowerCase();
  if (["paid", "partial", "unpaid"].includes(raw)) return raw;
  const total = Number(amount || 0);
  const paid = Number(paidAmount || 0);
  if (total > 0 && paid >= total) return "paid";
  if (paid > 0) return "partial";
  return "unpaid";
}

function formatStatus(status) {
  const normalized = normalizeStatus(status);
  if (normalized === "on_process" || normalized === "process") return "ON PROCESS";
  if (normalized === "completed") return "COMPLETED";
  if (normalized === "pending") return "PENDING";
  return String(status || "-").toUpperCase();
}

function formatDate(dateString) {
  if (!dateString) return "-";
  return new Date(dateString).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

function localDateKey(dateString) {
  if (!dateString) return "";
  return new Date(dateString).toLocaleDateString("en-CA");
}

function formatRupiah(value) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value || 0);
}

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

loadDashboardData();
