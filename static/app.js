// app.js — обновлённый фронтенд Mini APS (полный файл с API)
// Положите этот файл в /static/app.js

/* ===== CONFIGURATION ===== */
const API_URL = "/api/requests";
const DEPARTMENTS_URL = "/api/departments";
const EQUIPMENT_URL = "/api/equipment";

const MAX_PHOTO_SIZE = 500 * 1024; // 500 KB
const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 5000;

/* ===== UTILITIES ===== */
function nowISO() { return new Date().toISOString(); }
function genId() { 
  return 'xxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
function escapeHtml(s) { 
  return String(s || "").replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); 
}
function escapeAttr(s) { 
  return String(s || "").replace(/"/g, '&quot;'); 
}
function truncate(s, n) { 
  return s.length > n ? s.slice(0, n - 1) + "…" : s; 
}
function formatDate(iso) { 
  try { 
    return new Date(iso).toLocaleString('ru-RU'); 
  } catch { 
    return iso; 
  } 
}
function debounce(fn, t = 200) { 
  let to; 
  return (...a) => { 
    clearTimeout(to); 
    to = setTimeout(() => fn(...a), t); 
  }; 
}

/* ===== TOAST HELPER ===== */
function toast(msg, { ttl = 2500 } = {}) {
  const c = document.getElementById("toasts");
  if (!c) return;
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => {
    el.style.opacity = 0;
    setTimeout(() => el.remove(), 220);
  }, ttl);
}

/* ===== THEME MANAGEMENT ===== */
function applyTheme(t) {
  if (t === "dark") document.documentElement.setAttribute("data-theme", "dark");
  else document.documentElement.removeAttribute("data-theme");
  localStorage.setItem("mini_theme", t);
}
(function () {
  const saved = localStorage.getItem("mini_theme") || 
    (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(saved);
})();

/* ===== API & QUEUE OPERATIONS ===== */
let queueCache = []; // локальный кеш очереди для быстрого доступа

async function readQueue() {
  try {
    const res = await fetch(API_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    queueCache = (data.requests || data || []);
    return queueCache;
  } catch (err) {
    console.error('Ошибка чтения очереди:', err);
    return queueCache; // возвращаем кеш в случае ошибки
  }
}

async function pushItem(payload) {
  try {
    const client_id = genId();
    const request = {
      client_id,
      created_at: nowISO(),
      status: "pending",
      attempts: 0,
      last_error: "",
      ...payload
    };
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [request] })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    toast("Заявка добавлена");
    await readQueue(); // обновляем кеш
    renderAll();
    return client_id;
  } catch (err) {
    console.error('Ошибка добавления заявки:', err);
    toast('Ошибка при добавлении заявки');
  }
}

