const session = getSession();

if (!session || session.role !== "operator") {
  window.location.replace("../login.html");
}

const uName = document.getElementById("uName");
if (uName && session) uName.textContent = session.role === "operator" ? "Operator" : (session.name || "Operator");

const params = new URLSearchParams(window.location.search);
const editOrderId = window.BC_EDIT_ORDER_ID || params.get("edit");
const isEditMode = Boolean(editOrderId);
let orderCreateInitialized = false;
let editLoadStarted = false;
console.log("order-create.js loaded");
console.log("editOrderId:", editOrderId);

let items = [{ type: "", qty: 1, service: "", serviceId: "", variant: "", note: "", color: "", price: 0 }];
let selectedBranch = "";
let selectedPayment = "";
let selectedStatus = "";
let editOrder = null;
let editPayment = null;
let supportsServiceTypeColumn = true;
let availableServices = [];
let currentProfile = null;
const SERVICES_CATALOG = [
  { item_type: "Shoes", service_category: "Regular Clean", variant: "Canvas", price: 45000 },
  { item_type: "Shoes", service_category: "Regular Clean", variant: "Leather", price: 60000 },
  { item_type: "Shoes", service_category: "Regular Clean", variant: "Suede", price: 55000 },
  { item_type: "Shoes", service_category: "Regular Clean", variant: "Nubuck", price: 55000 },
  { item_type: "Shoes", service_category: "Regular Clean", variant: "Kids", price: 40000 },
  { item_type: "Shoes", service_category: "Regular Clean", variant: "Flatshoes", price: 40000 },
  { item_type: "Shoes", service_category: "Regular Clean", variant: "Sandal", price: 35000 },
  { item_type: "Shoes", service_category: "Prioritas Clean", variant: "Canvas", price: 75000 },
  { item_type: "Shoes", service_category: "Prioritas Clean", variant: "Leather", price: 90000 },
  { item_type: "Shoes", service_category: "Prioritas Clean", variant: "Suede", price: 85000 },
  { item_type: "Shoes", service_category: "Prioritas Clean", variant: "Flatshoes", price: 65000 },
  { item_type: "Shoes", service_category: "Prioritas Clean", variant: "Kids", price: 65000 },
  { item_type: "Shoes", service_category: "Extra Treatment", variant: "Express 3 Jam", price: 90000 },
  { item_type: "Shoes", service_category: "Extra Treatment", variant: "Upper Whitening", price: 45000 },
  { item_type: "Shoes", service_category: "Extra Treatment", variant: "Unyellowing", price: 45000 },
  { item_type: "Shoes", service_category: "Extra Treatment", variant: "Noda Berat", price: 15000 },
  { item_type: "Shoes", service_category: "Extra Treatment", variant: "Coating", price: 100000 },
  { item_type: "Bag", service_category: "Clean Small", variant: "Canvas", price: 100000 },
  { item_type: "Bag", service_category: "Clean Small", variant: "Leather", price: 125000 },
  { item_type: "Bag", service_category: "Clean Small", variant: "Suede", price: 150000 },
  { item_type: "Bag", service_category: "Clean Small", variant: "Kids", price: 95000 },
  { item_type: "Bag", service_category: "Clean Small", variant: "Backpack", price: 120000 },
  { item_type: "Bag", service_category: "Clean Medium", variant: "Canvas", price: 125000 },
  { item_type: "Bag", service_category: "Clean Medium", variant: "Leather", price: 150000 },
  { item_type: "Bag", service_category: "Clean Medium", variant: "Suede", price: 175000 },
  { item_type: "Bag", service_category: "Clean Medium", variant: "Kids", price: 110000 },
  { item_type: "Bag", service_category: "Clean Medium", variant: "Backpack", price: 140000 },
  { item_type: "Bag", service_category: "Clean Large", variant: "Canvas", price: 150000 },
  { item_type: "Bag", service_category: "Clean Large", variant: "Leather", price: 175000 },
  { item_type: "Bag", service_category: "Clean Large", variant: "Suede", price: 200000 },
  { item_type: "Bag", service_category: "Clean Large", variant: "Kids", price: 135000 },
  { item_type: "Bag", service_category: "Clean Large", variant: "Backpack", price: 175000 },
  { item_type: "Koper", service_category: "Clean", variant: "Size Small", price: 80000 },
  { item_type: "Koper", service_category: "Clean", variant: "Size Medium", price: 100000 },
  { item_type: "Koper", service_category: "Clean", variant: "Size Large", price: 115000 },
  { item_type: "Koper", service_category: "Clean", variant: "Size Extra Large", price: 135000 },
  { item_type: "Stroller", service_category: "Clean", variant: "Single", price: 170000 },
  { item_type: "Stroller", service_category: "Clean", variant: "Double", price: 200000 },
  { item_type: "Carrseat", service_category: "Clean", variant: "Size Medium", price: 145000 },
  { item_type: "Carrseat", service_category: "Clean", variant: "Size Large", price: 180000 },
  { item_type: "Wallet", service_category: "Clean", variant: "Wallet", price: 80000 },
  { item_type: "Topi/Cap", service_category: "Clean", variant: "Cap", price: 45000 },
  { item_type: "Jacket", service_category: "Clean", variant: "Canvas", price: 110000 },
  { item_type: "Jacket", service_category: "Clean", variant: "Leather", price: 150000 },
  { item_type: "Jacket", service_category: "Clean", variant: "Parasite", price: 125000 },
  { item_type: "Repair", service_category: "Koper", variant: "Handle Pecah", price: 250000 },
  { item_type: "Repair", service_category: "Koper", variant: "Body Koper", price: 450000 },
  { item_type: "Repair", service_category: "Koper", variant: "Roda Double", price: 550000 },
  { item_type: "Repair", service_category: "Koper", variant: "Resleting", price: 450000 },
  { item_type: "Repair", service_category: "Ringan Shoes", variant: "Reglue", price: 75000 },
  { item_type: "Repair", service_category: "Ringan Shoes", variant: "Reglue/Jahit", price: 150000 },
  { item_type: "Repair", service_category: "Ringan Shoes", variant: "Jahit Upper", price: 30000 },
];
const ITEM_TYPES = uniqueValues(SERVICES_CATALOG.map(item => item.item_type));
const SERVICE_PRICE_FALLBACK = {
  "sepatu bersih": 20000,
  "sepatu shoes cleaning": 20000,
  "sepatu shoe cleaning": 20000,
  "tas bersih": 22000,
  "tas bag cleaning": 22000,
  "shoes cleaning": 20000,
  "shoe cleaning": 20000,
  "sepatu cleaning": 20000,
  "bag cleaning": 22000,
  "tas cleaning": 22000,
};
const ALLOWED_BRANCH_NAMES = ["BEC", "Ciwalk", "PVJ", "TSM", "BTC"];

