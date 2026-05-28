const session = getSession();
if (!session || !["operator", "admin"].includes(session.role)) window.location.replace("../login.html");

let notifications = [];
let currentProfile = null;

document.addEventListener("DOMContentLoaded", () => {
  initShell();
  document.getElementById("btnMarkAll")?.addEventListener("click", markAllRead);
  document.getElementById("btnClearAll")?.addEventListener("click", clearAll);
  loadNotifications();
});

async function loadNotifications() {
  const list = document.getElementById("notificationsList");
  if (list) list.innerHTML = `<p style="color:#6B7280;padding:24px;text-align:center;">Memuat notifikasi...</p>`;

  currentProfile = currentProfile || await loadCurrentProfile();

  if (isOperatorScoped() && !currentProfile?.branch_id) {
    notifications = [];
    renderNotifications();
    return;
  }

  const result = isOperatorScoped()
    ? await loadBranchNotifications(currentProfile.branch_id)
    : await supabaseClient
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false });

  const { data, error } = result;

  if (error) {
    console.error("Error load notifications:", error);
    if (list) list.innerHTML = `<p style="color:#6B7280;padding:24px;text-align:center;">Gagal memuat notifikasi. Pastikan table notifications sudah dibuat.</p>`;
    return;
  }

  notifications = (data || []).filter(item => !item.hidden);
  renderNotifications();
}

async function loadBranchNotifications(branchId) {
  const joined = await supabaseClient
    .from("notifications")
    .select("*, orders!inner(branch_id)")
    .eq("orders.branch_id", branchId)
    .order("created_at", { ascending: false });

  if (!joined.error) return joined;

  console.warn("Retry notifications branch filter without relation:", joined.error);

  const { data: branchOrders, error: orderError } = await supabaseClient
    .from("orders")
    .select("id, order_code")
    .eq("branch_id", branchId);

  if (orderError) return { data: null, error: orderError };

  const orderIds = (branchOrders || []).map(order => order.id).filter(Boolean);
  const orderCodes = (branchOrders || []).map(order => order.order_code).filter(Boolean);

  if (!orderIds.length && !orderCodes.length) return { data: [], error: null };

  const all = await supabaseClient
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false });

  if (all.error) return all;

  return {
    data: (all.data || []).filter(item => orderIds.includes(item.order_id) || orderCodes.includes(item.order_code)),
    error: null,
  };
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

function renderNotifications() {
  const list = document.getElementById("notificationsList");
  if (!list) return;

  if (!notifications.length) {
    list.innerHTML = `<div class="notification-empty">Belum ada notifikasi.</div>`;
    return;
  }

  list.innerHTML = notifications.map(item => {
    return `
      <div class="notification-item">
        <div class="notification-icon">${notificationIcon(item.type)}</div>
        <div>
          <p class="notification-title">${escapeHtml(item.title || notificationTitle(item.type))}</p>
          <p class="notification-message">${escapeHtml(item.message || "-")}</p>
        </div>
        <div class="notification-time">${relativeTime(item.created_at)}</div>
        <div class="notification-dot ${item.is_read ? "read" : ""}" title="${item.is_read ? "Read" : "Unread"}"></div>
      </div>
    `;
  }).join("");
}

async function markAsRead(id) {
  const { error } = await supabaseClient.from("notifications").update({ is_read: true }).eq("id", id);
  if (error) return alert("Gagal mark as read.");
  notifications = notifications.map(item => item.id === id ? { ...item, is_read: true } : item);
  renderNotifications();
}

async function markAllRead() {
  const unreadIds = notifications
    .filter(item => !item.is_read && item.id)
    .map(item => item.id);

  if (!unreadIds.length) return;

  const { error } = await supabaseClient
    .from("notifications")
    .update({ is_read: true })
    .in("id", unreadIds);
  if (error) return alert("Gagal mark all read.");
  await loadNotifications();
}

async function clearAll() {
  if (!confirm("Hapus semua notifikasi?")) return;
  const ids = notifications
    .map(item => item.id)
    .filter(Boolean);

  if (!ids.length) return;

  const hiddenAttempt = await supabaseClient
    .from("notifications")
    .update({ hidden: true })
    .in("id", ids);
  const { error } = hiddenAttempt.error
    ? await supabaseClient.from("notifications").delete().in("id", ids)
    : hiddenAttempt;
  if (error) return alert("Gagal clear all.");
  notifications = [];
  renderNotifications();
}

function sendWhatsApp(id) {
  const item = notifications.find(row => row.id === id);
  if (!item) return;
  const message = encodeURIComponent(`Halo ${item.customer_name || ""}, pesanan laundry kamu dengan kode ${item.order_code || ""} sudah selesai dan bisa diambil.`);
  const phone = String(item.customer_phone || "").replace(/[^0-9]/g, "");
  window.open(phone ? `https://wa.me/${phone}?text=${message}` : `https://wa.me/?text=${message}`, "_blank");
}

function initShell() {
  let drawerOpen = window.innerWidth >= 768;
  const syncDrawer = () => {
    document.getElementById("drawer")?.classList.toggle("collapsed", !drawerOpen);
    document.getElementById("mainWrap")?.classList.toggle("expanded", !drawerOpen);
    document.getElementById("overlay")?.classList.toggle("show", !drawerOpen && window.innerWidth < 768);
  };
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

function notificationTitle(type) {
  if (type === "new_order") return "New order created";
  if (type === "order_completed") return "Order completed";
  if (type === "payment_updated") return "Payment updated";
  return "Order status updated";
}

function notificationIcon(type) {
  const normalized = String(type || "").toLowerCase();
  if (normalized.includes("payment")) return "$";
  if (normalized.includes("status")) return "✓";
  if (normalized.includes("completed")) return "✓";
  if (normalized.includes("order")) return "#";
  return "i";
}

function relativeTime(value) {
  if (!value) return "-";
  const diff = Date.now() - new Date(value).getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "just now";
  if (diff < hour) {
    const count = Math.floor(diff / minute);
    return `${count} minute${count > 1 ? "s" : ""} ago`;
  }
  if (diff < day) {
    const count = Math.floor(diff / hour);
    return `${count} hour${count > 1 ? "s" : ""} ago`;
  }
  const count = Math.floor(diff / day);
  if (count < 7) return `${count} day${count > 1 ? "s" : ""} ago`;
  return formatDate(value);
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function getSession() {
  try {
    return JSON.parse(sessionStorage.getItem("bc_session") || localStorage.getItem("bedjo_session") || "null");
  } catch {
    return null;
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
