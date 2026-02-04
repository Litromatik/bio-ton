// app.js — обновлённый фронтенд Mini APS (полный файл)
// Положите этот файл в /static/app.js

/* Configuration */
const API_URL = "/api/sync";
const DEPARTMENTS_URL = "/api/departments";
const EQUIPMENT_URL = "/api/equipment";

const QUEUE_KEY = "mini_queue_v4";
const EQUIP_CACHE_KEY = "equipment_cache_v1";
const DEPT_CACHE_KEY = "dept_cache_v1";

const MAX_PHOTO_SIZE = 500 * 1024; // 500 KB
const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 5000;

/* Utilities */
function nowISO(){ return new Date().toISOString(); }
function genId(){ return 'xxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c=>{ const r=Math.random()*16|0,v=c==='x'?r:(r&0x3|0x8); return v.toString(16); }); }

function readQueue(){ try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); } catch { return []; } }
function writeQueue(q){ localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); renderAll(); }

function escapeHtml(s){ return String(s||"").replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]); }
function escapeAttr(s){ return String(s||"").replace(/"/g,'&quot;'); }
function truncate(s, n){ return s.length>n? s.slice(0,n-1)+"…": s; }
function formatDate(iso){ try { return new Date(iso).toLocaleString(); } catch { return iso; } }

/* Toast helper */
function toast(msg, {ttl=2500}={}) {
  const c = document.getElementById("toasts");
  if(!c) return;
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(()=> { el.style.opacity = 0; setTimeout(()=> el.remove(), 220); }, ttl);
}

/* Mobile-friendly tap binding (keeps user-gesture) */
function bindTap(el, handler) {
  if (!el) return;
  let handled = false;
  function touchHandler(e) {
    try { e.preventDefault(); } catch (err) {}
    if (handled) return;
    handled = true;
    try { handler(e); } catch (err) { console.error(err); }
    setTimeout(()=> handled = false, 600);
  }
  function clickHandler(e) {
    if (handled) { e.preventDefault(); return; }
    try { handler(e); } catch (err) { console.error(err); }
  }
  el.addEventListener('touchend', touchHandler, {passive:false});
  el.addEventListener('pointerup', touchHandler, {passive:false});
  el.addEventListener('click', clickHandler);
}

/* Open link via Telegram WebApp if available */
function openLink(url){
  try {
    if (window.Telegram && window.Telegram.WebApp && typeof Telegram.WebApp.openLink === 'function') {
      Telegram.WebApp.openLink(url);
      return;
    }
  } catch(e){}
  window.open(url, '_blank', 'noopener');
}

/* Theme */
function applyTheme(t){
  if(t === "dark") document.documentElement.setAttribute("data-theme","dark");
  else document.documentElement.removeAttribute("data-theme");
  localStorage.setItem("mini_theme", t);
}
(function(){ const saved = localStorage.getItem("mini_theme") || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); applyTheme(saved); })();

/* Queue operations */
function pushItem(payload){
  const q = readQueue();
  const rec = { client_id: genId(), created_at: nowISO(), attempts: 0, next_try_ts: 0, status: "pending", last_error: "", payload };
  q.push(rec);
  writeQueue(q);
  toast("Добавлено в очередь");
  return rec.client_id;
}
function removeByIds(ids){ writeQueue(readQueue().filter(it => !ids.includes(it.client_id))); }
function updateItem(cid, patch){ const q = readQueue(); const i = q.findIndex(x=>x.client_id===cid); if(i===-1) return; q[i] = {...q[i], ...patch}; writeQueue(q); }

/* Image helpers */
function fileToDataUrl(file){ return new Promise((res, rej)=>{ const r = new FileReader(); r.onload = ()=> res(r.result); r.onerror = ()=> rej("read error"); r.readAsDataURL(file); }); }

async function compressImage(file, maxBytes = MAX_PHOTO_SIZE){
  if(file.size <= maxBytes) return await fileToDataUrl(file);
  return new Promise((res, rej)=>{
    const reader = new FileReader();
    const img = new Image();
    reader.onload = ()=> img.src = reader.result;
    reader.onerror = ()=> rej("read error");
    img.onload = ()=>{
      const maxDim = 1200;
      let w = img.width, h = img.height;
      if(Math.max(w,h) > maxDim){
        const ratio = maxDim / Math.max(w,h);
        w = Math.round(w * ratio); h = Math.round(h * ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      let quality = 0.92;
      function attempt(){
        canvas.toBlob(blob=>{
          if(!blob) return rej("compress failed");
          if(blob.size <= maxBytes || quality < 0.45){
            const fr = new FileReader();
            fr.onload = ()=> res(fr.result);
            fr.onerror = ()=> rej("read error");
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

/* Fetch helpers */
async function fetchJSON(url){
  const headers = {};
  if(window.MINI_APPS_API_KEY) headers["X-API-Key"] = window.MINI_APPS_API_KEY;
  const res = await fetch(url, { headers, credentials: "same-origin" });
  if(!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}
async function fetchDepartments(){
  try {
    if(!navigator.onLine) throw new Error("offline");
    const j = await fetchJSON(DEPARTMENTS_URL);
    if(j && j.ok){ localStorage.setItem(DEPT_CACHE_KEY, JSON.stringify(j.departments||[])); return j.departments || []; }
    return [];
  } catch {
    const cached = localStorage.getItem(DEPT_CACHE_KEY);
    return cached ? JSON.parse(cached) : [];
  }
}
async function fetchEquipment(dept_id = null){
  try {
    if(!navigator.onLine) throw new Error("offline");
    const url = dept_id ? `${EQUIPMENT_URL}?dept_id=${encodeURIComponent(dept_id)}` : EQUIPMENT_URL;
    const j = await fetchJSON(url);
    if(j && j.ok){ localStorage.setItem(EQUIP_CACHE_KEY, JSON.stringify(j.equipment||[])); return j.equipment || []; }
    return [];
  } catch {
    const cached = localStorage.getItem(EQUIP_CACHE_KEY);
    return cached ? JSON.parse(cached) : [];
  }
}

/* Rendering queue as cards */
function renderCards(){
  const container = document.getElementById("cardsList");
  if(!container) return;
  container.innerHTML = "";
  const q = readQueue();
  const search = (document.getElementById("qSearch")?.value || "").toLowerCase();
  const statusFilter = document.getElementById("statusFilter")?.value || "";
  const shown = q.slice().reverse().filter(it=>{
    if(statusFilter && it.status !== statusFilter) return false;
    if(search){
      const v = `${it.payload.model_name || ""} ${it.payload.plate || ""}`.toLowerCase();
      return v.includes(search);
    }
    return true;
  });

  document.getElementById("queueCount") && (document.getElementById("queueCount").textContent = q.length);

  if(shown.length === 0){
    container.innerHTML = `<div class="small" style="padding:12px;color:var(--muted)">Нет заявок</div>`;
    return;
  }

  shown.forEach(it=>{
    const el = document.createElement("div");
    el.className = "req-card";
    const badge = `<div style="background:rgba(0,0,0,0.06);padding:6px 8px;border-radius:8px;font-size:12px">${it.status}</div>`;
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-weight:700">${escapeHtml(it.payload.model_name || "—")}</div>
          <div class="muted" style="font-size:13px">${escapeHtml(it.payload.plate || "—")} • ${formatDate(it.created_at)}</div>
        </div>
        <div style="text-align:right">${badge}</div>
      </div>
      <div style="margin-top:8px;font-size:13px;color:var(--muted)">${truncate(escapeHtml(it.payload.description || ""), 160)}</div>
    `;
    if(it.payload.photo_preview){
      const img = document.createElement("img");
      img.src = it.payload.photo_preview;
      img.style.width = "100%";
      img.style.marginTop = "8px";
      img.style.borderRadius = "8px";
      img.alt = "photo";
      img.onclick = ()=> openModalPhoto(it.payload.photo_preview);
      el.appendChild(img);
    }
    const ctr = document.createElement("div");
    ctr.className = "controls";
    const b1 = document.createElement("button"); b1.className="btn btn-ghost"; b1.textContent = "Повторить"; b1.onclick = ()=> { updateItem(it.client_id, { next_try_ts: 0, status: "pending", last_error: "" }); syncNow(); };
    const b2 = document.createElement("button"); b2.className="btn btn-ghost"; b2.textContent = "Редакт."; b2.onclick = ()=> openEditModal(it.client_id);
    const b3 = document.createElement("button"); b3.className="btn btn-ghost"; b3.textContent = "Удалить"; b3.onclick = ()=> { if(confirm("Удалить локально?")){ removeByIds([it.client_id]); toast("Удалено"); } };
    ctr.appendChild(b1); ctr.appendChild(b2); ctr.appendChild(b3);
    el.appendChild(ctr);
    container.appendChild(el);
  });
}

/* Modal helpers */
function openModalPhoto(dataUrl){
  const mb = document.getElementById("modalBackdrop");
  const mc = document.getElementById("modalContent");
  if(!mb || !mc) return;
  mc.innerHTML = `<div style="text-align:center"><img src="${dataUrl}" style="max-width:100%;height:auto;border-radius:8px" /></div>
                  <div style="display:flex;justify-content:flex-end;margin-top:12px"><button id="closeModal" class="btn btn-ghost">Закрыть</button></div>`;
  mb.style.display = "flex";
  document.getElementById("closeModal").onclick = ()=> { mb.style.display = "none"; mc.innerHTML = ""; };
}

/* Equipment modal implementation (keeps same signature as earlier) */
async function showEquipmentModal(equipmentList, departments){
  const modal = document.getElementById("equipmentModal"), content = document.getElementById("equipmentModalContent");
  if(!modal || !content) return;
  const skeletonRows = 6;
  content.innerHTML = `<h3>Выбор техники</h3>
    <div style="display:flex;gap:8px;margin:12px 0;">
      <select id="deptSelect"><option value="">Все подразделения</option></select>
      <input id="equipSearch" placeholder="Поиск: модель или номер" style="flex:1;padding:8px;border-radius:8px;border:1px solid rgba(0,0,0,0.06)"/>
      <button id="equipRefresh" class="btn btn-ghost">Обновить</button>
    </div>
    <div id="equipList" style="max-height:60vh;overflow:auto">
      ${Array.from({length:skeletonRows}).map(()=>`<div style="display:flex;gap:12px;align-items:center;padding:8px 0"><div style="width:24%"><div class="skeleton" style="width:100%;height:14px"></div></div><div style="width:36%"><div class="skeleton" style="width:90%;height:14px"></div></div><div style="width:20%"><div class="skeleton" style="width:70%;height:14px"></div></div><div style="width:10%"><div class="skeleton" style="width:50%;height:14px"></div></div></div>`).join("")}
    </div>
    <div style="display:flex;justify-content:flex-end;margin-top:12px"><button id="closeEquip" class="btn btn-ghost">Закрыть</button></div>`;
  modal.style.display = "flex";

  const deptSelect = content.querySelector("#deptSelect");
  (departments || []).forEach(d => { const o = document.createElement("option"); o.value = d.dept_id; o.textContent = d.name; deptSelect.appendChild(o); });

  let currentList = equipmentList || [];

  function render(filter=""){
    const wrap = content.querySelector("#equipList");
    wrap.innerHTML = "";
    const filtered = currentList.filter(e => {
      if(!filter) return true;
      const f = filter.toLowerCase();
      return (`${e.model||""} ${e.name||""} ${e.plate||""}`).toLowerCase().includes(f);
    });
    if(!filtered.length){ wrap.innerHTML = `<div class="small muted">Ничего не найдено</div>`; return; }
    filtered.forEach(e => {
      const row = document.createElement("div");
      row.style.display = "flex"; row.style.gap = "12px"; row.style.alignItems = "center"; row.style.padding = "8px 0";
      row.innerHTML = `<div style="width:24%"><strong>${escapeHtml(e.model||"")}</strong></div><div style="width:36%">${escapeHtml(e.name||"")}</div><div style="width:20%">${escapeHtml(e.plate||"")}</div><div style="width:10%">${escapeHtml(e.year||"")}</div>`;
      const btn = document.createElement("button"); btn.className = "btn btn-ghost"; btn.textContent = "Выбрать";
      btn.onclick = ()=>{
        document.getElementById("model_name").value = (e.model || "") + (e.name ? ` (${e.name})` : "");
        document.getElementById("plate").value = e.plate || "";
        const y = document.getElementById("year"); if(y) y.value = e.year || "";
        let hidden = document.getElementById("selected_eq_id"); if(!hidden){ hidden = document.createElement("input"); hidden.type = "hidden"; hidden.id = "selected_eq_id"; hidden.name = "selected_eq_id"; document.getElementById("form").appendChild(hidden); }
        hidden.value = e.eq_id;
        modal.style.display = "none";
        toast("Техника выбрана");
      };
      row.appendChild(btn);
      wrap.appendChild(row);
    });
  }

  content.querySelector("#equipSearch").addEventListener("input", e => render(e.target.value));
  content.querySelector("#equipRefresh").addEventListener("click", async ()=>{ const deptId = deptSelect.value || null; currentList = await fetchEquipment(deptId); render(""); toast("Список обновлён"); });
  deptSelect.addEventListener("change", async ()=>{ const d = deptSelect.value || null; currentList = await fetchEquipment(d); render(""); });
  content.querySelector("#closeEquip").addEventListener("click", ()=> { modal.style.display = "none"; });
  render("");
}

/* UI wiring (mobile-safe where beneficial) */
document.addEventListener("DOMContentLoaded", ()=> {
  const themeToggle = document.getElementById("themeToggle");
  bindTap(themeToggle, ()=>{ const cur = localStorage.getItem("mini_theme") || "light"; applyTheme(cur === "dark" ? "light" : "dark"); });

  const chooseBtn = document.getElementById("chooseEquipmentBtn");
  bindTap(chooseBtn, async ()=>{
    // open skeleton quickly to preserve user gesture
    showEquipmentModal([], []);
    try { const deps = await fetchDepartments(); const eqs = await fetchEquipment(); showEquipmentModal(eqs, deps); } catch(e){ console.error(e); toast("Не удалось загрузить список техники"); }
  });

  document.getElementById("form")?.addEventListener("submit", async e=>{
    e.preventDefault();
    const model_name = document.getElementById("model_name").value.trim();
    const plate = document.getElementById("plate").value.trim();
    if(!model_name || !plate){ toast("Заполните модель и номер"); return; }
    let photo_preview = null;
    const fi = document.getElementById("photo");
    if(fi && fi.files && fi.files[0]){
      const f = fi.files[0];
      photo_preview = await compressImage(f).catch(()=>null);
    }
    const payload = { model_name, plate, year: document.getElementById("year").value.trim(), odometer: document.getElementById("odometer").value.trim(), description: document.getElementById("description").value.trim(), spare_parts: document.getElementById("spare_parts").value.trim(), phone: document.getElementById("phone").value.trim(), responsible_person: document.getElementById("responsible_person").value.trim(), photo_preview };
    const selected = document.getElementById("selected_eq_id"); if(selected && selected.value) payload.eq_id = selected.value;
    pushItem(payload);
    document.getElementById("form").reset();
    renderAll();
  });

  // safe sync button binding: wrapper checks for function existence
  const syncBtnEl = document.getElementById("syncBtn");
  bindTap(syncBtnEl, ()=>{ if(typeof syncNow === "function") syncNow(); else toast("Синхронизация недоступна"); });

  bindTap(document.getElementById("clearBtn"), ()=>{ if(confirm("Очистить очередь локально?")){ localStorage.removeItem(QUEUE_KEY); renderAll(); toast("Очередь очищена"); } });

  document.getElementById("filterBtn")?.addEventListener("click", renderAll);
  document.getElementById("qSearch")?.addEventListener("input", debounce(renderAll, 240));

  window.addEventListener("online", ()=>{ setOnlineIndicator(true); toast("Онлайн — начинаю синк"); if(typeof syncNow === "function") syncNow(); });
  window.addEventListener("offline", ()=>{ setOnlineIndicator(false); toast("Офлайн"); });
});

/* Online indicator & helpers */
function setOnlineIndicator(v){ const txt = document.getElementById("statusText"); if(txt) txt.textContent = v? "online":"offline"; }
function debounce(fn, t=200){ let to; return (...a)=>{ clearTimeout(to); to = setTimeout(()=> fn(...a), t); }; }
function renderAll(){ renderCards(); }

/* --- SYNC IMPLEMENTATION (новая функция, обязательно до init) --- */
async function syncNow(){
  try {
    const q = readQueue();
    if(!q || q.length === 0){
      toast("Очередь пуста");
      return;
    }

    // mark as syncing locally (do not mutate original array directly since updateItem/writeQueue will rerender)
    q.forEach(it => updateItem(it.client_id, { status: "syncing", attempts: (it.attempts||0) + 1 }));

    const payload = { requests: q.map(it => ({ ...it.payload, client_id: it.client_id, req_id: it.payload.req_id || null })) };
    const headers = { "Content-Type": "application/json" };
    if(window.MINI_APPS_API_KEY) headers["X-API-Key"] = window.MINI_APPS_API_KEY;

    const res = await fetch(API_URL, {
      method: "POST",
      headers,
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });

    if(!res.ok){
      throw new Error("HTTP " + res.status);
    }

    const j = await res.json();
    if(!j || !Array.isArray(j.results)){
      throw new Error("Invalid response from server");
    }

    // Process results: remove successes, mark failures
    const removed = [];
    j.results.forEach(r => {
      if(r && r.ok){
        removed.push(r.client_id);
      } else if(r){
        updateItem(r.client_id, { status: "error", last_error: r.error || "server error" });
      }
    });

    if(removed.length) removeByIds(removed);
    toast("Синхронизация завершена");
    renderAll();
  } catch (err) {
    console.error("syncNow error:", err);
    // mark each item as error (write last_error)
    const q = readQueue();
    q.forEach(it => updateItem(it.client_id, { status: "error", last_error: String(err) }));
    toast("Ошибка синхронизации");
  }
}
/* --- end sync --- */

/* --- ROBUST FALLBACK HANDLERS: attach immediately + delegation --- */
(function attachRobustHandlers(){
  function flashButton(el){
    if(!el) return;
    const prev = el.style.boxShadow;
    el.style.boxShadow = "0 0 0 3px rgba(59,130,246,0.18)";
    setTimeout(()=> el.style.boxShadow = prev, 420);
  }

  async function openEquipmentSafely(btn){
    try{
      flashButton(btn);
      toast('Нажата: Выбрать');
      if(typeof showEquipmentModal === 'function'){
        showEquipmentModal([], []);
        const deps = await fetchDepartments().catch(()=>[]);
        const eqs  = await fetchEquipment().catch(()=>[]);
        showEquipmentModal(eqs, deps);
      } else {
        console.warn('showEquipmentModal не определён');
      }
    }catch(err){
      console.error('openEquipmentSafely error', err);
      toast('Ошибка (см. консоль)');
    }
  }

  function toggleThemeSafely(btn){
    try{
      flashButton(btn);
      toast('Тема');
      const cur = localStorage.getItem("mini_theme") || "light";
      applyTheme(cur === "dark" ? "light" : "dark");
    }catch(err){
      console.error('toggleThemeSafely error', err);
      toast('Ошибка темы');
    }
  }

  // attach direct handlers if elements already exist
  function attachDirect(){
    const chooseBtn = document.getElementById('chooseEquipmentBtn');
    if(chooseBtn && !chooseBtn.dataset.robustAttached){
      chooseBtn.addEventListener('click', (e)=>{ e.preventDefault(); openEquipmentSafely(chooseBtn); }, {passive:false});
      chooseBtn.addEventListener('touchend', (e)=>{ e.preventDefault(); openEquipmentSafely(chooseBtn); }, {passive:false});
      chooseBtn.dataset.robustAttached = "1";
    }
    const themeBtn = document.getElementById('themeToggle');
    if(themeBtn && !themeBtn.dataset.robustAttached){
      themeBtn.addEventListener('click', (e)=>{ e.preventDefault(); toggleThemeSafely(themeBtn); }, {passive:false});
      themeBtn.addEventListener('touchend', (e)=>{ e.preventDefault(); toggleThemeSafely(themeBtn); }, {passive:false});
      themeBtn.dataset.robustAttached = "1";
    }
  }

  // initial attempt
  attachDirect();

  // delegated capture listeners to catch clicks if nodes are swapped/replaced
  document.addEventListener('click', function delegatedClick(e){
    const t = e.target.closest && e.target.closest('#chooseEquipmentBtn, #themeToggle');
    if(!t) return;
    e.preventDefault();
    if(t.id === 'chooseEquipmentBtn'){ openEquipmentSafely(t); }
    else if(t.id === 'themeToggle'){ toggleThemeSafely(t); }
  }, true);

  document.addEventListener('touchend', function delegatedTouch(e){
    const t = e.target.closest && e.target.closest('#chooseEquipmentBtn, #themeToggle');
    if(!t) return;
    e.preventDefault();
    if(t.id === 'chooseEquipmentBtn'){ openEquipmentSafely(t); }
    else if(t.id === 'themeToggle'){ toggleThemeSafely(t); }
  }, {passive:false, capture:true});

  // If DOM is mutated and new elements appear, re-attach direct handlers
  const observer = new MutationObserver(()=> attachDirect());
  observer.observe(document.documentElement || document.body, { childList:true, subtree:true });

  // debug helper
  window.__whoOver = function(id){
    const el = document.getElementById(id);
    if(!el) return console.log('no el', id);
    const r = el.getBoundingClientRect();
    const x = Math.round(r.left + r.width/2), y = Math.round(r.top + r.height/2);
    const top = document.elementFromPoint(x, y);
    console.log('elementFromPoint at center ->', top, top && top.id, top && top.className);
  };
})();

/* --- GLOBAL FALLBACK WRAPPERS (guaranteed to be callable from inline onclick) --- */
window.openEquipmentModal = async function(){
  try {
    // same as openEquipmentSafely but global
    const btn = document.getElementById('chooseEquipmentBtn');
    if(btn) btn.style.boxShadow = "0 0 0 3px rgba(59,130,246,0.18)";
    showEquipmentModal([], []);
    const deps = await fetchDepartments().catch(()=>[]);
    const eqs  = await fetchEquipment().catch(()=>[]);
    showEquipmentModal(eqs, deps);
    if(btn) setTimeout(()=> btn.style.boxShadow = "", 420);
  } catch(e){
    console.error('openEquipmentModal error', e);
    toast('Ошибка открытия списка техники');
  }
};

window.toggleThemeUI = function(){
  try {
    const btn = document.getElementById('themeToggle');
    if(btn) btn.style.boxShadow = "0 0 0 3px rgba(59,130,246,0.18)";
    const cur = localStorage.getItem("mini_theme") || "light";
    applyTheme(cur === "dark" ? "light" : "dark");
    setTimeout(()=>{ if(btn) btn.style.boxShadow = ""; }, 300);
  } catch(e){
    console.error('toggleThemeUI error', e);
    toast('Ошибка переключения темы');
  }
};

/* Init: render existing queue and ensure online indicator */
(function init(){
  renderAll();
  setOnlineIndicator(navigator.onLine);
  // periodic auto-sync when online — guard for syncNow existence
  setInterval(()=>{ if(navigator.onLine && typeof syncNow === "function") syncNow(); }, 10000);
})();