function renderItems() {
  const container = document.getElementById("itemsSection");
  if (!container) return;

  container.innerHTML = items.map((item, i) => `
    <div class="item-row" id="item-${i}">
      <p class="item-row-label">Item ${i + 1}</p>

      <div class="item-row-grid">
        <div class="form-group">
          <label>Item type <span class="req">*</span></label>
          <select class="item-type-select" onchange="selectItemType(${i}, this.value)">
            <option value="">Pilih item</option>
            ${ITEM_TYPES.map(type =>
              `<option value="${type}" ${item.type === type ? "selected" : ""}>${type}</option>`
            ).join("")}
          </select>
        </div>

        <div class="form-group" style="width:90px;">
          <label>qty <span class="req">*</span></label>
          <select class="qty-select" onchange="updateItem(${i}, 'qty', parseInt(this.value))">
            ${[1,2,3,4,5,6,7,8,9,10].map(n =>
              `<option value="${n}" ${item.qty === n ? "selected" : ""}>${n}</option>`
            ).join("")}
          </select>
        </div>

        <div class="form-group">
          <label>Service category <span class="req">*</span></label>
          <select class="service-type-select" onchange="selectItemCategory(${i}, this.value)" ${item.type ? "" : "disabled"}>
            <option value="">Pilih kategori</option>
            ${serviceCategoryOptionsHtml(item)}
          </select>
        </div>

        <div class="form-group">
          <label>Variant <span class="req">*</span></label>
          <select class="service-variant-select" onchange="selectItemVariant(${i}, this.value)" ${item.service ? "" : "disabled"}>
            <option value="">Pilih variant</option>
            ${serviceVariantOptionsHtml(item)}
          </select>
        </div>

        <div class="form-group" style="width:120px;">
          <label>Price</label>
          <input type="text" value="${escapeAttr(item.price ? formatPlainRupiah(item.price) : "-")}" readonly />
        </div>

        <div class="form-group">
          <label>Note</label>
          <input type="text" value="${escapeAttr(item.note)}" placeholder="Optional note"
            oninput="updateItem(${i}, 'note', this.value)" />
        </div>
      </div>

      ${items.length > 1 ? `
        <button class="btn-remove-item" onclick="removeItem(${i})" title="Hapus item">
          Hapus
        </button>
      ` : ""}
    </div>
  `).join("");
}

function updateItem(i, field, val) {
  items[i][field] = val;
}

function selectItemType(i, value) {
  items[i].type = value;
  items[i].service = "";
  items[i].serviceId = "";
  items[i].variant = "";
  items[i].price = 0;
  renderItems();
}

function selectItemCategory(i, value) {
  items[i].service = value;
  items[i].serviceId = "";
  items[i].variant = "";
  items[i].price = 0;
  renderItems();
}

function selectItemVariant(i, value) {
  items[i].variant = value;
  const service = catalogEntry(items[i]);
  items[i].price = parsePrice(service?.price);
  renderItems();
}

function serviceCategoryOptionsHtml(item) {
  return uniqueValues(SERVICES_CATALOG
    .filter(service => service.item_type === item.type)
    .map(service => service.service_category))
    .map(category => `<option value="${escapeAttr(category)}" ${item.service === category ? "selected" : ""}>${escapeHtml(category)}</option>`)
    .join("");
}

function serviceVariantOptionsHtml(item) {
  return SERVICES_CATALOG
    .filter(service => service.item_type === item.type && service.service_category === item.service)
    .map(service => `<option value="${escapeAttr(service.variant)}" ${item.variant === service.variant ? "selected" : ""}>${escapeHtml(service.variant)} - ${escapeHtml(formatPlainRupiah(service.price))}</option>`)
    .join("");
}

function removeItem(i) {
  items.splice(i, 1);
  renderItems();
}

function addItem() {
  items.push({ type: "", qty: 1, service: "", serviceId: "", variant: "", note: "", color: "", price: 0 });
  renderItems();
}

