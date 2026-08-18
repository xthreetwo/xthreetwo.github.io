import "./admin.css";
import { supabase } from "../lib/supabase";
import { renderHighlights } from "../lib/parseHighlights";
import type { TickerItem } from "../shared/types";
import type { Session } from "@supabase/supabase-js";

const app = document.getElementById("app")!;

let session: Session | null = null;
let items: TickerItem[] = [];

// --- Auth ---

async function init(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  session = data.session;
  render();

  supabase.auth.onAuthStateChange((_event, newSession) => {
    session = newSession;
    if (newSession) {
      loadItems();
    }
    render();
  });

  if (session) {
    await loadItems();
    render();
  }
}

function renderLogin(): void {
  app.innerHTML = `
    <div class="auth-card">
      <h1>Ticker Admin</h1>
      <p>Sign in to manage your stream ticker items.</p>
      <div id="auth-error"></div>
      <form id="login-form">
        <div class="form-group">
          <label for="email">Email</label>
          <input type="email" id="email" required autocomplete="email" />
        </div>
        <div class="form-group">
          <label for="password">Password</label>
          <input type="password" id="password" required autocomplete="current-password" />
        </div>
        <button type="submit" class="btn btn--primary" style="width:100%;margin-top:0.5rem">
          Sign In
        </button>
      </form>
    </div>
  `;

  document.getElementById("login-form")!.addEventListener("submit", handleLogin);
}

async function handleLogin(e: Event): Promise<void> {
  e.preventDefault();
  const email = (document.getElementById("email") as HTMLInputElement).value;
  const password = (document.getElementById("password") as HTMLInputElement).value;
  const errorEl = document.getElementById("auth-error")!;

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    errorEl.innerHTML = `<div class="alert alert--error">${escapeHtml(error.message)}</div>`;
  }
}

async function handleLogout(): Promise<void> {
  await supabase.auth.signOut();
}

// --- Data ---

async function loadItems(): Promise<void> {
  const { data, error } = await supabase
    .from("ticker_items")
    .select("*")
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("Failed to load items:", error.message);
    return;
  }

  items = data ?? [];
}

async function addItem(text: string): Promise<void> {
  const maxOrder = items.length > 0 ? Math.max(...items.map((i) => i.sort_order)) + 1 : 0;

  const { error } = await supabase.from("ticker_items").insert({
    text,
    sort_order: maxOrder,
    active: true,
  });

  if (error) {
    alert(`Failed to add item: ${error.message}`);
    return;
  }

  await loadItems();
  renderDashboard();
}

async function updateItem(id: string, updates: Partial<TickerItem>): Promise<void> {
  const { error } = await supabase.from("ticker_items").update(updates).eq("id", id);

  if (error) {
    alert(`Failed to update item: ${error.message}`);
    return;
  }

  await loadItems();
  renderDashboard();
}

async function deleteItem(id: string): Promise<void> {
  if (!confirm("Delete this ticker item?")) return;

  const { error } = await supabase.from("ticker_items").delete().eq("id", id);

  if (error) {
    alert(`Failed to delete item: ${error.message}`);
    return;
  }

  await loadItems();
  renderDashboard();
}

async function moveItem(id: string, direction: "up" | "down"): Promise<void> {
  const index = items.findIndex((i) => i.id === id);
  if (index === -1) return;

  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= items.length) return;

  const current = items[index];
  const swap = items[swapIndex];

  await Promise.all([
    supabase.from("ticker_items").update({ sort_order: swap.sort_order }).eq("id", current.id),
    supabase.from("ticker_items").update({ sort_order: current.sort_order }).eq("id", swap.id),
  ]);

  await loadItems();
  renderDashboard();
}

// --- Render ---

function render(): void {
  if (!session) {
    renderLogin();
  } else {
    renderDashboard();
  }
}

