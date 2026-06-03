const session = JSON.parse(sessionStorage.getItem("bc_session") || localStorage.getItem("bedjo_session") || "null");
if (!session || session.role !== "admin") window.location.href = "../login.html";

let users = [];
let branches = [];
let currentRows = [];
const ALLOWED_BRANCH_NAMES = ["BEC", "Ciwalk", "PVJ", "TSM", "BTC"];

document.addEventListener("DOMContentLoaded", async () => {
  initShell();
  await loadBranches();
  await loadUsers();
  await loadActivities();
});

function initShell() {
  setText("topbarName", session?.name || "Admin");
  setText("topbarRole", "Admin");

  const sidebar = document.getElementById("sidebar");
  const mainWrapper = document.getElementById("mainWrapper");
  const hamburger = document.getElementById("hamburgerBtn");
  hamburger?.addEventListener("click", () => {
    if (window.innerWidth <= 700) sidebar?.classList.toggle("open");
    else {
      sidebar?.classList.toggle("collapsed");
      mainWrapper?.classList.toggle("collapsed");
    }
  });

  const dropdownToggle = document.getElementById("userDropdownToggle");
  const dropdown = document.getElementById("userDropdown");
  dropdownToggle?.addEventListener("click", event => {
    event.stopPropagation();
    dropdown?.classList.toggle("open");
  });
  document.addEventListener("click", () => dropdown?.classList.remove("open"));
  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    sessionStorage.removeItem("bc_session");
    sessionStorage.removeItem("bedjo_session");
    sessionStorage.removeItem("bc_saved_order");
    localStorage.removeItem("bc_session");
    localStorage.removeItem("bedjo_session");
    localStorage.removeItem("bc_remember");
    window.location.href = "../login.html";
  });

  document.getElementById("searchInput")?.addEventListener("input", applySearch);
  document.getElementById("createAccountBtn")?.addEventListener("click", createUser);
  document.getElementById("cancelEdit")?.addEventListener("click", () => document.getElementById("editModal")?.classList.remove("open"));
  document.getElementById("saveEdit")?.addEventListener("click", saveEditUser);
}

async function loadBranches() {
  const { data, error } = await supabaseClient
    .from("branches")
    .select("id, name, address, status")
    .order("name", { ascending: true });
  if (error) {
    console.error("Gagal load branches:", error);
  }
  branches = uniqueAllowedBranchRecords(data);
  console.log("branches loaded", branches);
  populateBranchSelect("branchInput");
  populateBranchSelect("editBranch");
}

async function loadUsers() {
  showTableMessage("Memuat users...");
  const withBranch = await supabaseClient
    .from("profiles")
    .select("*, branches(name)")
    .order("created_at", { ascending: false });
  const result = withBranch.error
    ? await supabaseClient.from("profiles").select("*").order("created_at", { ascending: false })
    : withBranch;

  if (result.error) {
    console.error("Gagal load profiles:", result.error);
    showTableMessage("Gagal memuat users dari Supabase.");
    return;
  }

  users = (result.data || []).map(mapProfile);
  currentRows = users;
  renderTable(currentRows);
}

function mapProfile(row) {
  const name = row.full_name || row.username || row.email || "-";
  return {
    id: row.id,
    fullName: name,
    username: row.username || name,
    email: row.email || "-",
    role: normalizeRole(row.role),
    branch_id: row.branch_id || "",
    branch: displayBranch(row),
    status: normalizeUserStatus(row.status),
  };
}

function renderTable(data) {
  const tbody = document.getElementById("userTableBody");
  if (!tbody) return;
  if (!data.length) return showTableMessage("No users found");

  tbody.innerHTML = data.map((u, i) => `
    <tr>
      <td>${escapeHtml(u.username)}</td>
      <td>${escapeHtml(u.fullName)}</td>
      <td>${escapeHtml(u.email)}</td>
      <td>${roleBadge(u.role)}</td>
      <td>${escapeHtml(u.branch)}</td>
      <td>${statusBadge(u.status)}</td>
      <td>
        <div class="action-btns">
          <button class="btn-icon" onclick="openEdit(${i})" title="Edit"><i class="fa-regular fa-pen-to-square"></i></button>
          <button class="btn-icon delete" onclick="deleteUser(${i})" title="Delete"><i class="fa-regular fa-trash-can"></i></button>
        </div>
      </td>
    </tr>
  `).join("");
}

