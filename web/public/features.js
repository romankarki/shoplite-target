// ShopLite features behind flags (FEATURES env → /api/health → onFeatures).
//   wishlist — ♥ on every product + a wishlist drawer, saved server-side (/api/wishlist)
//   swipe    — Tinder-style "Discover" deck: → wishlist · ← skip · ↑ cart (also turns on wishlist)
// Main ShopLite runs with no flags; preview environments (pr-142, pr-143) turn them on.

let WISH = [];            // wishlist products from the API
let WISH_ON = false, SWIPE_ON = false;

window.onFeatures = async (features) => {
  SWIPE_ON = features.includes("swipe");
  WISH_ON = SWIPE_ON || features.includes("wishlist");
  if (!WISH_ON) return;
  injectWishlistUI();
  await loadWish();
  if (SWIPE_ON) injectDeckUI();
};

// ---------- wishlist ----------
const wished = (id) => WISH.some((p) => p.id === id);

function injectWishlistUI() {
  const btn = document.createElement("button");
  btn.className = "btn ghost"; btn.id = "wish-btn";
  btn.innerHTML = `♥ Wishlist <span class="badge brand" id="wish-count">0</span>`;
  $("#cart-btn").before(btn);
  btn.onclick = () => { renderWish(); open($("#wish-drawer")); };

  const d = document.createElement("aside");
  d.className = "drawer"; d.id = "wish-drawer"; d.hidden = true;
  d.innerHTML = `<div class="h"><h3>♥ Wishlist <span class="badge brand">new</span></h3><button class="icon-btn" data-close>✕</button></div><div class="b" id="wish-lines"></div>`;
  document.body.appendChild(d);

  const baseClose = closeAll;   // also close the wishlist drawer on overlay click / Esc
  closeAll = () => { baseClose(); d.hidden = true; };
}

async function loadWish() {
  try { WISH = await api("/wishlist"); } catch (e) { WISH = []; }
  renderWish(); decorateGrid();
}

async function toggleWish(id, on) {
  try {
    WISH = await api(`/wishlist/${id}`, { method: on ? "PUT" : "DELETE" });
    renderWish(); decorateGrid();
  } catch (e) { toast(e.message); }
}

function renderWish() {
  $("#wish-count").textContent = WISH.length;
  const box = $("#wish-lines"); if (!box) return;
  box.innerHTML = WISH.length ? WISH.map((p) => `
    <div class="line">
      <span class="em" style="background:${esc(p.color)}">${esc(p.emoji)}</span>
      <div class="grow"><div style="font-weight:500">${esc(p.name)}</div><div class="muted" style="font-size:12px">${money(p.final_cents)}</div></div>
      <button class="btn sm" data-wish-cart="${p.id}">Add to cart</button>
      <button class="icon-btn" data-wish-off="${p.id}" title="Remove">✕</button>
    </div>`).join("")
    : `<p class="muted">${SWIPE_ON ? "Swipe right on a product to save it here." : "Tap ♡ on a product to save it here."}</p>`;
}

// hearts on the product grid (re-applied after every grid render)
function decorateGrid() {
  if (!WISH_ON) return;
  document.querySelectorAll("#grid .prod").forEach((el, i) => {
    const p = products[i]; if (!p) return;
    let h = el.querySelector(".heart");
    if (!h) { h = document.createElement("button"); h.className = "heart"; el.prepend(h); }
    h.dataset.wish = p.id;
    h.setAttribute("aria-pressed", wished(p.id));
    h.title = wished(p.id) ? "Remove from wishlist" : "Save to wishlist";
    h.textContent = wished(p.id) ? "♥" : "♡";
  });
}
const baseRenderGrid = renderGrid;
renderGrid = () => { baseRenderGrid(); decorateGrid(); if (SWIPE_ON && !DECK.ready) startDeck(); };

document.addEventListener("click", async (e) => {
  const h = e.target.closest("[data-wish]");
  if (h) { const id = +h.dataset.wish, on = !wished(id); await toggleWish(id, on); toast(on ? "Saved to wishlist ♥" : "Removed from wishlist"); return; }
  const off = e.target.closest("[data-wish-off]"); if (off) { toggleWish(+off.dataset.wishOff, false); return; }
  const c = e.target.closest("[data-wish-cart]");
  if (c) { const id = +c.dataset.wishCart, inCart = cart.items.find((i) => i.id === id); await setQty(id, (inCart ? inCart.qty : 0) + 1); toast("Added to cart"); }
});

// ---------- Tinder-style Discover deck ----------
const DECK = { ready: false, queue: [] };

