import "./admin.css";
import { supabase } from "../lib/supabase";
import { renderHighlights } from "../lib/parseHighlights";
import type { TickerItem } from "../shared/types";
import {
  formatHoldLabel,
  presetFromSeconds,
  secondsFromPreset,
} from "../shared/types";
import type { Session } from "@supabase/supabase-js";

const app = document.getElementById("app")!;

let session: Session | null = null;
let items: TickerItem[] = [];
let showAddForm = false;
let draggedId: string | null = null;

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

async function addItem(text: string, hold_seconds: number): Promise<void> {
  const maxOrder = items.length > 0 ? Math.max(...items.map((i) => i.sort_order)) + 1 : 0;

  const { error } = await supabase.from("ticker_items").insert({
    text,
    sort_order: maxOrder,
    active: true,
    hold_seconds,
  });

  if (error) {
    alert(`Failed to add item: ${error.message}`);
    return;
  }

  await loadItems();
  showAddForm = false;
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

async function reorderItems(fromIndex: number, toIndex: number): Promise<void> {
  if (fromIndex === toIndex) return;

  const reordered = [...items];
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved);

  const updates = reordered.map((item, index) =>
    supabase.from("ticker_items").update({ sort_order: index }).eq("id", item.id)
  );

  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    alert(`Failed to reorder: ${failed.error.message}`);
    return;
  }

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

