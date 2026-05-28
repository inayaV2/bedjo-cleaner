const ROUTES = {
  operator: "operator/operator-dashboard.html",
  admin: "admin/admin-dashboard.html",
};

const LOCAL_USERS = {
  admin: {
    email: "admin@bedjocleaner.com",
    role: "admin",
    name: "Admin",
  },
  operator: {
    email: "operator@bedjocleaner.com",
    role: "operator",
    name: "Operator",
  },
};

const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const btnLogin = document.getElementById("btn-login");
const loginError = document.getElementById("login-error");

btnLogin?.addEventListener("click", doLogin);
passwordInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") doLogin();
});
usernameInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") doLogin();
});

async function doLogin() {
  const identifier = usernameInput.value.trim();
  const password = passwordInput.value;

  loginError.textContent = "";

  if (!identifier || !password) {
    loginError.textContent = "Username/email dan password wajib diisi";
    return;
  }

  btnLogin.disabled = true;
  btnLogin.textContent = "Loading...";

  const localUser = LOCAL_USERS[identifier.toLowerCase()];

  if (localUser) {
    saveSession({
      user_id: identifier.toLowerCase(),
      username: identifier.toLowerCase(),
      email: localUser.email,
      role: localUser.role,
      name: localUser.name,
    });

    window.location.href = ROUTES[localUser.role];
    return;
  }

  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email: identifier,
    password,
  });

  if (error) {
    loginError.textContent = "Login gagal. Gunakan email terdaftar, atau username admin/operator.";
    resetBtn();
    return;
  }

  const user = data.user;

  const { data: profile, error: errProfile } = await supabaseClient
    .from("profiles")
    .select("role, branch_id")
    .eq("id", user.id)
    .single();

  if (errProfile || !profile) {
    loginError.textContent = "Role tidak ditemukan";
    await supabaseClient.auth.signOut();
    resetBtn();
    return;
  }

  const role = String(profile.role).toLowerCase();

  if (!ROUTES[role]) {
    loginError.textContent = "Role tidak valid";
    await supabaseClient.auth.signOut();
    resetBtn();
    return;
  }

  saveSession({
    user_id: user.id,
    username: user.email,
    email: user.email,
    role,
    branch_id: profile.branch_id || null,
    name: role === "admin" ? "Admin" : "Operator",
  });

  window.location.href = ROUTES[role];
}

function saveSession(session) {
  const sessionJson = JSON.stringify(session);
  sessionStorage.setItem("bc_session", sessionJson);
  localStorage.setItem("bedjo_session", sessionJson);
}

function resetBtn() {
  btnLogin.disabled = false;
  btnLogin.textContent = "Login";
}