function setupSelect(wrapId, dropId, textId, onSelect) {
  const wrap = document.getElementById(wrapId);
  const drop = document.getElementById(dropId);
  const textEl = document.getElementById(textId);

  if (!wrap || !drop) return;

  wrap.querySelector(".fselect-display")?.addEventListener("click", e => {
    e.stopPropagation();
    drop.classList.toggle("open");
  });

  bindSelectOptions(drop, textEl, onSelect);

  document.addEventListener("click", () => drop.classList.remove("open"));
}

function bindSelectOptions(drop, textEl, onSelect) {
  drop.querySelectorAll(".fselect-opt").forEach(opt => {
    opt.onclick = () => {
      const val = opt.dataset.val;
      const title = opt.querySelector(".opt-title")?.textContent || opt.textContent.trim();

      if (textEl) {
        textEl.textContent = title;
        textEl.parentElement.classList.add("selected");
      }

      drop.querySelectorAll(".fselect-opt").forEach(o => o.classList.remove("selected"));
      opt.classList.add("selected");
      drop.classList.remove("open");

      onSelect(val);
    };
  });
}

function setupFormSelects() {
  setupSelect("branchWrap", "branchDropdown", "branchText", v => selectedBranch = v);
  setupSelect("paymentWrap", "paymentDropdown", "paymentText", v => selectedPayment = v);
  setupSelect("statusWrap", "statusDropdown", "statusText", v => selectedStatus = v);
}

async function loadBranches() {
  try {
    const { data, error } = await withTimeout(
      supabaseClient
        .from("branches")
        .select("*")
        .order("name", { ascending: true }),
      "Memuat branch terlalu lama.",
      8000
    );

    if (error) throw error;

    const drop = document.getElementById("branchDropdown");
    const textEl = document.getElementById("branchText");
    if (!drop) return;
    const branchOptions = uniqueAllowedBranchRecords(data);
    const source = branchOptions.length ? branchOptions : fallbackBranches();

    drop.innerHTML = source.map(branch => `
      <div class="fselect-opt" data-val="${escapeAttr(branch.id)}">
        <span class="opt-title">${escapeHtml(branch.name)}</span>
      </div>
    `).join("");

    bindSelectOptions(drop, textEl, v => selectedBranch = v);
    if (selectedBranch) setCustomSelect("branchDropdown", "branchText", selectedBranch, branchNameByValue(selectedBranch) || "Choose branch");
  } catch (error) {
    console.warn("Gagal memuat branches, fallback ke opsi statis:", error);
  }
}

async function loadServices() {
  availableServices = SERVICES_CATALOG;
}

function setFormMode() {
  if (!isEditMode) return;
  document.title = "Edit Order | Bedjo Cleaner";
  setText("pageTitle", "Edit Order");
  setText("formTitle", "Edit Order");
  const btnSave = document.getElementById("btnSave");
  if (btnSave) btnSave.textContent = "Update Order";
}

function validate() {
  let ok = true;

  const customer = document.getElementById("fCustomer")?.value.trim();
  const email = document.getElementById("fEmail")?.value.trim();
  const wa = document.getElementById("fWa")?.value.trim();

  clearText("errCustomer");
  clearText("errEmail");
  clearText("errWa");
  clearText("errPayment");
  clearText("errStatus");

  if (!customer) {
    setText("errCustomer", "Nama pelanggan wajib diisi.");
    ok = false;
  }

  if (!email) {
    setText("errEmail", "Email wajib diisi.");
    ok = false;
  }

  if (!wa) {
    setText("errWa", "Nomor WhatsApp wajib diisi.");
    ok = false;
  }

  if (!selectedPayment) {
    setText("errPayment", "Pilih metode pembayaran.");
    ok = false;
  }

  if (!selectedStatus) {
    setText("errStatus", "Pilih status order.");
    ok = false;
  }

  const invalidItem = items.some(item =>
    !item.type.trim() || !item.service.trim() || !String(item.variant || "").trim() || !item.qty
  );

  if (invalidItem) {
    alert("Semua item wajib punya item type, qty, service category, dan variant.");
    ok = false;
  }

  return ok;
}

function setText(id, msg) {
  const el = document.getElementById(id);
  if (el) el.textContent = msg;
}

function clearText(id) {
  const el = document.getElementById(id);
  if (el) el.textContent = "";
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || "");
}

function normalizeStatus(status) {
  return String(status || "").toLowerCase().replaceAll(" ", "_").replaceAll("-", "_");
}

function withTimeout(promise, message, timeout = 15000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeout);
    }),
  ]);
}

function generateOrderCode() {
  return "BK" + Date.now().toString().slice(-6);
}

async function calculateTotal() {
  const pricing = await calculateOrderPricing();
  return pricing.total;
}

async function calculateOrderPricing() {
  const services = await fetchServicesForPricing();
  let total = 0;

  const details = items.map(item => {
    const qty = Number(item.qty || 1);
    const service = catalogEntry(item) || findMatchingService(item, services);
    const price = servicePrice(service, item);
    const subtotal = price * qty;

    total += subtotal;

    return {
      item,
      service,
      item_type: item.type,
      service_id: item.serviceId || service?.id || "",
      service_name: item.service || service?.service_category || service?.name || "",
      variant: item.variant || service?.variant || "",
      price,
      quantity: qty,
      subtotal,
    };
  });

  console.log("order amount calculation:", details.map(detail => ({
    item_type: detail.item_type,
    service_name: detail.service_name,
    service_id: detail.service_id,
    variant: detail.variant,
    price: detail.price,
    quantity: detail.quantity,
    subtotal: detail.subtotal,
  })));
  console.log("order amount total:", total);

  return { details, total };
}