function injectDeckUI() {
  $(".hero").hidden = true;  // full focus on the deck, like the real app
  const wrap = document.createElement("section");
  wrap.className = "deck-wrap"; wrap.id = "deck-wrap";
  wrap.innerHTML = `
    <div class="deck-head"><div><b>Discover</b> <span class="badge brand">new</span></div>
      <div class="seg" id="view-seg"><button data-view="swipe" class="on">Swipe</button><button data-view="grid">Grid</button></div></div>
    <div class="deck" id="deck"></div>
    <div class="swipe-ctrls">
      <button class="rb nope" data-act="left" title="Skip (←)">✕</button>
      <button class="rb sm cart" data-act="up" title="Add to cart (↑)">🛒</button>
      <button class="rb like" data-act="right" title="Wishlist (→)">♥</button>
    </div>
    <p class="muted swipe-hint">Drag the card: <b>right</b> = wishlist · <b>left</b> = skip · <b>up</b> = cart. Arrow keys work too.</p>`;
  $("#grid").before(wrap);
  wrap.querySelector(".swipe-ctrls").addEventListener("click", (e) => { const b = e.target.closest("[data-act]"); if (b) decide(b.dataset.act); });
  wrap.querySelector("#view-seg").addEventListener("click", (e) => { const b = e.target.closest("[data-view]"); if (b) setView(b.dataset.view); });
  document.addEventListener("keydown", (e) => {
    if ($("#deck").hidden || e.target.matches("input, textarea, select")) return;
    const dir = { ArrowRight: "right", ArrowLeft: "left", ArrowUp: "up" }[e.key];
    if (dir) { e.preventDefault(); decide(dir); }
  });
  setView("swipe");
  if (products.length) startDeck();
}

function startDeck() { DECK.ready = true; DECK.queue = products.slice(); renderDeck(); }

function setView(v) {
  document.querySelectorAll("#view-seg button").forEach((b) => b.classList.toggle("on", b.dataset.view === v));
  ["#deck", ".swipe-ctrls", ".swipe-hint"].forEach((s) => ($(s).hidden = v !== "swipe"));
  $("#grid").hidden = v === "swipe";
}

function renderDeck() {
  const deck = $("#deck");
  if (!DECK.queue.length) {
    deck.innerHTML = `<div class="deck-done"><div style="font-size:40px">🎉</div><b>You've seen everything</b><span class="muted">${WISH.length} saved to your wishlist</span>
      <div style="display:flex;gap:8px;justify-content:center"><button class="btn primary sm" id="deck-wish">View wishlist</button><button class="btn sm" id="deck-restart">Start over</button></div></div>`;
    $("#deck-wish").onclick = () => { renderWish(); open($("#wish-drawer")); };
    $("#deck-restart").onclick = startDeck;
    return;
  }
  deck.innerHTML = DECK.queue.slice(0, 2).reverse().map((p, i, arr) => `
    <div class="swc ${i === arr.length - 1 ? "top" : "under"}" data-id="${p.id}">
      <div class="pic" style="background:${esc(p.color)}">${esc(p.emoji)}</div>
      <div class="meta"><div class="nm">${esc(p.name)}</div>
        <div><b>${money(p.final_cents)}</b> ${p.sale_pct ? `<s class="muted">${money(p.price_cents)}</s>` : ""} · <span class="muted">★ ${p.rating.toFixed(1)}</span></div></div>
      <span class="stamp like">WISHLIST</span><span class="stamp nope">NOPE</span><span class="stamp cart">🛒 CART</span>
    </div>`).join("");
  bindDrag(deck.querySelector(".swc.top"));
}

async function decide(dir) {
  const card = $("#deck .swc.top"); if (!card || card.classList.contains("fly")) return;
  const p = DECK.queue[0];
  card.querySelector(".stamp." + { right: "like", left: "nope", up: "cart" }[dir]).style.opacity = 1;
  card.classList.add("fly");
  card.style.transform = { right: "translate(150%, 0) rotate(25deg)", left: "translate(-150%, 0) rotate(-25deg)", up: "translate(0, -150%)" }[dir];
  card.style.opacity = 0;
  DECK.queue.shift();
  setTimeout(renderDeck, 320);
  if (dir === "right") { await toggleWish(p.id, true); toast(`♥ ${p.name} saved to wishlist`); }
  if (dir === "up") { const inCart = cart.items.find((i) => i.id === p.id); await setQty(p.id, (inCart ? inCart.qty : 0) + 1); toast(`🛒 ${p.name} added to cart`); }
}

function bindDrag(card) {
  let sx = 0, sy = 0, dx = 0, dy = 0, dragging = false;
  const st = (n) => card.querySelector(".stamp." + n);
  const clamp = (v) => Math.max(0, Math.min(1, v));
  card.addEventListener("pointerdown", (e) => { dragging = true; sx = e.clientX; sy = e.clientY; card.setPointerCapture(e.pointerId); card.classList.remove("snap"); });
  card.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    dx = e.clientX - sx; dy = e.clientY - sy;
    card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 18}deg)`;
    st("like").style.opacity = clamp(dx / 100);
    st("nope").style.opacity = clamp(-dx / 100);
    st("cart").style.opacity = clamp(-dy / 100 - Math.abs(dx) / 200);
  });
  const end = () => {
    if (!dragging) return; dragging = false;
    if (dx > 100) return decide("right");
    if (dx < -100) return decide("left");
    if (dy < -100) return decide("up");
    card.classList.add("snap"); card.style.transform = ""; ["like", "nope", "cart"].forEach((n) => (st(n).style.opacity = 0));
    dx = dy = 0;
  };
  card.addEventListener("pointerup", end); card.addEventListener("pointercancel", end);
}