function renderHoldSelect(id: string, selectedSeconds?: number): string {
  const selected = presetFromSeconds(selectedSeconds);
  return `
    <select id="${id}" class="hold-select">
      <option value="default" ${selected === "default" ? "selected" : ""}>Default (5s)</option>
      <option value="extended" ${selected === "extended" ? "selected" : ""}>Extended (10s)</option>
      <option value="super" ${selected === "super" ? "selected" : ""}>Super (15s)</option>
    </select>
  `;
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

    <section class="items-section">
      <div class="section-header">
        <h2>Ticker Items (${items.length})</h2>
        ${showAddForm ? "" : '<button type="button" id="show-add-btn" class="btn btn--success">Add Item</button>'}
      </div>

      <section class="add-form" id="add-form-section" ${showAddForm ? "" : "hidden"}>
        <h2>Add Ticker Item</h2>
        <form id="add-form">
          <div class="form-group">
            <label for="new-text">Text</label>
            <textarea id="new-text" placeholder="**!livery** in chat for the newest i20 Livery" required></textarea>
            <p class="syntax-help">
              Markdown-style highlights:
              <code>**color accent**</code> &nbsp;
              <code>*bold*</code> &nbsp;
              <code>'italic'</code>
            </p>
            <div class="preview-box" id="add-preview"></div>
          </div>
          <div class="form-group">
            <label for="new-hold">Display time</label>
            ${renderHoldSelect("new-hold")}
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn--primary">Save Item</button>
            <button type="button" id="cancel-add-btn" class="btn btn--ghost">Cancel</button>
          </div>
        </form>
      </section>

      ${items.length === 0 && !showAddForm ? '<div class="empty-state">No items yet. Click Add Item to create your first ticker message.</div>' : ""}
      <ul class="item-list" id="item-list">
        ${items.map((item, index) => renderItemCard(item, index)).join("")}
      </ul>

      <p class="syntax-help syntax-help--footer">
        Markdown-style highlights:
        <code>**color accent**</code> &nbsp;
        <code>*bold*</code> &nbsp;
        <code>'italic'</code>
      </p>
    </section>
  `;

  document.getElementById("logout-btn")!.addEventListener("click", handleLogout);

  const showAddBtn = document.getElementById("show-add-btn");
  if (showAddBtn) {
    showAddBtn.addEventListener("click", () => {
      showAddForm = true;
      renderDashboard();
      (document.getElementById("new-text") as HTMLTextAreaElement | null)?.focus();
    });
  }

  const cancelAddBtn = document.getElementById("cancel-add-btn");
  if (cancelAddBtn) {
    cancelAddBtn.addEventListener("click", () => {
      showAddForm = false;
      renderDashboard();
    });
  }

  const addForm = document.getElementById("add-form");
  if (addForm) {
    const newTextEl = document.getElementById("new-text") as HTMLTextAreaElement;
    const addPreviewEl = document.getElementById("add-preview")!;

    newTextEl.addEventListener("input", () => {
      addPreviewEl.innerHTML = newTextEl.value
        ? `<span class="ticker-preview-text">${renderHighlights(newTextEl.value)}</span>`
        : '<span class="preview-placeholder">Preview appears here…</span>';
    });

    addForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = newTextEl.value.trim();
      if (!text) return;
      const holdSelect = document.getElementById("new-hold") as HTMLSelectElement;
      const hold_seconds = secondsFromPreset(holdSelect.value);
      await addItem(text, hold_seconds);
    });
  }

  bindItemEvents();
  bindDragReorder();
}

function renderItemCard(item: TickerItem, index: number): string {
  return `
    <li class="item-card ${item.active ? "" : "item-card--inactive"}" data-id="${item.id}">
      <div class="item-card__drag-handle" draggable="true" title="Drag to reorder" aria-label="Drag to reorder">⠿</div>
      <div class="item-card__slot">${index + 1}</div>
      <div class="item-card__body">
        <div class="item-card__preview">
          <div class="ticker-preview-text" id="text-${item.id}">${renderHighlights(item.text)}</div>
        </div>
        <div class="item-card__meta">Display: ${formatHoldLabel(item.hold_seconds)} · ${item.active ? "Active" : "Inactive"}</div>
      </div>
      <div class="item-card__actions">
        <label class="toggle toggle--active">
          <input type="checkbox" class="toggle-active" ${item.active ? "checked" : ""} />
          <span>Active</span>
        </label>
        <div class="item-card__action-buttons">
          <button type="button" class="btn btn--secondary btn--sm edit-btn">Edit</button>
          <button type="button" class="btn btn--danger btn--sm delete-btn">Delete</button>
        </div>
      </div>
    </li>
  `;
}

function bindItemEvents(): void {
  document.querySelectorAll(".item-card").forEach((card) => {
    const id = (card as HTMLElement).dataset.id!;

    card.querySelector(".delete-btn")!.addEventListener("click", () => deleteItem(id));

    card.querySelector(".toggle-active")!.addEventListener("change", (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      updateItem(id, { active: checked });
    });

    card.querySelector(".edit-btn")!.addEventListener("click", () => startEdit(id));
  });
}

function bindDragReorder(): void {
  document.querySelectorAll(".item-card__drag-handle").forEach((handle) => {
    handle.addEventListener("dragstart", (e) => {
      const card = handle.closest(".item-card") as HTMLElement;
      draggedId = card.dataset.id!;
      card.classList.add("item-card--dragging");
      if (e instanceof DragEvent && e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
      }
    });

    handle.addEventListener("dragend", () => {
      draggedId = null;
      document
        .querySelectorAll(".item-card--dragging, .item-card--drag-over")
        .forEach((el) => el.classList.remove("item-card--dragging", "item-card--drag-over"));
    });
  });

  document.querySelectorAll(".item-card").forEach((card) => {
    const el = card as HTMLElement;

    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (draggedId && el.dataset.id !== draggedId) {
        el.classList.add("item-card--drag-over");
      }
    });

    el.addEventListener("dragleave", () => {
      el.classList.remove("item-card--drag-over");
    });

    el.addEventListener("drop", async (e) => {
      e.preventDefault();
      el.classList.remove("item-card--drag-over");
      if (!draggedId || el.dataset.id === draggedId) return;

      const fromIndex = items.findIndex((i) => i.id === draggedId);
      const toIndex = items.findIndex((i) => i.id === el.dataset.id);
      if (fromIndex === -1 || toIndex === -1) return;

      await reorderItems(fromIndex, toIndex);
    });
  });
}

function startEdit(id: string): void {
  const item = items.find((i) => i.id === id);
  if (!item) return;

  const textEl = document.getElementById(`text-${id}`)!;
  const card = textEl.closest(".item-card")!;
  const previewWrap = textEl.closest(".item-card__preview")!;

  card.querySelector(".item-card__actions")!.innerHTML = `
    <div class="item-card__action-buttons item-card__action-buttons--edit">
      <button type="button" class="btn btn--primary btn--sm save-edit">Save</button>
      <button type="button" class="btn btn--ghost btn--sm cancel-edit">Cancel</button>
    </div>
  `;

  const textarea = document.createElement("textarea");
  textarea.className = "item-card__edit";
  textarea.value = item.text;

  const holdLabel = document.createElement("label");
  holdLabel.className = "item-card__hold-label";
  holdLabel.textContent = "Display time";

  const holdSelect = document.createElement("select");
  holdSelect.className = "item-card__hold";
  holdSelect.innerHTML = `
    <option value="default">Default (5s)</option>
    <option value="extended">Extended (10s)</option>
    <option value="super">Super (15s)</option>
  `;
  holdSelect.value = presetFromSeconds(item.hold_seconds);

  const editFields = document.createElement("div");
  editFields.className = "item-card__edit-fields";
  editFields.append(textarea, holdLabel, holdSelect);

  previewWrap.replaceWith(editFields);
  textarea.focus();

  card.querySelector(".save-edit")!.addEventListener("click", async () => {
    const newText = textarea.value.trim();
    const hold_seconds = secondsFromPreset(holdSelect.value);
    if (newText) {
      await updateItem(id, { text: newText, hold_seconds });
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
