// ShopLite frontend — talks to the API at /api (proxied by nginx)

const $ = (s) => document.querySelector(s);
const money = (c) => "$" + (c / 100).toFixed(2);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// anonymous customer id, kept in the browser
function customerId() {
  let id = null;
  try { id = localStorage.getItem("shoplite-customer"); } catch (e) {}
  if (!id) {
    // randomUUID needs a secure context (https/localhost); fall back for plain-http preview hosts
    id = crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
    try { localStorage.setItem("shoplite-customer", id); } catch (e) {} }
  return id;
}
const CUSTOMER = customerId();

async function api(path, opts = {}) {
  const res = await fetch("/api" + path, {
    ...opts,
    headers: { "Content-Type": "application/json", "X-Customer-Id": CUSTOMER, ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && (typeof data.detail === "string" ? data.detail : data.detail?.[0]?.msg)) || `Request failed (${res.status})`);
  return data;
}

function toast(msg) {
  let w = $(".toast-wrap");
  if (!w) { w = document.createElement("div"); w.className = "toast-wrap"; document.body.appendChild(w); }
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; w.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ---------- panels ----------
function open(el) { $("#overlay").hidden = false; el.hidden = false; }
function closeAll() { ["#overlay", "#cart-drawer", "#orders-drawer", "#report-modal"].forEach((s) => ($(s).hidden = true)); }
document.addEventListener("click", (e) => { if (e.target.closest("[data-close]") || e.target.id === "overlay") closeAll(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAll(); });

// ---------- products ----------
let products = [];
async function loadProducts(q = "") {
  try {
    products = await api("/products?q=" + encodeURIComponent(q));
    renderGrid();
  } catch (e) {
    $("#grid").innerHTML = `<div class="empty">Couldn't load products: ${esc(e.message)}</div>`;
  }
}
function renderGrid() {
  $("#grid").innerHTML = products.length ? products.map((p) => `
    <div class="prod">
      <div class="img" style="background:${esc(p.color)}">${esc(p.emoji)}</div>
      <div class="info">
        <div class="name">${esc(p.name)}</div>
        <div class="muted" style="font-size:12px">★ ${p.rating.toFixed(1)} · ${p.stock > 0 ? `${p.stock} in stock` : "Sold out"}</div>
        <div class="row">
          <span class="price">${money(p.final_cents)} ${p.sale_pct ? `<s>${money(p.price_cents)}</s>` : ""}</span>
          <button class="btn sm" data-add="${p.id}" ${p.stock > 0 ? "" : "disabled"}>Add</button>
        </div>
      </div>
    </div>`).join("") : `<div class="empty">No products match your search.</div>`;
}
let searchTimer;
$("#search").addEventListener("input", (e) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadProducts(e.target.value.trim()), 250); });

// ---------- cart ----------
let cart = { items: [], count: 0, total_cents: 0 };
async function loadCart() { cart = await api("/cart"); renderCart(); }
async function setQty(productId, qty) {
  try { cart = await api(`/cart/items/${productId}`, { method: "PUT", body: { qty } }); renderCart(); }
  catch (e) { toast(e.message); }
}
function renderCart() {
  $("#cart-count").textContent = cart.count;
  $("#cart-total").textContent = money(cart.total_cents);
  $("#checkout-btn").disabled = !cart.items.length;
  $("#cart-lines").innerHTML = cart.items.length ? cart.items.map((i) => `
    <div class="line">
      <span class="em" style="background:${esc(i.color)}">${esc(i.emoji)}</span>
      <div class="grow"><div style="font-weight:500">${esc(i.name)}</div><div class="muted" style="font-size:12px">${money(i.final_cents)} each</div></div>
      <span class="qty"><button data-qty="${i.id}" data-to="${i.qty - 1}" aria-label="Decrease">−</button><span>${i.qty}</span><button data-qty="${i.id}" data-to="${i.qty + 1}" aria-label="Increase">+</button></span>
      <b style="min-width:64px;text-align:right">${money(i.line_cents)}</b>
    </div>`).join("") : `<p class="muted">Your cart is empty.</p>`;
}
document.addEventListener("click", async (e) => {
  const add = e.target.closest("[data-add]");
  if (add) {
    const id = +add.dataset.add, inCart = cart.items.find((i) => i.id === id);
    await setQty(id, (inCart ? inCart.qty : 0) + 1);
    toast("Added to cart");
  }
  const q = e.target.closest("[data-qty]");
  if (q) setQty(+q.dataset.qty, +q.dataset.to);
});
$("#cart-btn").onclick = () => { $("#checkout-msg").innerHTML = ""; open($("#cart-drawer")); };

$("#checkout-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#checkout-btn"), msg = $("#checkout-msg");
  btn.disabled = true; btn.textContent = "Placing order…"; msg.innerHTML = "";
  try {
    const order = await api("/checkout", { method: "POST", body: { email: $("#email").value } });
    msg.innerHTML = `<div class="notice good">✓ Order #${order.id} placed — ${money(order.total_cents)}. Receipt sent to ${esc($("#email").value)}.</div>`;
    await Promise.all([loadCart(), loadProducts($("#search").value.trim())]);
  } catch (err) {
    msg.innerHTML = `<div class="notice bad">✕ ${esc(err.message)}</div>`;
  } finally {
    btn.textContent = "Place order"; btn.disabled = !cart.items.length;
  }
});

// ---------- orders ----------
$("#orders-btn").onclick = async () => {
  open($("#orders-drawer"));
  $("#orders-list").innerHTML = `<p class="muted">Loading…</p>`;
  try {
    const orders = await api("/orders");
    $("#orders-list").innerHTML = orders.length ? orders.map((o) => `
      <div class="order">
        <div style="display:flex;justify-content:space-between"><b>Order #${o.id}</b><span class="badge good">${esc(o.status)}</span></div>
        <div class="muted">${new Date(o.created_at).toLocaleString()} · ${esc(o.email)}</div>
        <div>${o.items.map((i) => `${i.qty}× ${esc(i.name)}`).join(", ")}</div>
        <b>${money(o.total_cents)}</b>
      </div>`).join("") : `<p class="muted">No orders yet.</p>`;
  } catch (e) { $("#orders-list").innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; }
};

// ---------- report a problem ----------
$("#report-btn").onclick = () => { $("#r-msg").innerHTML = ""; $("#report-form").reset(); open($("#report-modal")); };
$("#report-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const fb = await api("/feedback", { method: "POST", body: { kind: $("#r-kind").value, message: $("#r-text").value, page: location.pathname } });
    $("#r-msg").innerHTML = `<div class="notice good">Thanks! Logged as <b>${esc(fb.ticket)}</b> — our team (and Sidekick) will take a look.</div>`;
    $("#r-text").value = "";
  } catch (err) { $("#r-msg").innerHTML = `<div class="notice bad">${esc(err.message)}</div>`; }
});

// ---------- theme ----------
$("#theme-btn").onclick = () => {
  const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("shoplite-theme", next); } catch (e) {}
};

// ---------- boot ----------
(async () => {
  try {
    const h = await api("/health");
    if (h.preview) { $("#preview-bar").hidden = false; $("#preview-bar").innerHTML = `🔍 Preview environment <b>${esc(h.preview)}</b> · branch <code>${esc(h.branch)}</code>`; }
    $("#footer").textContent = `ShopLite ${h.version} · ${h.branch}`;
    if (window.onFeatures) await window.onFeatures(h.features || []);  // feature flags → features.js
  } catch (e) { $("#footer").textContent = "API unreachable"; }
  loadProducts();
  loadCart().catch(() => {});
})();