async function fetchServicesForPricing() {
  return availableServices.length ? availableServices : SERVICES_CATALOG;
}

function findMatchingService(item, services) {
  const serviceId = String(item.serviceId || "").trim();
  if (serviceId) {
    const byId = services.find(service => String(service.id) === serviceId);
    if (byId) return byId;
  }

  const serviceName = normalizeLookup(item.service);
  const itemType = normalizeLookup(item.type);

  return services.find(service => matchesService(service, serviceName) && matchesItemType(service, itemType)) ||
    services.find(service => normalizeLookup(`${service.category} ${service.name}`) === `${itemType} ${serviceName}`.trim()) ||
    services.find(service => normalizeLookup(service.name) === `${itemType} ${serviceName}`.trim()) ||
    services.find(service => matchesService(service, serviceName)) ||
    services.find(service => normalizeLookup(service.category) === serviceName);
}

function matchesService(service, serviceName) {
  if (!serviceName) return false;
  const name = normalizeLookup(service.name || service.service_category);
  const category = normalizeLookup(service.category || service.item_type);
  return name === serviceName ||
    category === serviceName ||
    name.includes(serviceName) ||
    serviceName.includes(name);
}

function matchesItemType(service, itemType) {
  if (!itemType) return false;
  const name = normalizeLookup(service.name || service.service_category);
  const category = normalizeLookup(service.category || service.item_type);
  return category === itemType ||
    category.includes(itemType) ||
    name.includes(itemType);
}

function servicePrice(service, item) {
  const catalog = catalogEntry(item);
  if (catalog) return parsePrice(catalog.price);

  const serviceName = normalizeLookup(item.service);
  const itemType = normalizeLookup(item.type);
  const itemFallback = SERVICE_PRICE_FALLBACK[`${itemType} ${serviceName}`.trim()];
  if (itemFallback) return itemFallback;

  const fromService = parsePrice(service?.price);
  if (fromService > 0) return fromService;

  const fallback = SERVICE_PRICE_FALLBACK[serviceName];
  if (fallback) return fallback;

  const fromItem = parsePrice(item.price);
  return fromItem > 0 ? fromItem : 20000;
}

function catalogEntry(item) {
  return SERVICES_CATALOG.find(service =>
    service.item_type === item.type &&
    service.service_category === item.service &&
    service.variant === item.variant
  ) || null;
}

function uniqueValues(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function parsePrice(value) {
  if (typeof value === "number") return value;
  const raw = String(value || "").trim();
  if (/^\d+(\.\d{1,2})?$/.test(raw)) return Number(raw);
  if (/^\d+,\d{1,2}$/.test(raw)) return Number(raw.replace(",", "."));
  const cleaned = raw.replace(/[^0-9]/g, "");
  return Number(cleaned || 0);
}

function formatPlainRupiah(value) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value || 0));
}