async function createUser() {
  const email = value("emailInput");
  const password = value("passwordInput");
  const role = value("roleInput") || "operator";
  const branchId = value("branchInput");
  const status = value("statusInput") || "active";
  const identity = identityFromEmail(email);

  if (!email || !password || !role || !branchId || !status) {
    return alert("Please fill in all required fields, including password and branch.");
  }

  const { data, error } = await createUserViaFunction({
    first_name: identity.firstName,
    last_name: identity.lastName,
    email,
    username: identity.username,
    password,
    role: normalizeRole(role),
    branch_id: branchId,
  });

  console.log("create-user function result:", { data, error });

  if (error) {
    console.error("Gagal create user via Edge Function:", error);
    return alert("Gagal membuat user: " + await functionErrorMessage(error));
  }

  const createdUserId = data?.user?.id;
  if (createdUserId && status !== "active") {
    const { error: statusError } = await updateProfile(createdUserId, { status });
    if (statusError) console.error("Gagal update status user baru:", statusError);
  }

  await createActivityLog({
    action: "user_created",
    description: `User created: ${email}`,
    user_email: email,
  });

  ["emailInput", "passwordInput"].forEach(id => setInput(id, ""));
  setInput("roleInput", "operator");
  setInput("branchInput", "");
  setInput("statusInput", "active");
  await loadUsers();
  await loadActivities();
}

function openEdit(index) {
  const u = currentRows[index];
  if (!u) return;
  setInput("editIndex", index);
  setInput("editUsername", u.username);
  setInput("editEmail", u.email);
  setInput("editRole", u.role);
  setInput("editBranch", u.branch_id);
  setInput("editStatus", u.status);
  document.getElementById("editModal")?.classList.add("open");
}

async function saveEditUser() {
  const index = Number(value("editIndex"));
  const u = currentRows[index];
  if (!u) return;

  const payload = {
    username: value("editUsername"),
    email: value("editEmail"),
    role: normalizeRole(value("editRole")),
    status: value("editStatus") || "active",
    branch_id: value("editBranch"),
  };

  if (!payload.branch_id) return alert("Branch wajib dipilih.");

  const { error } = await updateProfile(u.id, payload);
  if (error) return alert("Gagal update user: " + error.message);

  await createActivityLog({
    action: "user_updated",
    description: `User updated: ${payload.email}`,
    user_email: payload.email,
  });
  document.getElementById("editModal")?.classList.remove("open");
  await loadUsers();
  await loadActivities();
}

async function deleteUser(index) {
  const u = currentRows[index];
  if (!u || !confirm("Delete this user?")) return;
  const { error } = await supabaseClient.from("profiles").delete().eq("id", u.id);
  if (error) return alert("Gagal delete user: " + error.message);
  await createActivityLog({
    action: "user_deleted",
    description: `User deleted: ${u.email}`,
    user_email: u.email,
  });
  await loadUsers();
  await loadActivities();
}

function applySearch() {
  const q = value("searchInput").toLowerCase();
  currentRows = users.filter(u =>
    u.username.toLowerCase().includes(q) ||
    u.fullName.toLowerCase().includes(q) ||
    u.email.toLowerCase().includes(q) ||
    u.role.toLowerCase().includes(q) ||
    u.branch.toLowerCase().includes(q)
  );
  renderTable(currentRows);
}

function populateBranchSelect(id) {
  const select = document.getElementById(id);
  if (!select) return;
  select.innerHTML = `<option value="">Choose branch</option>` +
    branches.map(branch => `<option value="${escapeHtml(branch.id)}">${escapeHtml(branch.name)}</option>`).join("");
}

async function createUserViaFunction(payload) {
  return supabaseClient.functions.invoke("create-user", {
    body: payload,
  });
}

async function updateProfile(id, payload) {
  return supabaseClient.from("profiles").update(profilePayload(payload)).eq("id", id);
}

function profilePayload(payload) {
  const allowed = ["id", "email", "username", "full_name", "role", "branch_id", "status"];
  return allowed.reduce((result, key) => {
    if (Object.prototype.hasOwnProperty.call(payload, key)) result[key] = payload[key];
    return result;
  }, {});
}

async function functionErrorMessage(error) {
  if (error?.context instanceof Response) {
    try {
      const body = await error.context.clone().json();
      return body?.error || body?.message || error.message;
    } catch {
      return error.message;
    }
  }

  return error?.context?.message ||
    error?.message ||
    String(error || "Unknown error");
}

