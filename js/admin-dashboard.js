const session = JSON.parse(sessionStorage.getItem("bc_session") || localStorage.getItem("bedjo_session") || "null");
if (!session || session.role !== "admin") window.location.href = "../login.html";

let users = [];
let branches = [];
let currentRows = [];
let activities = [];

document.addEventListener("DOMContentLoaded", async () => {
  initShell();
  await loadBranches();
  await loadUsers();
  renderActivities();
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
  const { data, error } = await supabaseClient.from("branches").select("id, name").order("name");
  if (error) console.warn("Gagal load branches:", error);
  branches = data || [];
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
  const name = row.full_name || row.name || row.username || row.email || "-";
  return {
    id: row.id,
    fullName: name,
    username: row.username || name,
    email: row.email || "-",
    role: normalizeRole(row.role),
    branch_id: row.branch_id || "",
    branch: row.branches?.name || branchName(row.branch_id) || row.branch || "Branch belum diset",
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
  const firstName = value("firstName");
  const lastName = value("lastName");
  const email = value("emailInput");
  const username = value("usernameInput");
  const password = value("passwordInput");
  const role = value("roleInput") || "operator";
  const branchId = value("branchInput");
  const fullName = [firstName, lastName].filter(Boolean).join(" ");

  if (!fullName || !email || !username || !password || !role || !branchId) {
    return alert("Please fill in all required fields, including password and branch.");
  }

  const authResult = await signUpAuthUser(email, password, {
    full_name: fullName,
    username,
    role,
  });

  if (authResult.error) {
    console.error("Gagal create auth user:", authResult.error);
    return alert("Akun login harus dibuat di Supabase Authentication, lalu profile bisa disimpan di table profiles.\n\nError: " + (authResult.error.message || authResult.error));
  }

  const authUserId = authResult.data?.user?.id;
  if (!authUserId) {
    return alert("Akun login harus dibuat di Supabase Authentication, lalu profile bisa disimpan di table profiles.");
  }

  const payload = {
    id: authUserId,
    full_name: fullName,
    username,
    email,
    role: normalizeRole(role),
    branch_id: branchId,
    status: "active",
  };

  const { error } = await insertProfile(payload);
  if (error) return alert("Gagal menyimpan user: " + error.message);

  logActivity("user-plus", `User Created: ${username}`);
  ["firstName", "lastName", "emailInput", "usernameInput", "passwordInput"].forEach(id => setInput(id, ""));
  setInput("roleInput", "operator");
  setInput("branchInput", "");
  await loadUsers();
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

  logActivity("user-pen", `User Updated: ${payload.username}`);
  document.getElementById("editModal")?.classList.remove("open");
  await loadUsers();
}

async function deleteUser(index) {
  const u = currentRows[index];
  if (!u || !confirm("Delete this user?")) return;
  const { error } = await supabaseClient.from("profiles").delete().eq("id", u.id);
  if (error) return alert("Gagal delete user: " + error.message);
  logActivity("user-minus", `User Deleted: ${u.username}`);
  await loadUsers();
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

async function insertProfile(payload) {
  const direct = await supabaseClient.from("profiles").insert(payload);
  if (!direct.error) return direct;
  const fallback = { ...payload, name: payload.full_name };
  delete fallback.full_name;
  return supabaseClient.from("profiles").insert(fallback);
}

async function updateProfile(id, payload) {
  const direct = await supabaseClient.from("profiles").update(payload).eq("id", id);
  if (!direct.error) return direct;
  const fallback = { ...payload, name: payload.full_name };
  delete fallback.full_name;
  return supabaseClient.from("profiles").update(fallback).eq("id", id);
}

async function signUpAuthUser(email, password, metadata) {
  const supabaseUrl = window.BEDJO_SUPABASE_URL || SUPABASE_URL;
  const supabaseAnonKey = window.BEDJO_SUPABASE_ANON_KEY || SUPABASE_ANON_KEY;
  const authClient = supabase.createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  return authClient.auth.signUp({
    email,
    password,
    options: {
      data: metadata,
    },
  });
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

function logActivity(icon, label) {
  activities.unshift({ icon, label, time: new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) + " WIB" });
  if (activities.length > 10) activities.pop();
  renderActivities();
}

function renderActivities() {
  const list = document.getElementById("activityList");
  if (!list) return;
  list.innerHTML = activities.map(a => `
    <li class="activity-item">
      <span class="activity-left"><i class="fa-solid fa-circle-info"></i>${escapeHtml(a.label)}</span>
      <span class="activity-time">${escapeHtml(a.time)}</span>
    </li>
  `).join("") || `<li class="activity-item"><span class="activity-left">Belum ada aktivitas</span></li>`;
}

function normalizeRole(role) {
  return String(role || "operator").toLowerCase() === "admin" ? "admin" : "operator";
}

function normalizeUserStatus(status) {
  return String(status || "active").toLowerCase() === "inactive" ? "inactive" : "active";
}

function branchName(id) {
  return branches.find(branch => branch.id === id)?.name || "";
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