function normalizeLookup(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function saveOrderToSupabase() {
  if (isEditMode) {
    await updateOrderToSupabase();
    return;
  }

  if (!validate()) return;
  if (isOperatorScoped()) selectedBranch = currentProfile?.branch_id || "";
  if (isOperatorScoped() && !selectedBranch) return alert("Branch operator belum diset.");

  const btnSave = document.getElementById("btnSave");
  btnSave.disabled = true;
  btnSave.textContent = "Saving...";

  try {
    const orderCode = generateOrderCode();
    const pricing = await calculateOrderPricing();
    const totalAmount = pricing.total;

    const customerName = document.getElementById("fCustomer").value.trim();
    const customerEmail = document.getElementById("fEmail").value.trim();
    const customerPhone = document.getElementById("fWa").value.trim();

    const orderPayload = {
      order_code: orderCode,
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone,
      status: selectedStatus || "pending",
      total_amount: totalAmount,
      qr_data: orderCode
    };

    if (isUuid(session.user_id)) {
      orderPayload.operator_id = session.user_id;
    }

    // Branch dari Supabase memakai UUID; fallback statis hanya untuk menjaga UI tetap bisa dibuka.
    if (isUuid(selectedBranch)) {
      orderPayload.branch_id = selectedBranch;
    }

    const { data: order, error: orderError } = await withTimeout(
      supabaseClient
        .from("orders")
        .insert(orderPayload)
        .select()
        .single(),
      "Menyimpan order terlalu lama. Cek koneksi atau konfigurasi Supabase."
    );

    if (orderError) {
      console.error("ORDER ERROR:", orderError);
      alert("Gagal menyimpan order: " + orderError.message);
      return;
    }

    const { error: itemsError } = await withTimeout(
      insertOrderItemsWithServiceFallback(buildOrderItemsPayload(order.id, pricing)),
      "Menyimpan detail item terlalu lama. Cek koneksi atau konfigurasi Supabase."
    );

    if (itemsError) {
      console.error("ITEMS ERROR:", itemsError);
      alert("Order tersimpan, tapi detail item gagal: " + itemsError.message);
      return;
    }

    const { error: paymentError } = await withTimeout(
      supabaseClient
        .from("payments")
        .insert({
          order_id: order.id,
          method: selectedPayment,
          amount: totalAmount,
          paid_amount: selectedStatus === "completed" ? totalAmount : 0,
          status: selectedStatus === "completed" ? "paid" : "unpaid"
        }),
      "Menyimpan payment terlalu lama. Cek koneksi atau konfigurasi Supabase."
    );

    if (paymentError) {
      console.error("PAYMENT ERROR:", paymentError);
      alert("Order tersimpan, tapi payment gagal: " + paymentError.message);
      return;
    }

    sessionStorage.setItem("bc_saved_order", JSON.stringify({
      id: order.id,
      order_code: order.order_code,
      customer: customerName,
      wa: customerPhone,
      email: customerEmail,
      status: selectedStatus,
      total_amount: totalAmount
    }));

    await createNotification({
      type: "new_order",
      title: "New order created",
      message: `Order ${order.order_code} dibuat untuk ${customerName}.`,
      order_id: order.id,
      order_code: order.order_code,
      customer_name: customerName,
      customer_phone: customerPhone,
    });

    alert("Order berhasil disimpan ke Supabase.");
    window.location.href = "order-output.html?id=" + order.id;
  } catch (error) {
    console.error("SAVE ORDER ERROR:", error);
    saveOrderLocally();
    alert("Supabase belum merespons, jadi order disimpan lokal di browser dulu.");
    window.location.href = "order-output.html";
  } finally {
    btnSave.disabled = false;
    btnSave.textContent = isEditMode ? "Update Order" : "Save";
  }
}

async function loadEditOrder() {
  if (!isEditMode) return;
  if (editLoadStarted) return;
  editLoadStarted = true;
  console.log("editOrderId:", editOrderId);
  if (!isUuid(editOrderId)) {
    alert("ID order edit tidak valid.");
    window.location.href = "orders.html";
    return;
  }

  setFormMode();
  const btnSave = document.getElementById("btnSave");
  if (btnSave) {
    btnSave.disabled = true;
    btnSave.textContent = "Loading...";
  }

  try {
    const order = await withTimeout(
      fetchEditOrder(editOrderId),
      "Fetch edit order terlalu lama.",
      8000
    );
    console.log("fetched order:", order);

    const orderItems = await withTimeout(
      fetchEditOrderItems(editOrderId),
      "Fetch edit order_items terlalu lama.",
      8000
    );
    console.log("fetched order_items:", orderItems);

    const payment = await withTimeout(
      fetchEditPayment(editOrderId),
      "Fetch edit payment terlalu lama.",
      8000
    );
    console.log("fetched payment:", payment);

    editOrder = order;
    editPayment = payment;
    fillEditForm(order, orderItems || [], editPayment);
  } catch (error) {
    console.log("error Supabase:", error);
    console.error("LOAD EDIT ORDER ERROR:", error);
    alert("Gagal memuat data order untuk diedit.");
    window.location.href = "orders.html";
  } finally {
    if (btnSave) {
      btnSave.disabled = false;
      btnSave.textContent = "Update Order";
    }
  }
}

async function fetchEditOrder(orderId) {
  const withBranch = await supabaseClient
    .from("orders")
    .select(`
      id,
      order_code,
      customer_name,
      customer_email,
      customer_phone,
      branch_id,
      status,
      total_amount,
      branches (
        name
      )
    `)
    .eq("id", orderId)
    .single();

  if (!withBranch.error) return withBranch.data;

  console.log("error Supabase:", withBranch.error);
  console.warn("Retry fetch order without branches relation:", withBranch.error);
  const plain = await supabaseClient
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (plain.error) {
    console.log("error Supabase:", plain.error);
    throw plain.error;
  }

  return plain.data;
}

async function fetchEditOrderItems(orderId) {
  const withServices = await supabaseClient
    .from("order_items")
    .select(`
      *,
      services (
        id,
        name,
        price,
        category
      )
    `)
    .eq("order_id", orderId);

  if (!withServices.error) return sortOrderItems(withServices.data || []);

  console.log("error Supabase:", withServices.error);
  console.warn("Retry fetch order_items without services relation:", withServices.error);
  const plain = await supabaseClient
    .from("order_items")
    .select("*")
    .eq("order_id", orderId);

  if (plain.error) {
    console.log("error Supabase:", plain.error);
    throw plain.error;
  }

  return sortOrderItems(plain.data || []);
}

async function fetchEditPayment(orderId) {
  const result = await supabaseClient
    .from("payments")
    .select("id, order_id, method, amount, paid_amount, status")
    .eq("order_id", orderId)
    .limit(1);

  if (result.error) {
    console.log("error Supabase:", result.error);
    throw result.error;
  }

  return result.data?.[0] || null;
}

function sortOrderItems(orderItems) {
  return [...orderItems].sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));
}