function renderDashboard(): void {
  app.innerHTML = `
    <header class="admin-header">
      <h1>Ticker Admin</h1>
      <div class="admin-header__actions">
        <a href="/overlay.html" target="_blank" class="btn btn--secondary">Preview Overlay</a>
        <button id="logout-btn" class="btn btn--ghost">Sign Out</button>
      </div>
    </header>

    <section class="add-form">
      <h2>Add Ticker Item</h2>
      <form id="add-form">
        <div class="form-group">
          <label for="new-text">Text</label>
          <textarea id="new-text" placeholder="{accent}BREAKING{/accent} Your message here..." required></textarea>
          <p class="syntax-help">
            Highlight tags:
            <code>{accent}text{/accent}</code> gold accent &nbsp;
            <code>{bold}text{/bold}</code> bold
          </p>
          <div class="preview-box" id="add-preview"></div>
        </div>
        <button type="submit" class="btn btn--primary">Add Item</button>
      </form>
    </section>

    <section>
      <h2 style="font-size:1rem;margin-bottom:1rem">Ticker Items (${items.length})</h2>
      ${items.length === 0 ? '<div class="empty-state">No items yet. Add your first ticker message above.</div>' : ""}
      <ul class="item-list" id="item-list">
        ${items.map(renderItemCard).join("")}
      </ul>
    </section>
  `;

  document.getElementById("logout-btn")!.addEventListener("click", handleLogout);

  const addForm = document.getElementById("add-form")!;
  const newTextEl = document.getElementById("new-text") as HTMLTextAreaElement;
  const addPreviewEl = document.getElementById("add-preview")!;

  newTextEl.addEventListener("input", () => {
    addPreviewEl.innerHTML = newTextEl.value
      ? renderHighlights(newTextEl.value)
      : '<span style="color:var(--admin-muted)">Preview appears here...</span>';
  });

  addForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = newTextEl.value.trim();
    if (!text) return;
    await addItem(text);
    newTextEl.value = "";
    addPreviewEl.innerHTML = '<span style="color:var(--admin-muted)">Preview appears here...</span>';
  });

  bindItemEvents();
}

function renderItemCard(item: TickerItem): string {
  return `
    <li class="item-card ${item.active ? "" : "item-card--inactive"}" data-id="${item.id}">
      <div class="item-card__order">
        <button class="btn btn--ghost btn--icon move-up" title="Move up">↑</button>
        <button class="btn btn--ghost btn--icon move-down" title="Move down">↓</button>
      </div>
      <div class="item-card__body">
        <div class="item-card__text" id="text-${item.id}">${renderHighlights(item.text)}</div>
        <div class="item-card__meta">Order: ${item.sort_order} · ${item.active ? "Active" : "Inactive"}</div>
      </div>
      <div class="item-card__actions">
        <label class="toggle">
          <input type="checkbox" class="toggle-active" ${item.active ? "checked" : ""} />
          Active
        </label>
        <button class="btn btn--secondary edit-btn" style="font-size:0.8rem;padding:0.35rem 0.6rem">Edit</button>
        <button class="btn btn--danger delete-btn">Delete</button>
      </div>
    </li>
  `;
}

function bindItemEvents(): void {
  document.querySelectorAll(".item-card").forEach((card) => {
    const id = (card as HTMLElement).dataset.id!;

    card.querySelector(".move-up")!.addEventListener("click", () => moveItem(id, "up"));
    card.querySelector(".move-down")!.addEventListener("click", () => moveItem(id, "down"));
    card.querySelector(".delete-btn")!.addEventListener("click", () => deleteItem(id));

    card.querySelector(".toggle-active")!.addEventListener("change", (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      updateItem(id, { active: checked });
    });

    card.querySelector(".edit-btn")!.addEventListener("click", () => startEdit(id));
  });
}

function startEdit(id: string): void {
  const item = items.find((i) => i.id === id);
  if (!item) return;

  const textEl = document.getElementById(`text-${id}`)!;
  const card = textEl.closest(".item-card")!;

  card.querySelector(".item-card__actions")!.innerHTML = `
    <button class="btn btn--primary save-edit" style="font-size:0.8rem;padding:0.35rem 0.6rem">Save</button>
    <button class="btn btn--ghost cancel-edit" style="font-size:0.8rem">Cancel</button>
  `;

  const textarea = document.createElement("textarea");
  textarea.className = "item-card__edit";
  textarea.value = item.text;
  textEl.replaceWith(textarea);
  textarea.focus();

  card.querySelector(".save-edit")!.addEventListener("click", async () => {
    const newText = textarea.value.trim();
    if (newText) {
      await updateItem(id, { text: newText });
    } else {
      renderDashboard();
    }
  });

  card.querySelector(".cancel-edit")!.addEventListener("click", () => renderDashboard());
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

init();
