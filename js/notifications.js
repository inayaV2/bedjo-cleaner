const session = getSession();
if (!session || session.role !== "operator") window.location.replace("../login.html");

let notifications = [];

document.addEventListener("DOMContentLoaded", () => {
  initShell();
  document.getElementById("btnMarkAll")?.addEventListener("click", markAllRead);
  document.getElementById("btnClearAll")?.addEventListener("click", clearAll);
  loadNotifications();
});

async function loadNotifications() {
  const list = document.getElementById("notificationsList");
  if (list) list.innerHTML = `<p style="color:#6B7280;padding:24px;text-align:center;">Memuat notifikasi...</p>`;

  const { data, error } = await supabaseClient
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error load notifications:", error);
    if (list) list.innerHTML = `<p style="color:#6B7280;padding:24px;text-align:center;">Gagal memuat notifikasi. Pastikan table notifications sudah dibuat.</p>`;
    return;
  }

  notifications = data || [];
  renderNotifications();
}

function renderNotifications() {
  const list = document.getElementById("notificationsList");
  if (!list) return;

  if (!notifications.length) {
    list.innerHTML = `<p style="color:#6B7280;padding:24px;text-align:center;">Belum ada notifikasi.</p>`;
    return;
  }

  list.innerHTML = notifications.map(item => {
    const canSendWa = item.type === "order_completed" && item.customer_phone;
    return `
      <div style="border:1px solid #E5E7EB;border-radius:12px;padding:16px;background:${item.is_read ? "#fff" : "#EEF4FF"};">
        <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;">
          <div>
            <p style="font-weight:900;margin:0 0 6px;">${escapeHtml(item.title || notificationTitle(item.type))}</p>
            <p style="color:#4B5563;margin:0 0 8px;">${escapeHtml(item.message || "-")}</p>
            <p style="color:#9CA3AF;font-size:0.82rem;margin:0;">${formatDate(item.created_at)}</p>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
            ${!item.is_read ? `<button class="btn-outline" onclick="markAsRead('${item.id}')">Mark read</button>` : ""}
            ${canSendWa ? `<button class="btn-create" onclick="sendWhatsApp('${item.id}')">Send WhatsApp</button>` : ""}
          </div>
        </div>
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
  const { error } = await supabaseClient.from("notifications").update({ is_read: true }).eq("is_read", false);
  if (error) return alert("Gagal mark all read.");
  await loadNotifications();
}

async function clearAll() {
  if (!confirm("Hapus semua notifikasi?")) return;
  const { error } = await supabaseClient.from("notifications").delete().neq("id", "00000000-0000-0000-0000-000000000000");
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