function fillEditForm(order, orderItems, payment) {
  setInputValue("fCustomer", order.customer_name || "");
  setInputValue("fEmail", order.customer_email || "");
  setInputValue("fWa", order.customer_phone || "");

  selectedBranch = order.branch_id || "";
  selectedPayment = payment?.method || "";
  selectedStatus = normalizeStatus(order.status || "pending");

  setCustomSelect("branchDropdown", "branchText", selectedBranch, branchNameByValue(selectedBranch) || normalizeBranchName(order.branches?.name) || "Choose branch");
  setCustomSelect("paymentDropdown", "paymentText", selectedPayment, null);
  setCustomSelect("statusDropdown", "statusText", selectedStatus, null);
  supportsServiceTypeColumn = supportsServiceTypeColumn || orderItems.some(item => Object.prototype.hasOwnProperty.call(item, "service_type"));

  items = orderItems.length
    ? orderItems.map(item => ({
        type: normalizeLegacyItemType(item.item_type || ""),
        qty: Number(item.quantity || 1),
        service: normalizeLegacyServiceCategory(item.service_type || item.service_name || item.services?.name || serviceFromNotes(item.notes) || ""),
        serviceId: item.service_id || item.services?.id || "",
        variant: variantFromNotes(item.notes) || inferVariant(item),
        price: parsePrice(item.services?.price || item.price),
        hasServiceTypeColumn: Object.prototype.hasOwnProperty.call(item, "service_type"),
        hasColorColumn: Object.prototype.hasOwnProperty.call(item, "color"),
        color: item.color || "",
        note: stripCatalogMetaFromNotes(item.notes),
      }))
    : [{ type: "", qty: 1, service: "", serviceId: "", variant: "", note: "", color: "", price: 0 }];

  renderItems();
}

async function updateOrderToSupabase() {
  if (!validate()) return;
  if (isOperatorScoped()) selectedBranch = currentProfile?.branch_id || "";
  if (isOperatorScoped() && !selectedBranch) return alert("Branch operator belum diset.");

  const btnSave = document.getElementById("btnSave");
  if (btnSave) {
    btnSave.disabled = true;
    btnSave.textContent = "Updating...";
  }

  try {
    const pricing = await calculateOrderPricing();
    const totalAmount = pricing.total;
    const customerName = document.getElementById("fCustomer").value.trim();
    const customerEmail = document.getElementById("fEmail").value.trim();
    const customerPhone = document.getElementById("fWa").value.trim();

    const orderPayload = {
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone,
      status: selectedStatus || "pending",
      total_amount: totalAmount,
    };

    if (isUuid(selectedBranch)) {
      orderPayload.branch_id = selectedBranch;
    }

    const { error: orderError } = await withTimeout(
      supabaseClient
        .from("orders")
        .update(orderPayload)
        .eq("id", editOrderId),
      "Mengupdate order terlalu lama. Cek koneksi atau konfigurasi Supabase."
    );

    if (orderError) throw orderError;

    const { error: deleteItemsError } = await withTimeout(
      supabaseClient
        .from("order_items")
        .delete()
        .eq("order_id", editOrderId),
      "Menghapus item lama terlalu lama. Cek koneksi atau konfigurasi Supabase."
    );

    if (deleteItemsError) throw deleteItemsError;

    const { error: insertItemsError } = await withTimeout(
      insertOrderItemsWithServiceFallback(buildOrderItemsPayload(editOrderId, pricing)),
      "Menyimpan item update terlalu lama. Cek koneksi atau konfigurasi Supabase."
    );

    if (insertItemsError) throw insertItemsError;

    const paymentPayload = buildPaymentPayload(totalAmount);
    const paymentQuery = editPayment?.id
      ? supabaseClient.from("payments").update(paymentPayload).eq("id", editPayment.id)
      : supabaseClient.from("payments").insert({ ...paymentPayload, order_id: editOrderId });

    const { error: paymentError } = await withTimeout(
      paymentQuery,
      "Mengupdate payment terlalu lama. Cek koneksi atau konfigurasi Supabase."
    );

    if (paymentError) throw paymentError;

    sessionStorage.setItem("bc_saved_order", JSON.stringify({
      id: editOrderId,
      order_code: editOrder?.order_code,
      customer: customerName,
      wa: customerPhone,
      email: customerEmail,
      status: selectedStatus,
      total_amount: totalAmount
    }));

    await createNotification({
      type: selectedStatus === "completed" ? "order_completed" : "order_status_updated",
      title: selectedStatus === "completed" ? "Order completed" : "Order status updated",
      message: selectedStatus === "completed"
        ? `Order ${editOrder?.order_code || editOrderId} selesai dan siap diambil.`
        : `Order ${editOrder?.order_code || editOrderId} diupdate ke ${selectedStatus}.`,
      order_id: editOrderId,
      order_code: editOrder?.order_code,
      customer_name: customerName,
      customer_phone: customerPhone,
    });

    alert("Order berhasil diupdate.");
    window.location.href = "order-detail.html?id=" + encodeURIComponent(editOrderId);
  } catch (error) {
    console.log("error Supabase:", error);
    console.error("UPDATE ORDER ERROR:", error);
    alert("Gagal mengupdate order: " + (error.message || error));
  } finally {
    if (btnSave) {
      btnSave.disabled = false;
      btnSave.textContent = "Update Order";
    }
  }
}

function buildOrderItemsPayload(orderId, pricing) {
  return (pricing?.details || items.map(item => ({ item }))).map(detail => {
    const item = detail.item;
    const price = parsePrice(detail.price) || parsePrice(item.price) || 20000;
    const qty = Number(detail.quantity || item.qty || 1);
    const serviceType = detail.service_name || item.service || "";
    const notesWithVariant = mergeVariantIntoNotes(detail.variant || item.variant, item.note);
    const payload = {
      order_id: orderId,
      item_type: item.type,
      notes: notesWithVariant || null,
      quantity: qty,
      price: price,
      subtotal: price * qty,
      service_type: serviceType || null
    };

    if (isUuid(detail.service_id || item.serviceId)) {
      payload.service_id = detail.service_id || item.serviceId;
    }
    if (item.hasColorColumn) {
      payload.color = item.color || null;
    }

    return payload;
  });
}