function roleBadge(role) {
  const label = normalizeRole(role).toUpperCase();
  const cls = label === "ADMIN" ? "badge-admin" : "badge-operator";
  return `<span class="badge ${cls}">${label}</span>`;
}

function statusBadge(status) {
  const normalized = normalizeUserStatus(status);
  return `<span class="status-badge ${normalized === "active" ? "status-active" : "status-inactive"}">${normalized.toUpperCase()}</span>`;
}

function showTableMessage(message) {
  const tbody = document.getElementById("userTableBody");
  if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;color:#94a3b8">${escapeHtml(message)}</td></tr>`;
}

async function loadActivities() {
  const { data, error } = await supabaseClient
    .from("activity_logs")
    .select("id, action, description, user_email, created_at")
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    console.warn("Gagal load activity_logs:", error);
    renderActivities([]);
    return;
  }

  renderActivities(data || []);
}

async function createActivityLog(payload) {
  const insertPayload = {
    action: payload.action,
    description: payload.description,
    user_email: payload.user_email,
    created_at: new Date().toISOString(),
  };

  const { error } = await supabaseClient
    .from("activity_logs")
    .insert(insertPayload);

  if (error) {
    console.warn("Gagal insert activity_logs:", error);
  }
}

function renderActivities(rows) {
  const list = document.getElementById("activityList");
  if (!list) return;
  if (!rows?.length) {
    list.innerHTML = `<li class="activity-item"><span class="activity-left">Belum ada aktivitas</span></li>`;
    return;
  }

  list.innerHTML = rows.map(a => `
    <li class="activity-item">
      <span class="activity-left"><i class="fa-solid ${activityIcon(a.action)}"></i>${escapeHtml(a.description || a.action || "-")}</span>
      <span class="activity-time">${escapeHtml(relativeTime(a.created_at))}</span>
    </li>
  `).join("");
}

function identityFromEmail(email) {
  const username = String(email || "").split("@")[0].trim().toLowerCase();
  const words = username
    .replace(/[._-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map(displayNameWord);
  const fullName = words.join(" ") || "User";

  return {
    username,
    firstName: words[0] || fullName,
    lastName: words.slice(1).join(" "),
    fullName,
  };
}

function capitalizeWord(word) {
  return String(word || "").charAt(0).toUpperCase() + String(word || "").slice(1).toLowerCase();
}

function displayNameWord(word) {
  const raw = String(word || "").trim();
  const branch = ALLOWED_BRANCH_NAMES.find(name => name.toLowerCase() === raw.toLowerCase());
  return branch || capitalizeWord(raw);
}

function activityIcon(action) {
  const normalized = String(action || "");
  if (normalized.includes("created")) return "fa-user-plus";
  if (normalized.includes("updated")) return "fa-user-pen";
  if (normalized.includes("deleted")) return "fa-user-minus";
  return "fa-circle-info";
}

function relativeTime(value) {
  if (!value) return "-";
  const diff = Date.now() - new Date(value).getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "Baru saja";
  if (diff < hour) return `${Math.floor(diff / minute)} menit lalu`;
  if (diff < day) return `${Math.floor(diff / hour)} jam lalu`;
  return new Date(value).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

function normalizeRole(role) {
  return String(role || "operator").toLowerCase() === "admin" ? "admin" : "operator";
}

function normalizeUserStatus(status) {
  return String(status || "active").toLowerCase() === "inactive" ? "inactive" : "active";
}

function branchName(id) {
  const match = branches.find(branch => String(branch.id) === String(id));
  return match?.name || "";
}

function branchKey(name) {
  const raw = String(name || "").trim().toLowerCase();
  return ALLOWED_BRANCH_NAMES.find(branch => {
    const branchName = branch.toLowerCase();
    return raw === branchName || raw.includes(` ${branchName}`) || raw.includes(branchName);
  }) || "";
}

function uniqueAllowedBranchRecords(rows) {
  const seen = new Set();
  return (rows || []).reduce((result, row) => {
    const key = branchKey(row?.name || row?.branch);
    if (!row?.id || !isUuid(row.id)) return result;
    if (!key || seen.has(key)) return result;
    seen.add(key);
    result.push({ ...row, name: row.name || key });
    return result;
  }, []);
}

function displayBranch(row) {
  if (!row.branch_id) return "Belum diset";
  return branchName(row.branch_id) || "Belum diset";
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || "");
}

function value(id) {
  return document.getElementById(id)?.value?.trim() || "";
}

function setInput(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val || "";
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val || "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
