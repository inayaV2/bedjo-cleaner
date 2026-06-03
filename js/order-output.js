function getSession() {
  try {
    return JSON.parse(sessionStorage.getItem("bc_session"));
  } catch {
    return null;
  }
}

const session = getSession();
if (!session || session.role !== "operator") {
  window.location.replace("../login.html");
}

const outputOrderId = new URLSearchParams(window.location.search).get("id");
let order = readSavedOrder();
let trackingUrl = "";
let qrInstance = null;

if (!outputOrderId && !order) {
  window.location.replace("orders.html");
}

document.addEventListener("DOMContentLoaded", async () => {
  order = await loadOutputOrder();
  if (!order) {
    alert("Order tidak ditemukan.");
    window.location.replace("orders.html");
    return;
  }

  const orderCode = order.order_code || order.id;
  trackingUrl = buildTrackingUrl(orderCode);

  const uNameEl = document.getElementById("uName");
  if (uNameEl) uNameEl.textContent = session.role === "operator" ? "Operator" : (session.name || "Operator");

  const orderIdEl = document.getElementById("qrOrderId");
  if (orderIdEl) orderIdEl.textContent = `Order #${orderCode}`;

  const trackUrlEl = document.getElementById("trackingUrl");
  if (trackUrlEl) trackUrlEl.textContent = displayTrackingUrl(trackingUrl);

  renderQr(trackingUrl);
  setupDownloadQr(orderCode);
  setupWhatsappButton(order, trackingUrl);
  setupCopyLink();
  setupBackButton();
  setupDrawer();
  setupUserDropdown();
});

function readSavedOrder() {
  try {
    return JSON.parse(sessionStorage.getItem("bc_saved_order"));
  } catch {
    return null;
  }
}

async function loadOutputOrder() {
  if (!outputOrderId) return order;

  const { data, error } = await supabaseClient
    .from("orders")
    .select("id, order_code, customer_name, customer_phone")
    .eq("id", outputOrderId)
    .maybeSingle();

  if (error) {
    console.error("Gagal fetch order output:", error);
    return order;
  }

  return data || order;
}

function renderQr(url) {
  const container = document.getElementById("qrCodeContainer");
  if (container && typeof QRCode !== "undefined") {
    container.innerHTML = "";
    qrInstance = new QRCode(container, {
      text: url,
      width: 180,
      height: 180,
      colorDark: "#000000",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.H,
    });
    return;
  }

  if (container) {
    container.innerHTML = `<div style="font-size:0.8rem;color:#6B7280;text-align:center;padding:20px;">
      QR tidak dapat dimuat.<br>Cek koneksi internet.
    </div>`;
  }
}

function setupDownloadQr(orderCode) {
  document.getElementById("btnDlQR")?.addEventListener("click", () => {
    const canvas = document.querySelector("#qrCodeContainer canvas");
    const img = document.querySelector("#qrCodeContainer img");
    const link = document.createElement("a");
    link.download = `QR_${orderCode || "order"}.png`;
    link.href = canvas ? canvas.toDataURL("image/png") : (img?.src || "");
    if (link.href) link.click();
  });
}

function setupWhatsappButton(currentOrder, publicTrackingLink) {
  const whatsappButton = document.getElementById("btnWA");
  if (!whatsappButton) return;

  const rawPhone = currentOrder?.customer_phone || "";
  const normalizedPhone = normalizeWhatsappPhone(rawPhone);
  console.log("output whatsapp phone", rawPhone, normalizedPhone);

  if (!normalizedPhone) {
    whatsappButton.removeAttribute("href");
    whatsappButton.removeAttribute("target");
    whatsappButton.setAttribute("aria-disabled", "true");
    whatsappButton.addEventListener("click", event => {
      event.preventDefault();
      alert("Nomor WhatsApp pelanggan tidak tersedia");
    });
    return;
  }

  const message = [
    `Halo ${currentOrder.customer_name || ""}, berikut link tracking pesanan Bedjo Cleaner Anda:`,
    publicTrackingLink,
    `Kode Order: #${currentOrder.order_code || currentOrder.id || ""}`,
  ].join("\n");
  const whatsappUrl = `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`;

  whatsappButton.href = whatsappUrl;
  whatsappButton.target = "_blank";
  whatsappButton.rel = "noopener";
}

function normalizeWhatsappPhone(value) {
  let phone = String(value || "").replace(/[\s()+-]/g, "").replace(/\D/g, "");
  if (!phone) return "";
  if (phone.startsWith("0")) return `62${phone.slice(1)}`;
  if (phone.startsWith("8")) return `62${phone}`;
  return phone;
}

function setupCopyLink() {
  document.getElementById("btnCopy")?.addEventListener("click", () => {
    navigator.clipboard.writeText(trackingUrl).then(() => {
      setCopyButtonText("Copied!");
    }).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = trackingUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopyButtonText("Copied!");
    });
  });
}

function setCopyButtonText(text) {
  const btn = document.getElementById("btnCopy");
  if (!btn) return;
  btn.textContent = text;
  setTimeout(() => btn.textContent = "Copy Link", 2000);
}

function setupBackButton() {
  document.getElementById("btnBack")?.addEventListener("click", () => {
    sessionStorage.removeItem("bc_saved_order");
    window.location.href = "operator-dashboard.html";
  });
}

function setupDrawer() {
  let drawerOpen = window.innerWidth >= 768;

  function syncDrawer() {
    const drawer = document.getElementById("drawer");
    const mainWrap = document.getElementById("mainWrap");
    const overlay = document.getElementById("overlay");
    if (!drawer || !mainWrap) return;

    drawer.classList.toggle("collapsed", !drawerOpen);
    mainWrap.classList.toggle("expanded", !drawerOpen);
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
}

function setupUserDropdown() {
  const userPill = document.getElementById("userPill");
  const uDropdown = document.getElementById("uDropdown");
  userPill?.addEventListener("click", event => {
    event.stopPropagation();
    uDropdown?.classList.toggle("open");
  });
  document.addEventListener("click", () => uDropdown?.classList.remove("open"));
  document.getElementById("logoutBtn")?.addEventListener("click", () => {
    sessionStorage.removeItem("bc_session");
    window.location.replace("../login.html");
  });
}

function buildTrackingUrl(orderCode) {
  if (window.BedjoUrl?.tracking) return window.BedjoUrl.tracking(orderCode);
  const url = new URL("../public/tracking.html", window.location.href);
  url.searchParams.set("code", orderCode);
  url.searchParams.set("v", "20260603-6");
  return url.href;
}

function displayTrackingUrl(url) {
  return url.replace(/^https?:\/\//, "").replace(/^file:\/+/, "");
}