async function removeByIds(ids) {
  try {
    const res = await fetch(`${API_URL}/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    toast('Заявки удалены');
    await readQueue();
    renderAll();
  } catch (err) {
    console.error('Ошибка удаления заявок:', err);
    toast('Ошибка удаления');
  }
}

async function updateItem(cid, patch) {
  try {
    const res = await fetch(`${API_URL}/${cid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    toast('Заявка обновлена');
    await readQueue();
    renderAll();
  } catch (err) {
    console.error('Ошибка обновления заявки:', err);
    toast('Ошибка обновления');
  }
}

async function fetchJSON(url) {
  const headers = {};
  if (window.MINI_APPS_API_KEY) headers["X-API-Key"] = window.MINI_APPS_API_KEY;
  const res = await fetch(url, { headers, credentials: "same-origin" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

async function fetchDepartments() {
  try {
    if (!navigator.onLine) throw new Error("offline");
    const j = await fetchJSON(DEPARTMENTS_URL);
    if (j && j.ok) {
      localStorage.setItem("dept_cache", JSON.stringify(j.departments || []));
      return j.departments || [];
    }
    return [];
  } catch (err) {
    const cached = localStorage.getItem("dept_cache");
    return cached ? JSON.parse(cached) : [];
  }
}

async function fetchEquipment(dept_id = null) {
  try {
    if (!navigator.onLine) throw new Error("offline");
    const url = dept_id ? `${EQUIPMENT_URL}?dept_id=${encodeURIComponent(dept_id)}` : EQUIPMENT_URL;
    const j = await fetchJSON(url);
    if (j && j.ok) {
      localStorage.setItem("equip_cache", JSON.stringify(j.equipment || []));
      return j.equipment || [];
    }
    return [];
  } catch (err) {
    const cached = localStorage.getItem("equip_cache");
    return cached ? JSON.parse(cached) : [];
  }
}

/* ===== IMAGE HANDLING ===== */
function fileToDataUrl(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej("read error");
    r.readAsDataURL(file);
  });
}

async function compressImage(file, maxBytes = MAX_PHOTO_SIZE) {
  if (file.size <= maxBytes) return await fileToDataUrl(file);
  return new Promise((res, rej) => {
    const reader = new FileReader();
    const img = new Image();
    reader.onload = () => img.src = reader.result;
    reader.onerror = () => rej("read error");
    img.onload = () => {
      const maxDim = 1200;
      let w = img.width, h = img.height;
      if (Math.max(w, h) > maxDim) {
        const ratio = maxDim / Math.max(w, h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      let quality = 0.92;
      function attempt() {
        canvas.toBlob(blob => {
          if (!blob) return rej("compress failed");
          if (blob.size <= maxBytes || quality < 0.45) {
            const fr = new FileReader();
            fr.onload = () => res(fr.result);
            fr.onerror = () => rej("read error");
            fr.readAsDataURL(blob);
          } else {
            quality -= 0.08;
            attempt();
          }
        }, "image/jpeg", quality);
      }
      attempt();
    };
    reader.readAsDataURL(file);
  });
}

/* ===== RENDERING ===== */
function renderCards() {
  const container = document.getElementById("cardsList");
  if (!container) return;
  container.innerHTML = "";
  const q = queueCache || [];
  const search = (document.getElementById("qSearch")?.value || "").toLowerCase();
  const statusFilter = document.getElementById("statusFilter")?.value || "";
  
  const shown = q.slice().reverse().filter(it => {
    if (statusFilter && it.status !== statusFilter) return false;
    if (search) {
      const v = `${it.payload?.model_name || ""} ${it.payload?.plate || ""}`.toLowerCase();
      return v.includes(search);
    }
    return true;
  });

  const qCount = document.getElementById("queueCount");
  if (qCount) qCount.textContent = q.length;

  if (shown.length === 0) {
    container.innerHTML = '<div class="small" style="padding:12px;color:var(--muted)">Нет заявок</div>';
    return;
  }

  shown.forEach(it => {
    const el = document.createElement("div");
    el.className = "req-card";
    const badge = `<div style="background:rgba(0,0,0,0.06);padding:6px 8px;border-radius:8px;font-size:12px">${it.status}</div>`;
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-weight:700">${escapeHtml(it.payload?.model_name || "—")}</div>
          <div class="muted" style="font-size:13px">${escapeHtml(it.payload?.plate || "—")} • ${formatDate(it.created_at)}</div>
        </div>
        <div style="text-align:right">${badge}</div>
      </div>
      <div style="margin-top:8px;font-size:13px;color:var(--muted)">${truncate(escapeHtml(it.payload?.description || ""), 160)}</div>
    `;
    
    if (it.payload?.photo_preview) {
      const img = document.createElement("img");
      img.src = it.payload.photo_preview;
      img.style.width = "100%";
      img.style.marginTop = "8px";
      img.style.borderRadius = "8px";
      img.alt = "photo";
      img.onclick = () => openModalPhoto(it.payload.photo_preview);
      el.appendChild(img);
    }

    const ctr = document.createElement("div");
    ctr.className = "controls";
    
    const b1 = document.createElement("button");
    b1.className = "btn btn-ghost";
    b1.textContent = "Повторить";
    b1.onclick = () => {
      updateItem(it.client_id, { status: "pending", attempts: 0, last_error: "" });
    };

    const b2 = document.createElement("button");
    b2.className = "btn btn-ghost";
    b2.textContent = "Редакт.";
    b2.onclick = () => openEditModal(it.client_id);

    const b3 = document.createElement("button");
    b3.className = "btn btn-ghost";
    b3.textContent = "Удалить";
    b3.onclick = () => {
      if (confirm("Удалить заявку?")) {
        removeByIds([it.client_id]);
      }
    };

    ctr.appendChild(b1);
    ctr.appendChild(b2);
    ctr.appendChild(b3);
    el.appendChild(ctr);
    container.appendChild(el);
  });
}

function renderAll() {
  renderCards();
}

/* ===== MODAL HELPERS ===== */
function openModalPhoto(dataUrl) {
  const mb = document.getElementById("modalBackdrop");
  const mc = document.getElementById("modalContent");
  if (!mb || !mc) return;
  mc.innerHTML = `<div style="text-align:center"><img src="${escapeAttr(dataUrl)}" style="max-width:100%;height:auto;border-radius:8px" /></div>
                  <div style="display:flex;justify-content:flex-end;margin-top:12px"><button id="closeModal" class="btn btn-ghost">Закрыть</button></div>`;
  mb.style.display = "flex";
  document.getElementById("closeModal").onclick = () => {
    mb.style.display = "none";
    mc.innerHTML = "";
  };
}

function openEditModal(clientId) {
  const item = queueCache.find(it => it.client_id === clientId);
  if (!item) return;
  const modal = document.getElementById("editModal");
  const content = document.getElementById("editModalContent");
  if (!modal || !content) return;

  content.innerHTML = `
    <h3>Редактирование заявки</h3>
    <form id="editForm">
      <input type="hidden" id="edit_client_id" value="${escapeAttr(clientId)}" />
      <div class="form-group">
        <label>Модель</label>
        <input type="text" id="edit_model" value="${escapeAttr(item.payload?.model_name || '')}" />
      </div>
      <div class="form-group">
        <label>Номер</label>
        <input type="text" id="edit_plate" value="${escapeAttr(item.payload?.plate || '')}" />
      </div>
      <div class="form-group">
        <label>Описание</label>
        <textarea id="edit_desc">${escapeHtml(item.payload?.description || '')}</textarea>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
        <button type="button" class="btn btn-ghost" onclick="document.getElementById('editModal').style.display='none'">Отмена</button>
        <button type="submit" class="btn btn-primary">Сохранить</button>
      </div>
    </form>
  `;
  modal.style.display = "flex";
  document.getElementById("editForm").onsubmit = async (e) => {
    e.preventDefault();
    const patch = {
      payload: {
        ...item.payload,
        model_name: document.getElementById("edit_model").value,
        plate: document.getElementById("edit_plate").value,
        description: document.getElementById("edit_desc").value
      }
    };
    await updateItem(clientId, patch);
    modal.style.display = "none";
  };
}

/* ===== EQUIPMENT MODAL ===== */
async function showEquipmentModal(equipmentList, departments) {
  const modal = document.getElementById("equipmentModal");
  const content = document.getElementById("equipmentModalContent");
  if (!modal || !content) return;

  const skeletonRows = 6;
  content.innerHTML = `
    <h3>Выбор техники</h3>
    <div style="display:flex;gap:8px;margin:12px 0;">
      <select id="deptSelect"><option value="">Все подразделения</option></select>
      <input id="equipSearch" placeholder="Поиск: модель или номер" style="flex:1;padding:8px;border-radius:8px;border:1px solid rgba(0,0,0,0.06)"/>
      <button id="equipRefresh" class="btn btn-ghost">Обновить</button>
    </div>
    <div id="equipList" style="max-height:60vh;overflow:auto">
      ${Array.from({ length: skeletonRows }).map(() => 
        '<div style="display:flex;gap:12px;align-items:center;padding:8px 0"><div style="width:24%"><div class="skeleton" style="width:100%;height:14px"></div></div><div style="width:36%"><div class="skeleton" style="width:90%;height:14px"></div></div><div style="width:20%"><div class="skeleton" style="width:70%;height:14px"></div></div><div style="width:10%"><div class="skeleton" style="width:50%;height:14px"></div></div></div>'
      ).join("")}
    </div>
    <div style="display:flex;justify-content:flex-end;margin-top:12px"><button id="closeEquip" class="btn btn-ghost">Закрыть</button></div>
  `;
  modal.style.display = "flex";

  const deptSelect = content.querySelector("#deptSelect");
  (departments || []).forEach(d => {
    const o = document.createElement("option");
    o.value = d.dept_id;
    o.textContent = d.name;
    deptSelect.appendChild(o);
  });

  let currentList = equipmentList || [];

  function render(filter = "") {
    const wrap = content.querySelector("#equipList");
    wrap.innerHTML = "";
    const filtered = currentList.filter(e => {
      if (!filter) return true;
      const f = filter.toLowerCase();
      return (`${e.model || ""} ${e.name || ""} ${e.plate || ""}`).toLowerCase().includes(f);
    });
    if (!filtered.length) {
      wrap.innerHTML = '<div class="small muted">Ничего не найдено</div>';
      return;
    }
    filtered.forEach(e => {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.gap = "12px";
      row.style.alignItems = "center";
      row.style.padding = "8px 0";
      row.innerHTML = `<div style="width:24%"><strong>${escapeHtml(e.model || "")}</strong></div><div style="width:36%">${escapeHtml(e.name || "")}</div><div style="width:20%">${escapeHtml(e.plate || "")}</div><div style="width:10%">${escapeHtml(e.year || "")}</div>`;
      const btn = document.createElement("button");
      btn.className = "btn btn-ghost";
      btn.textContent = "Выбрать";
      btn.onclick = () => {
        document.getElementById("model_name").value = (e.model || "") + (e.name ? ` (${e.name})` : "");
        document.getElementById("plate").value = e.plate || "";
        const y = document.getElementById("year");
        if (y) y.value = e.year || "";
        let hidden = document.getElementById("selected_eq_id");
        if (!hidden) {
          hidden = document.createElement("input");
          hidden.type = "hidden";
          hidden.id = "selected_eq_id";
          hidden.name = "selected_eq_id";
          document.getElementById("form").appendChild(hidden);
        }
        hidden.value = e.eq_id;
        modal.style.display = "none";
        toast("Техника выбрана");
      };
      row.appendChild(btn);
      wrap.appendChild(row);
    });
  }

  content.querySelector("#equipSearch").addEventListener("input", e => render(e.target.value));
  content.querySelector("#equipRefresh").addEventListener("click", async () => {
    const deptId = deptSelect.value || null;
    currentList = await fetchEquipment(deptId);
    render("");
    toast("Список обновлён");
  });
  deptSelect.addEventListener("change", async () => {
    const d = deptSelect.value || null;
    currentList = await fetchEquipment(d);
    render("");
  });
  content.querySelector("#closeEquip").addEventListener("click", () => {
    modal.style.display = "none";
  });
  render("");
}

/* ===== SYNC FUNCTION ===== */
async function syncNow() {
  try {
    const q = queueCache;
    if (!q || q.length === 0) {
      toast("Очередь пуста");
      return;
    }

    // Обновляем статус на "syncing"
    q.forEach(it => {
      updateItem(it.client_id, { status: "syncing", attempts: (it.attempts || 0) + 1 });
    });

    const payload = {
      requests: q.map(it => ({
        ...it.payload,
        client_id: it.client_id,
        req_id: it.payload.req_id || null
      }))
    };

    const headers = { "Content-Type": "application/json" };
    if (window.MINI_APPS_API_KEY) headers["X-API-Key"] = window.MINI_APPS_API_KEY;

    const res = await fetch(API_URL, {
      method: "POST",
      headers,
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error("HTTP " + res.status);

    const j = await res.json();
    if (!j || !Array.isArray(j.results)) {
      throw new Error("Invalid response from server");
    }

    // Обработка результатов
    const removed = [];
    j.results.forEach(r => {
      if (r && r.ok) {
        removed.push(r.client_id);
      } else if (r) {
        updateItem(r.client_id, { status: "error", last_error: r.error || "server error" });
      }
    });

    if (removed.length) removeByIds(removed);
    toast("Синхронизация завершена");
    await readQueue();
    renderAll();
  } catch (err) {
    console.error("syncNow error:", err);
    const q = queueCache || [];
    q.forEach(it => updateItem(it.client_id, { status: "error", last_error: String(err) }));
    toast("Ошибка синхронизации");
  }
}

/* ===== DOM READY ===== */
document.addEventListener("DOMContentLoaded", async () => {
  // Загружаем очередь при загрузке
  await readQueue();
  renderAll();

  // Theme toggle
  const themeToggle = document.getElementById("themeToggle");
  if (themeToggle) {
    themeToggle.onclick = () => {
      const cur = localStorage.getItem("mini_theme") || "light";
      applyTheme(cur === "dark" ? "light" : "dark");
    };
  }

  // Equipment selection
  const chooseBtn = document.getElementById("chooseEquipmentBtn");
  if (chooseBtn) {
    chooseBtn.onclick = async () => {
      showEquipmentModal([], []);
      try {
        const deps = await fetchDepartments();
        const eqs = await fetchEquipment();
        showEquipmentModal(eqs, deps);
      } catch (e) {
        console.error(e);
        toast("Не удалось загрузить список техники");
      }
    };
  }

  // Form submission
  const form = document.getElementById("form");
  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const model_name = document.getElementById("model_name").value.trim();
      const plate = document.getElementById("plate").value.trim();
      if (!model_name || !plate) {
        toast("Заполните модель и номер");
        return;
      }
      let photo_preview = null;
      const fi = document.getElementById("photo");
      if (fi && fi.files && fi.files[0]) {
        const f = fi.files[0];
        photo_preview = await compressImage(f).catch(() => null);
      }
      const payload = {
        model_name,
        plate,
        year: document.getElementById("year")?.value.trim() || "",
        odometer: document.getElementById("odometer")?.value.trim() || "",
        description: document.getElementById("description")?.value.trim() || "",
        spare_parts: document.getElementById("spare_parts")?.value.trim() || "",
        phone: document.getElementById("phone")?.value.trim() || "",
        responsible_person: document.getElementById("responsible_person")?.value.trim() || "",
        photo_preview
      };
      const selected = document.getElementById("selected_eq_id");
      if (selected && selected.value) payload.eq_id = selected.value;
      await pushItem(payload);
      form.reset();
    };
  }

  // Sync button
  const syncBtn = document.getElementById("syncBtn");
  if (syncBtn) {
    syncBtn.onclick = () => syncNow();
  }

  // Filter and search
  document.getElementById("statusFilter")?.addEventListener("change", renderAll);
  document.getElementById("qSearch")?.addEventListener("input", debounce(renderAll, 240));

  // Online status
  window.addEventListener("online", () => {
    toast("Онлайн — начинаю синк");
    if (typeof syncNow === "function") syncNow();
  });
  window.addEventListener("offline", () => {
    toast("Офлайн");
  });

  // Auto-sync every 10 seconds when online
  setInterval(() => {
    if (navigator.onLine) syncNow();
  }, 10000);
});

/* ===== ONLINE INDICATOR ===== */
function setOnlineIndicator(v) {
  const txt = document.getElementById("statusText");
  if (txt) txt.textContent = v ? "online" : "offline";
}

// Initial status
setOnlineIndicator(navigator.onLine);
