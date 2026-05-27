const session = getSession();
if (!session || session.role !== "operator") window.location.replace("../login.html");

const orderId = new URLSearchParams(window.location.search).get("id");
let order = null;
let trackingUrl = "";
let orderPhotos = [];
let photosChannel = null;
const SERVICE_PRICE_FALLBACK = {
  "sepatu bersih": 20000,
  "tas bersih": 22000,
  "sepatu shoes cleaning": 20000,
  "tas bag cleaning": 22000,
};

document.addEventListener("DOMContentLoaded", async () => {
  initShell();
  initPhotoUpload();
  if (!orderId) {
    window.location.replace("orders.html");
    return;
  }
  await loadOrder();
});

async function loadOrder() {
  renderLoading();

  const { data, error } = await fetchOrderDetail(orderId);

  if (error) {
    console.error("Error load order detail:", error);
    showToast("Gagal memuat detail order.");
    return;
  }

  order = data?.[0] || null;
  if (!order) {
    showToast("Order tidak ditemukan.");
    setTimeout(() => window.location.replace("orders.html"), 900);
    return;
  }

  orderPhotos = await fetchOrderPhotos(order.id);
  subscribeOrderPhotos(order.id);
  renderOrder();
}

async function fetchOrderDetail(value) {
  const fullSelect = `
      id,
      order_code,
      customer_name,
      customer_phone,
      customer_email,
      status,
      branch_id,
      created_at,
      branches (
        name
      ),
      order_items (
        *,
        services (
          id,
          name,
          price,
          category
        )
      ),
      payments (
        id,
        method,
        amount,
        paid_amount,
        status
      )
    `;

  const fallbackSelect = `
      id,
      order_code,
      customer_name,
      customer_phone,
      customer_email,
      status,
      branch_id,
      created_at,
      order_items (
        *
      ),
      payments (
        id,
        method,
        amount,
        paid_amount,
        status
      )
    `;

  const full = await runOrderDetailQuery(value, fullSelect);
  if (!full.error) return full;

  console.warn("Retry order detail without optional relations:", full.error);
  const fallback = await runOrderDetailQuery(value, fallbackSelect);
  return fallback.error ? full : fallback;
}

function runOrderDetailQuery(value, selectClause) {
  let query = supabaseClient
    .from("orders")
    .select(selectClause)
    .limit(1);

  query = isUuid(value) ? query.eq("id", value) : query.eq("order_code", value);
  return query;
}

function renderLoading() {
  ["iName", "iWa", "iEmail", "iService", "iBranch", "iNote", "iPayment", "iPayStatus", "iAmount", "iPaidAmount"].forEach(id => setText(id, "Memuat..."));
  setText("iColor", "Memuat...");
  setColorVisibility(true);
  setText("headingOrderId", "#...");
  setText("headingBadge", "Loading");
  const itemList = document.getElementById("itemList");
  if (itemList) itemList.innerHTML = `<li class="item-ol-li">Memuat...</li>`;
}

function renderOrder() {
  const code = order.order_code || order.id;
  const items = order.order_items || [];
  const payment = order.payments?.[0] || {};
  trackingUrl = buildTrackingUrl(code);

  setText("headingOrderId", `#${code}`);
  const headingBadge = document.getElementById("headingBadge");
  if (headingBadge) {
    headingBadge.textContent = formatStatus(order.status);
    headingBadge.className = "heading-badge";
    if (normalizeStatus(order.status) === "completed") headingBadge.classList.add("ok");
    if (normalizeStatus(order.status) === "pending") headingBadge.classList.add("pnd");
  }

  setText("iName", order.customer_name || "-");
  setText("iWa", order.customer_phone || "-");
  setText("iEmail", order.customer_email || "-");
  setText("iService", serviceNames(order));
  setText("iBranch", order.branches?.name || order.branch_id || "-");
  setText("iNote", notes(order));
  const colorText = colors(order);
  setColorVisibility(Boolean(colorText && colorText !== "-"));
  if (colorText && colorText !== "-") setText("iColor", colorText);
  setText("iPayment", payment.method || "-");
  setText("iPayStatus", paymentStatusText(payment));
  setText("iAmount", formatRupiah(displayAmount(order, payment)));
  setText("iPaidAmount", formatRupiah(payment.paid_amount));

  const itemList = document.getElementById("itemList");
  if (itemList) {
    itemList.innerHTML = items.length
      ? items.map(item => `<li class="item-ol-li">${escapeHtml(item.item_type || "-")} - ${escapeHtml(serviceName(item))}</li>`).join("")
      : `<li class="item-ol-li">-</li>`;
  }

  renderQr();
  renderPhotos();
  const statusSel = document.getElementById("statusSel");
  if (statusSel) statusSel.value = formatStatus(order.status);
}