async function insertOrderItemsWithServiceFallback(payload) {
  const first = await supabaseClient
    .from("order_items")
    .insert(payload);

  if (!first.error || !hasMissingColumnError(first.error, "service_type")) {
    return first;
  }

  console.warn("Kolom service_type tidak tersedia, retry insert order_items tanpa service_type:", first.error);
  supportsServiceTypeColumn = false;
  const strippedPayload = payload.map(({ service_type, ...item }) => ({
    ...item,
    notes: mergeServiceIntoNotes(service_type, item.notes),
  }));
  return supabaseClient
    .from("order_items")
    .insert(strippedPayload);
}

function mergeServiceIntoNotes(serviceType, note) {
  const cleanService = String(serviceType || "").trim();
  const cleanNote = stripServiceFromNotes(note);
  if (!cleanService) return cleanNote || null;
  return `[service_type:${cleanService}]${cleanNote ? ` ${cleanNote}` : ""}`;
}

function mergeVariantIntoNotes(variant, note) {
  const cleanVariant = String(variant || "").trim();
  const cleanNote = stripCatalogMetaFromNotes(note);
  if (!cleanVariant) return cleanNote || null;
  return `[variant:${cleanVariant}]${cleanNote ? ` ${cleanNote}` : ""}`;
}

function stripServiceFromNotes(note) {
  return String(note || "").replace(/^\[service_type:[^\]]+\]\s*/i, "").trim();
}

function serviceFromNotes(note) {
  return String(note || "").match(/^\[service_type:([^\]]+)\]/i)?.[1]?.trim() || "";
}

function variantFromNotes(note) {
  return String(note || "").match(/\[variant:([^\]]+)\]/i)?.[1]?.trim() || "";
}

function stripCatalogMetaFromNotes(note) {
  return String(note || "")
    .replace(/\[service_type:[^\]]+\]\s*/ig, "")
    .replace(/\[variant:[^\]]+\]\s*/ig, "")
    .trim();
}

function inferVariant(item) {
  const itemType = normalizeLegacyItemType(item.item_type || "");
  const serviceName = normalizeLegacyServiceCategory(item.service_type || item.service_name || item.services?.name || serviceFromNotes(item.notes) || "");
  const price = parsePrice(item.services?.price || item.price);
  const match = SERVICES_CATALOG.find(service =>
    service.item_type === itemType &&
    service.service_category === serviceName &&
    (!price || parsePrice(service.price) === price)
  );
  return match?.variant || "";
}

function normalizeLegacyItemType(value) {
  const normalized = normalizeLookup(value);
  if (normalized === "sepatu") return "Shoes";
  if (normalized === "tas") return "Bag";
  return value;
}

function normalizeLegacyServiceCategory(value) {
  const normalized = normalizeLookup(value);
  if (["shoes cleaning", "shoe cleaning", "sepatu cleaning", "bersih"].includes(normalized)) return "Regular Clean";
  if (["bag cleaning", "tas cleaning"].includes(normalized)) return "Clean Small";
  return value;
}

