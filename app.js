const PRODUCTS = [
  { id: "sauce-labs-backpack", name: "Sauce Labs Backpack", price: 29.99 },
  { id: "sauce-labs-bike-light", name: "Sauce Labs Bike Light", price: 9.99 },
  { id: "sauce-labs-bolt-t-shirt", name: "Sauce Labs Bolt T-Shirt", price: 15.99 },
  { id: "sauce-labs-fleece-jacket", name: "Sauce Labs Fleece Jacket", price: 49.99 },
  { id: "sauce-labs-onesie", name: "Sauce Labs Onesie", price: 7.99 },
  { id: "test-allthethings-t-shirt-red", name: "Test.allTheThings() T-Shirt (Red)", price: 15.99 },
];
const CFG = window.APP_CONFIG || { users: {}, locked: [] };
const USERS = CFG.users;
const page = document.body.dataset.page;
const get = (k, d) => { try { return JSON.parse(sessionStorage.getItem(k)) ?? d; } catch { return d; } };
const set = (k, v) => sessionStorage.setItem(k, JSON.stringify(v));
const money = (n) => "$" + n.toFixed(2);
const $ = (s) => document.querySelector(s);

if (page !== "login" && !get("user", null)) location.replace("index.html");

function renderHeader() {
  const h = $("#header");
  if (!h) return;
  const n = get("cart", []).length;
  h.innerHTML = `
    <button id="menu-btn">Open Menu</button>
    <nav id="menu" hidden><a href="index.html" id="logout">Logout</a></nav>
    <a href="cart.html" aria-label="Shopping Cart">${n ? `<span class="badge">${n}</span>` : ""}</a>`;
  $("#menu-btn").onclick = () => { $("#menu").hidden = false; };
  $("#logout").onclick = () => { sessionStorage.clear(); };
}

function showError(slot, msg) {
  $(slot).innerHTML = "";
  const el = document.createElement("h3");
  el.setAttribute("role", "alert");
  el.className = "error";
  el.textContent = msg;
  $(slot).appendChild(el);
}

if (page === "login") {
  $("#login-form").onsubmit = (e) => {
    e.preventDefault();
    const u = $("#user-name").value, p = $("#password").value;
    if (!u || !p) return showError("#error-slot", `Epic sadface: ${u ? "Password" : "Username"} is required`);
    if (USERS[u] !== p) return showError("#error-slot", "Epic sadface: Username and password do not match any user in this service");
    if (CFG.locked.includes(u)) return showError("#error-slot", "Epic sadface: Sorry, this user has been locked out.");
    set("user", u); set("cart", []);
    location.href = "inventory.html";
  };
}

if (page === "inventory") {
  const draw = (order) => {
    const cart = get("cart", []);
    const list = [...PRODUCTS];
    if (order === "za") list.sort((a, b) => b.name.localeCompare(a.name));
    else if (order === "lohi") list.sort((a, b) => a.price - b.price);
    else if (order === "hilo") list.sort((a, b) => b.price - a.price);
    else list.sort((a, b) => a.name.localeCompare(b.name));
    $("#inventory").innerHTML = list.map((p) => {
      const inCart = cart.includes(p.id);
      return `<div class="inventory_item"><h2>${p.name}</h2><div class="price">${money(p.price)}</div>
        <button data-id="${p.id}" aria-label="${inCart ? "Remove" : "Add to cart"} ${p.name}">${inCart ? "Remove" : "Add to cart"}</button></div>`;
    }).join("");
    $("#inventory").querySelectorAll("button").forEach((b) => b.onclick = () => {
      const c = get("cart", []), id = b.dataset.id;
      set("cart", c.includes(id) ? c.filter((x) => x !== id) : [...c, id]);
      renderHeader(); draw($("#sort").value);
    });
  };
  $("#sort").onchange = () => draw($("#sort").value);
  draw("az");
}

if (page === "cart") {
  const draw = () => {
    const items = PRODUCTS.filter((p) => get("cart", []).includes(p.id));
    $("#cart-items").innerHTML = items.map((p) =>
      `<div class="cart_item"><span>${p.name}</span> <span>${money(p.price)}</span>
       <button data-id="${p.id}" aria-label="Remove ${p.name}">Remove</button></div>`).join("");
    $("#cart-items").querySelectorAll("button").forEach((b) => b.onclick = () => {
      set("cart", get("cart", []).filter((x) => x !== b.dataset.id)); renderHeader(); draw();
    });
  };
  draw();
  $("#continue-shopping").onclick = () => { location.href = "inventory.html"; };
  $("#checkout").onclick = () => { location.href = "checkout-step-one.html"; };
}

if (page === "checkout-one") {
  $("#info-form").onsubmit = (e) => {
    e.preventDefault();
    const f = $("#first-name").value, l = $("#last-name").value, z = $("#postal-code").value;
    if (!f) return showError("#error-slot", "Error: First Name is required");
    if (!l) return showError("#error-slot", "Error: Last Name is required");
    if (!z) return showError("#error-slot", "Error: Postal Code is required");
    location.href = "checkout-step-two.html";
  };
}

if (page === "checkout-two") {
  const items = PRODUCTS.filter((p) => get("cart", []).includes(p.id));
  const total = items.reduce((s, p) => s + p.price, 0);
  const tax = Math.round(total * 0.08 * 100) / 100;
  $("#overview").innerHTML = items.map((p) => `<div>${p.name} ${money(p.price)}</div>`).join("") +
    `<div>Item total: ${money(total)}</div><div>Tax: ${money(tax)}</div><div>Total: ${money(total + tax)}</div>`;
  $("#finish").onclick = () => { set("cart", []); location.href = "checkout-complete.html"; };
}

renderHeader();