function renderQr() {
  const qrContainer = document.getElementById("qrContainer");
  const code = order.order_code || order.id;
  setText("qrOrderLabel", `Order #${code}`);
  const trackingLabel = document.querySelector(".tracking-det-url");
  if (trackingLabel) trackingLabel.textContent = displayTrackingUrl(trackingUrl);

  if (qrContainer && typeof QRCode !== "undefined") {
    qrContainer.innerHTML = "";
    new QRCode(qrContainer, {
      text: trackingUrl,
      width: 160,
      height: 160,
      colorDark: "#000000",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.H,
    });
  }
}

document.getElementById("btnUpdate")?.addEventListener("click", updateStatus);
document.getElementById("btnDlQR")?.addEventListener("click", () => {
  const canvas = document.querySelector("#qrContainer canvas");
  const img = document.querySelector("#qrContainer img");
  const link = document.createElement("a");
  link.download = `QR_${order?.order_code || order?.id || "order"}.png`;
  link.href = canvas ? canvas.toDataURL("image/png") : (img?.src || "");
  if (link.href) link.click();
});
document.getElementById("btnWA")?.addEventListener("click", () => {
  const code = order?.order_code || order?.id || "";
  const completed = normalizeStatus(order?.status) === "completed";
  const message = completed
    ? `Halo ${order?.customer_name || ""}, pesanan laundry kamu dengan kode ${code} sudah selesai dan bisa diambil.`
    : `Halo ${order?.customer_name || ""}, berikut link tracking pesanan Bedjo Cleaner kamu: ${trackingUrl}`;
  const text = encodeURIComponent(message);
  const phone = String(order?.customer_phone || "").replace(/[^0-9]/g, "");
  window.open(phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`, "_blank");
});
document.getElementById("btnCopy")?.addEventListener("click", () => {
  navigator.clipboard.writeText(trackingUrl);
  showToast("Link berhasil disalin!");
});

async function updateStatus() {
  const rawStatus = toRawStatus(document.getElementById("statusSel")?.value);
  const btn = document.getElementById("btnUpdate");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Updating...";
  }

  const { error } = await supabaseClient
    .from("orders")
    .update({ status: rawStatus })
    .eq("id", order.id);

  if (btn) {
    btn.disabled = false;
    btn.textContent = "Update Status";
  }

  if (error) {
    console.error("Error update order status:", error);
    showToast("Gagal update status.");
    return;
  }

  await createNotification({
    type: rawStatus === "completed" ? "order_completed" : "order_status_updated",
    title: rawStatus === "completed" ? "Order completed" : "Order status updated",
    message: rawStatus === "completed"
      ? `Order ${order.order_code || order.id} selesai dan siap diambil.`
      : `Order ${order.order_code || order.id} diupdate ke ${rawStatus}.`,
    order_id: order.id,
    order_code: order.order_code,
    customer_name: order.customer_name,
    customer_phone: order.customer_phone,
  });

  showToast("Status order berhasil diperbarui.");
  await loadOrder();
}

function initShell() {
  const uNameEl = document.getElementById("uName");
  if (uNameEl) uNameEl.textContent = session.name || "Operator";

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
  userPill?.addEventListener("click", event => {
    event.stopPropagation();
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

function renderPhotos() {
  const grid = document.getElementById("photosGrid");
  if (!grid) return;
  const photos = orderPhotos;
  grid.innerHTML = photos.length
    ? photos.map((photo, index) => `
        <div class="photo-thumb" style="position:relative;">
          <img src="${escapeAttr(photo.photo_url || photo.url || photo)}" alt="Foto item ${index + 1}" style="width:100%;height:96px;object-fit:cover;border-radius:10px;">
          <button type="button" onclick="removeOrderPhoto(${index})" title="Hapus foto"
            style="position:absolute;right:6px;top:6px;border:none;background:rgba(17,24,39,.82);color:#fff;border-radius:999px;width:24px;height:24px;cursor:pointer;">x</button>
        </div>
      `).join("")
    : `<p style="font-size:0.82rem;color:var(--muted);">Belum ada foto.</p>`;
}

function initPhotoUpload() {
  document.getElementById("btnAddPhoto")?.addEventListener("click", () => {
    document.getElementById("photoInput")?.click();
  });

  document.getElementById("photoInput")?.addEventListener("change", async event => {
    const files = [...(event.target.files || [])];
    if (!files.length) return;

    for (const file of files) {
      try {
        await uploadOrderPhoto(file);
      } catch {
        break;
      }
    }

    event.target.value = "";
    orderPhotos = await fetchOrderPhotos(order?.id || orderId);
    renderPhotos();
    showToast("Foto item berhasil ditambahkan.");
  });
}

async function removeOrderPhoto(index) {
  const photo = orderPhotos[index];
  if (photo?.id) {
    const { error } = await supabaseClient.from("order_photos").delete().eq("id", photo.id);
    if (error) console.warn("Gagal hapus row foto:", error);
    if (photo.file_path) {
      const { error: storageError } = await supabaseClient.storage.from("order-photos").remove([photo.file_path]);
      if (storageError) console.warn("Gagal hapus file foto:", storageError);
    }
    orderPhotos.splice(index, 1);
  }
  renderPhotos();
  showToast("Foto item dihapus.");
}

async function fetchOrderPhotos(id) {
  if (!id) return [];
  try {
    const { data, error } = await supabaseClient
      .from("order_photos")
      .select("id, order_id, photo_url, file_path, created_at")
      .eq("order_id", id)
      .order("created_at", { ascending: true });

    if (!error) return data || [];
    console.warn("Gagal fetch order_photos:", error);
  } catch (error) {
    console.warn("Gagal fetch order_photos:", error);
  }

  const itemPhotos = (order?.order_items || [])
    .map(item => item.photo_url || item.image_url)
    .filter(Boolean)
    .map(url => ({ photo_url: url }));
  return itemPhotos;
}

async function uploadOrderPhoto(file) {
  const id = order?.id || orderId;
  if (!id) throw new Error("Order belum siap.");
  const btn = document.getElementById("btnAddPhoto");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Uploading...";
  }

  const ext = fileExtension(file.name || "jpg");
  const filePath = `${id}-${Date.now()}.${ext}`;
  const bucket = supabaseClient.storage.from("order-photos");
  try {
    const { error: uploadError } = await bucket.upload(filePath, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || "image/jpeg",
    });
    if (uploadError) throw uploadError;

    const { data: publicData } = bucket.getPublicUrl(filePath);
    const photoUrl = publicData?.publicUrl || "";
    const { error: insertError } = await supabaseClient
      .from("order_photos")
      .insert({ order_id: id, photo_url: photoUrl, file_path: filePath });
    if (insertError) throw insertError;
  } catch (error) {
    console.error("Upload foto order gagal:", error);
    showToast("Gagal upload foto ke Supabase.");
    throw error;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "+ Add Photo";
    }
  }
}

function subscribeOrderPhotos(id) {
  if (!id || !supabaseClient.channel) return;
  if (photosChannel) supabaseClient.removeChannel(photosChannel);
  photosChannel = supabaseClient
    .channel(`order-photos-${id}`)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "order_photos",
      filter: `order_id=eq.${id}`,
    }, async () => {
      orderPhotos = await fetchOrderPhotos(id);
      renderPhotos();
    })
    .subscribe();
}

function fileExtension(name) {
  const ext = String(name || "").split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "");
  return ext || "jpg";
}

function serviceNames(row) {
  const names = (row.order_items || []).map(item => serviceName(item)).filter(Boolean);
  return [...new Set(names)].join(", ") || "-";
}

function serviceName(item) {
  return item.services?.name || item.service_type || item.service_name || serviceFromNotes(item.notes) || "-";
}

function displayAmount(row, payment) {
  const paymentAmount = Number(payment.amount || 0);
  const itemTotal = calculateItemsTotal(row.order_items || []);
  if (itemTotal > 0 && itemTotal !== paymentAmount) {
    console.log("order detail amount recalculated:", {
      payment_amount: paymentAmount,
      item_total: itemTotal,
    });
    return itemTotal;
  }
  return paymentAmount;
}

function calculateItemsTotal(orderItems) {
  return orderItems.reduce((sum, item) => {
    const qty = Number(item.quantity || 1);
    const subtotal = Number(item.subtotal || 0);
    const price = itemPrice(item);
    return sum + (subtotal > 0 && price === Number(item.price || 0) ? subtotal : price * qty);
  }, 0);
}

function itemPrice(item) {
  const itemType = normalizeLookup(item.item_type);
  const service = normalizeLookup(serviceName(item));
  const fallback = SERVICE_PRICE_FALLBACK[`${itemType} ${service}`.trim()];
  if (fallback) return fallback;
  return Number(item.services?.price || item.price || 0);
}

function notes(row) {
  return (row.order_items || []).map(item => stripServiceFromNotes(item.notes)).filter(Boolean).join(", ") || "-";
}

function serviceFromNotes(note) {
  return String(note || "").match(/^\[service_type:([^\]]+)\]/i)?.[1]?.trim() || "";
}

function stripServiceFromNotes(note) {
  return String(note || "").replace(/^\[service_type:[^\]]+\]\s*/i, "").trim();
}

function colors(row) {
  return (row.order_items || []).map(item => item.color).filter(Boolean).join(", ") || "-";
}

function normalizeLookup(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function setColorVisibility(visible) {
  const colorEl = document.getElementById("iColor");
  const row = colorEl?.closest(".info-item");
  if (row) row.style.display = visible ? "" : "none";
}

function paymentStatusText(payment) {
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

function normalizeStatus(status) {
  return String(status || "pending").toLowerCase().replaceAll(" ", "_").replaceAll("-", "_");
}

function formatStatus(status) {
  const normalized = normalizeStatus(status);
  if (normalized === "on_process" || normalized === "process") return "ON PROCESS";
  if (normalized === "completed") return "COMPLETED";
  if (normalized === "pending") return "PENDING";
  if (normalized === "cancelled") return "CANCELLED";
  return String(status || "PENDING").toUpperCase();
}

function toRawStatus(displayStatus) {
  const normalized = normalizeStatus(displayStatus);
  if (normalized === "on_process" || normalized === "process") return "on_process";
  if (normalized === "completed") return "completed";
  if (normalized === "cancelled") return "cancelled";
  return "pending";
}

function formatRupiah(value) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value || 0));
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

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || "");
}

function getSession() {
  try {
    return JSON.parse(sessionStorage.getItem("bc_session") || localStorage.getItem("bedjo_session") || "null");
  } catch {
    return null;
  }
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val || "-";
}

function showToast(msg) {
  const toast = document.getElementById("toast");
  if (!toast) return alert(msg);
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
}

async function createNotification(payload) {
  try {
    const { error } = await supabaseClient
      .from("notifications")
      .insert({ ...payload, is_read: false });
    if (error) console.warn("Gagal membuat notification:", error);
  } catch (error) {
    console.warn("Gagal membuat notification:", error);
  }
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
