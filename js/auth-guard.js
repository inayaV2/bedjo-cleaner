(function () {
  const path = window.location.pathname;

  if (path.endsWith("/tracking.html") || path.includes("/public/tracking.html")) {
    return;
  }

  const session = getSession();

  if (!session) {
    window.location.href = "../login.html";
    return;
  }

  if (path.includes("operator") && !["operator", "admin"].includes(session.role)) {
    window.location.href = "../login.html";
    return;
  }

  if (path.includes("admin") && session.role !== "admin") {
    window.location.href = "../login.html";
    return;
  }

})();

function getSession() {
  try {
    return JSON.parse(sessionStorage.getItem("bc_session") || localStorage.getItem("bedjo_session") || "null");
  } catch {
    return null;
  }
}