function hasMissingColumnError(error, columnName) {
  const text = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`;
  return text.toLowerCase().includes(columnName.toLowerCase());
}

function buildPaymentPayload(totalAmount) {
  const currentStatus = normalizeStatus(editPayment?.status);
  const nextStatus = selectedStatus === "completed"
    ? "paid"
    : (["paid", "partial", "unpaid"].includes(currentStatus) ? currentStatus : "unpaid");
  const paidAmount = nextStatus === "paid"
    ? totalAmount
    : nextStatus === "unpaid"
      ? 0
      : Number(editPayment?.paid_amount || 0);

  return {
    method: selectedPayment,
    amount: totalAmount,
    paid_amount: paidAmount,
    status: nextStatus,
  };
}

function saveOrderLocally() {
  const orderCode = generateOrderCode();
  const customerName = document.getElementById("fCustomer").value.trim();
  const customerEmail = document.getElementById("fEmail").value.trim();
  const customerPhone = document.getElementById("fWa").value.trim();
  const totalAmount = items.reduce((sum, item) => sum + (Number(item.qty || 1) * (parsePrice(item.price) || parsePrice(catalogEntry(item)?.price) || SERVICE_PRICE_FALLBACK[normalizeLookup(item.service)] || 20000)), 0);

  const localOrder = {
    id: orderCode,
    order_code: orderCode,
    customer: customerName,
    phone: customerPhone,
    wa: customerPhone,
    email: customerEmail,
    status: selectedStatus || "pending",
    total_amount: totalAmount,
    date: new Date().toISOString(),
    items: items.map(item => ({ ...item })),
    payment_method: selectedPayment,
  };

  const localOrders = getLocalOrders();
  localOrders.unshift(localOrder);

  localStorage.setItem("bc_local_orders", JSON.stringify(localOrders));
  sessionStorage.setItem("bc_saved_order", JSON.stringify(localOrder));
}

function getLocalOrders() {
  try {
    return JSON.parse(localStorage.getItem("bc_local_orders")) || [];
  } catch {
    return [];
  }
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

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function setInputValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value || "";
}

function setCustomSelect(dropdownId, textId, value, fallbackLabel) {
  const dropdown = document.getElementById(dropdownId);
  const textEl = document.getElementById(textId);
  const options = dropdown ? [...dropdown.querySelectorAll(".fselect-opt")] : [];
  const match = options.find(opt => opt.dataset.val === value);

  options.forEach(opt => opt.classList.toggle("selected", opt === match));

  if (textEl) {
    textEl.textContent = match?.querySelector(".opt-title")?.textContent || fallbackLabel || value || "-";
    textEl.parentElement?.classList.add("selected");
  }
}

function normalizeBranchName(name) {
  const raw = String(name || "").trim().toLowerCase();
  return ALLOWED_BRANCH_NAMES.find(branch => branch.toLowerCase() === raw) || "";
}

function uniqueAllowedBranchRecords(rows) {
  const seen = new Set();
  return (rows || []).reduce((result, row) => {
    const name = normalizeBranchName(row?.name || row?.branch || row?.id);
    if (!name || seen.has(name)) return result;
    seen.add(name);
    result.push({ ...row, id: row.id || name, name });
    return result;
  }, []);
}

function fallbackBranches() {
  return ALLOWED_BRANCH_NAMES.map(name => ({ id: name, name }));
}

function branchNameByValue(value) {
  const dropdown = document.getElementById("branchDropdown");
  const match = dropdown ? [...dropdown.querySelectorAll(".fselect-opt")].find(opt => opt.dataset.val === value) : null;
  return match?.querySelector(".opt-title")?.textContent || normalizeBranchName(value);
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

async function createNotification(payload) {
  if (window.BedjoNotification?.createNotification) {
    return window.BedjoNotification.createNotification(payload);
  }

  const notificationPayload = {
    type: payload.type || "order_status_updated",
    title: payload.title || "Notification",
    message: payload.message || "",
    order_id: payload.order_id || null,
    order_code: payload.order_code || null,
    customer_name: payload.customer_name || null,
    customer_phone: payload.customer_phone || null,
    is_read: false,
    created_at: new Date().toISOString(),
  };

  console.log("insert notification payload:", notificationPayload);

  try {
    const result = await supabaseClient
      .from("notifications")
      .insert(notificationPayload);

    console.log("insert notification result:", result);

    if (result.error) {
      console.error("insert notification error:", result.error);
    }
  } catch (error) {
    console.error("insert notification exception:", error);
  }
}

/* Drawer */
let drawerOpen = window.innerWidth >= 768;

function syncDrawer() {
  const drawer = document.getElementById("drawer");
  const mainWrap = document.getElementById("mainWrap");
  const overlay = document.getElementById("overlay");
  if (!drawer || !mainWrap || !overlay) return;

  if (drawerOpen) {
    drawer.classList.remove("collapsed");
    mainWrap.classList.remove("expanded");
    overlay.classList.remove("show");
  } else {
    drawer.classList.add("collapsed");
    mainWrap.classList.add("expanded");

    if (window.innerWidth < 768) {
      overlay.classList.add("show");
    }
  }
}

function setupShellEvents() {
  const hamburger = document.getElementById("hamburger");
  const overlay = document.getElementById("overlay");
  const userPill = document.getElementById("userPill");
  const uDropdown = document.getElementById("uDropdown");

  if (window.innerWidth < 768) drawerOpen = false;
  syncDrawer();

  hamburger?.addEventListener("click", () => {
    drawerOpen = !drawerOpen;
    syncDrawer();
  });

  overlay?.addEventListener("click", () => {
    drawerOpen = false;
    syncDrawer();
  });

  userPill?.addEventListener("click", e => {
    e.stopPropagation();
    uDropdown?.classList.toggle("open");
  });

  document.addEventListener("click", () => {
    uDropdown?.classList.remove("open");
  });

  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    sessionStorage.removeItem("bc_session");
    localStorage.removeItem("bedjo_session");
    localStorage.removeItem("bc_remember");
    window.location.replace("../login.html");
  });
}

function initOrderCreatePage() {
  if (orderCreateInitialized) return;
  orderCreateInitialized = true;
  console.log("initOrderCreatePage");
  setupShellEvents();
  setupFormSelects();
  document.getElementById("btnAddItem")?.addEventListener("click", addItem);
  document.getElementById("btnSave")?.addEventListener("click", saveOrderToSupabase);
  document.getElementById("btnCancel")?.addEventListener("click", () => {
    sessionStorage.removeItem("bc_edit_order");
    window.location.href = "orders.html";
  });
  setFormMode();
  renderItems();
  loadCurrentProfile()
    .then(profile => {
      currentProfile = profile;
      if (isOperatorScoped()) selectedBranch = profile?.branch_id || selectedBranch;
    })
    .then(() => Promise.all([loadBranches(), loadServices()]))
    .finally(() => {
      if (isOperatorScoped() && selectedBranch) {
        setCustomSelect("branchDropdown", "branchText", selectedBranch, branchNameByValue(selectedBranch) || "Choose branch");
      }
      renderItems();
      loadEditOrder();
    });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initOrderCreatePage);
} else {
  initOrderCreatePage();
}

setTimeout(() => {
  if (isEditMode && !editLoadStarted) {
    console.log("edit mode bootstrap fallback");
    initOrderCreatePage();
  }
}, 300);
