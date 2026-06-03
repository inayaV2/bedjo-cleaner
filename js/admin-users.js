const session = JSON.parse(sessionStorage.getItem("bc_session") || localStorage.getItem("bedjo_session") || "null");
if (!session || session.role !== "admin") window.location.href = "../login.html";

const ROWS_PER_PAGE = 10;
let users = [];
let filteredUsers = [];
let branches = [];
let currentPage = 1;
const ALLOWED_BRANCH_NAMES = ["BEC", "Ciwalk", "PVJ", "TSM", "BTC"];

document.addEventListener("DOMContentLoaded", async () => {
  initShell();
  await loadBranches();
  await loadUsers();
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

  document.getElementById("searchInput")?.addEventListener("input", applyFilters);
  document.getElementById("filterRole")?.addEventListener("change", applyFilters);
  document.getElementById("filterStatus")?.addEventListener("change", applyFilters);
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
  applyFilters();
}

function mapProfile(row) {
  const fullName = row.full_name || row.username || row.email || "-";
  return {
    id: row.id,
    fullName,
    username: row.username || fullName,
    email: row.email || "-",
    role: normalizeRole(row.role),
    branch_id: row.branch_id || "",
    branch: displayBranch(row),
    status: normalizeUserStatus(row.status),
  };
}

function renderTable() {
  const tbody = document.getElementById("userTableBody");
  if (!tbody) return;
  const start = (currentPage - 1) * ROWS_PER_PAGE;
  const page = filteredUsers.slice(start, start + ROWS_PER_PAGE);

  if (!page.length) {
    showTableMessage("No users found");
    renderPagination();
    return;
  }

  tbody.innerHTML = page.map((u, i) => `
    <tr>
      <td>${escapeHtml(shortId(u.id))}</td>
      <td>${escapeHtml(u.fullName)}</td>
      <td>${escapeHtml(u.username)}</td>
      <td>${escapeHtml(u.email)}</td>
      <td>${roleBadge(u.role)}</td>
      <td>${escapeHtml(u.branch)}</td>
      <td>${statusBadge(u.status)}</td>
      <td>
        <div class="action-menu-wrap">
          <button class="btn-action-dots" onclick="toggleActionMenu(event, ${start + i})" title="Actions">
            <i class="fa-solid fa-ellipsis-vertical"></i>
          </button>
          <div class="action-dropdown" id="action-menu-${start + i}">
            <button onclick="openEdit(${start + i}); closeAllActionMenus()"><i class="fa-regular fa-pen-to-square"></i> Edit</button>
            <button class="delete" onclick="deleteUser(${start + i}); closeAllActionMenus()"><i class="fa-regular fa-trash-can"></i> Delete</button>
          </div>
        </div>
      </td>
    </tr>
  `).join("");
  renderPagination();
}

function applyFilters() {
  const q = value("searchInput").toLowerCase();
  const role = value("filterRole");
  const status = value("filterStatus");
  filteredUsers = users.filter(u => {
    const matchQ = !q ||
      u.fullName.toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.branch.toLowerCase().includes(q);
    return matchQ && (!role || u.role === role) && (!status || u.status === status);
  });
  currentPage = 1;
  renderTable();
}

function openEdit(index) {
  const u = filteredUsers[index];
  if (!u) return;
  setInput("editIndex", index);
  setInput("editEmail", u.email);
  setInput("editRole", u.role);
  setInput("editBranch", u.branch_id);
  setInput("editStatus", u.status);
  document.getElementById("editModal")?.classList.add("open");
}

async function saveEditUser() {
  const u = filteredUsers[Number(value("editIndex"))];
  if (!u) return;
  const payload = {
    email: value("editEmail"),
    role: normalizeRole(value("editRole")),
    branch_id: value("editBranch"),
    status: value("editStatus") || "active",
  };

  if (!payload.branch_id) return alert("Branch wajib dipilih.");

  const { error } = await updateProfile(u.id, payload);
  if (error) return alert("Gagal update user: " + error.message);
  document.getElementById("editModal")?.classList.remove("open");
  await loadUsers();
}

async function deleteUser(index) {
  const u = filteredUsers[index];
  if (!u || !confirm("Delete this user?")) return;
  const { error } = await supabaseClient.from("profiles").delete().eq("id", u.id);
  if (error) return alert("Gagal delete user: " + error.message);
  await loadUsers();
}

function toggleActionMenu(e, index) {
  e.stopPropagation();
  closeAllActionMenus();
  document.getElementById(`action-menu-${index}`)?.classList.toggle("open");
}

function closeAllActionMenus() {
  document.querySelectorAll(".action-dropdown.open").forEach(menu => menu.classList.remove("open"));
}

document.addEventListener("click", closeAllActionMenus);

function renderPagination() {
  const total = Math.ceil(filteredUsers.length / ROWS_PER_PAGE);
  const pg = document.getElementById("pagination");
  if (!pg) return;
  if (total <= 1) {
    pg.innerHTML = "";
    return;
  }
  pg.innerHTML = `
    <button class="pg-btn" onclick="goPage(1)" ${currentPage === 1 ? "disabled" : ""}><i class="fa-solid fa-angles-left"></i></button>
    <button class="pg-btn" onclick="goPage(${currentPage - 1})" ${currentPage === 1 ? "disabled" : ""}><i class="fa-solid fa-angle-left"></i></button>
    <span class="pg-info">${currentPage}</span>
    <button class="pg-btn" onclick="goPage(${currentPage + 1})" ${currentPage === total ? "disabled" : ""}><i class="fa-solid fa-angle-right"></i></button>
    <button class="pg-btn" onclick="goPage(${total})" ${currentPage === total ? "disabled" : ""}><i class="fa-solid fa-angles-right"></i></button>
  `;
}

function goPage(page) {
  const total = Math.ceil(filteredUsers.length / ROWS_PER_PAGE);
  if (page < 1 || page > total) return;
  currentPage = page;
  renderTable();
}

function populateBranchSelect(id) {
  const select = document.getElementById(id);
  if (!select) return;
  select.innerHTML = `<option value="">Choose branch</option>` +
    branches.map(branch => `<option value="${escapeHtml(branch.id)}">${escapeHtml(branch.name)}</option>`).join("");
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
  if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:20px;color:#94a3b8">${escapeHtml(message)}</td></tr>`;
}

function normalizeRole(role) {
  return String(role || "operator").toLowerCase() === "admin" ? "admin" : "operator";
}

function normalizeUserStatus(status) {
  return String(status || "active").toLowerCase() === "inactive" ? "inactive" : "active";
}

function shortId(id) {
  return String(id || "-").slice(0, 8);
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
