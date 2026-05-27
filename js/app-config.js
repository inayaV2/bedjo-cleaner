window.APP_CONFIG = {
  PUBLIC_SITE_ORIGIN: "https://bedjo-cleaner.vercel.app",
  TRACKING_VERSION: "20260519-3",
  BUSINESS_WHATSAPP_NUMBER: "6285933534864",
};

window.BEDJO_CONFIG = window.APP_CONFIG;

window.BedjoUrl = {
  tracking(orderCode) {
    const publicOrigin = String(window.APP_CONFIG.PUBLIC_SITE_ORIGIN).trim().replace(/\/$/, "");
    const url = new URL("/public/tracking.html", publicOrigin);

    url.searchParams.set("code", orderCode);
    url.searchParams.set("v", window.APP_CONFIG.TRACKING_VERSION);
    return url.href;
  },
};

window.BedjoContact = {
  whatsappNumber() {
    return String(window.APP_CONFIG.BUSINESS_WHATSAPP_NUMBER || "").replace(/[^0-9]/g, "");
  },
};
