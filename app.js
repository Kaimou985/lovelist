(() => {
  "use strict";

  const DB_NAME = "love100-offline-db";
  const DB_VERSION = 1;
  const STORE = "app";
  const STATE_KEY = "state";
  const TASKS = window.LOVE_TASKS || [];
  const CATEGORIES = window.LOVE_CATEGORIES || ["全部"];
  const EXPENSE_ICONS = { 餐饮: "餐", 交通: "行", 娱乐: "玩", 礼物: "礼", 住宿: "宿", 其他: "·" };
  const PAGE_META = {
    home: ["恋爱清单", "两个人的小宇宙"],
    tasks: ["100 件小事", "想做的，都一起去做"],
    memories: ["回忆相册", "我们共同写下的故事"],
    ledger: ["约会账本", "认真生活，也认真相爱"],
    settings: ["我们的设置", "隐私与本地数据"]
  };

  const DEFAULT_STATE = {
    schemaVersion: 1,
    onboarded: false,
    profile: { nameA: "", nameB: "", startDate: "" },
    completions: {},
    favorites: [],
    taskOverrides: {},
    backgroundImage: "",
    expenses: [],
    lastBackupAt: ""
  };

  let state = structuredCloneSafe(DEFAULT_STATE);
  let activeView = "home";
  let taskStatus = "all";
  let taskCategory = "全部";
  let randomTaskId = 1;
  let currentTaskId = null;
  let currentEditingTaskId = null;
  let taskEditMode = false;
  let pendingPhoto = "";
  let toastTimer = null;
  let db = null;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function structuredCloneSafe(value) {
    return typeof structuredClone === "function"
      ? structuredClone(value)
      : JSON.parse(JSON.stringify(value));
  }

  function escapeHtml(value = "") {
    return String(value).replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[char]);
  }

  function localDateString(date = new Date()) {
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
  }

  function formatDate(value, withYear = true) {
    if (!value) return "未记录日期";
    const parts = value.split("-").map(Number);
    if (parts.length !== 3) return value;
    return `${withYear ? `${parts[0]}年` : ""}${parts[1]}月${parts[2]}日`;
  }

  function formatMoney(cents, decimals = true) {
    const value = Number(cents || 0) / 100;
    return value.toLocaleString("zh-CN", {
      minimumFractionDigits: decimals ? 2 : 0,
      maximumFractionDigits: decimals ? 2 : 0
    });
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) return reject(new Error("IndexedDB unavailable"));
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function dbGet(key) {
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function dbPut(key, value) {
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE, "readwrite").objectStore(STORE).put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  function normalizeState(input) {
    if (!input || typeof input !== "object") return structuredCloneSafe(DEFAULT_STATE);
    return {
      ...structuredCloneSafe(DEFAULT_STATE),
      ...input,
      profile: { ...DEFAULT_STATE.profile, ...(input.profile || {}) },
      completions: input.completions && typeof input.completions === "object" ? input.completions : {},
      favorites: Array.isArray(input.favorites) ? input.favorites.map(Number).filter(Number.isFinite) : [],
      taskOverrides: input.taskOverrides && typeof input.taskOverrides === "object" ? input.taskOverrides : {},
      backgroundImage: typeof input.backgroundImage === "string" && input.backgroundImage.startsWith("data:image/") ? input.backgroundImage : "",
      expenses: Array.isArray(input.expenses) ? input.expenses : []
    };
  }

  async function loadState() {
    try {
      db = await openDatabase();
      state = normalizeState(await dbGet(STATE_KEY));
    } catch (error) {
      console.warn("IndexedDB unavailable; using localStorage fallback.", error);
      try { state = normalizeState(JSON.parse(localStorage.getItem(STATE_KEY))); } catch { state = structuredCloneSafe(DEFAULT_STATE); }
      showToast("本地数据库不可用，已切换兼容模式");
    }
  }

  async function saveState({ render = true } = {}) {
    try {
      if (db) await dbPut(STATE_KEY, state);
      else localStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error(error);
      showToast("保存失败，请先导出数据备份");
    }
    if (render) renderAll();
  }

  function getBaseTask(id) { return TASKS.find((task) => task.id === Number(id)); }
  function getTask(id) {
    const base = getBaseTask(id);
    if (!base) return null;
    return { ...base, ...(state.taskOverrides[base.id] || {}), id: base.id };
  }
  function getAllTasks() { return TASKS.map((task) => getTask(task.id)); }
  function getCompletedEntries() {
    return Object.entries(state.completions)
      .map(([id, record]) => ({ task: getTask(id), record }))
      .filter((item) => item.task && item.record)
      .sort((a, b) => String(b.record.date || "").localeCompare(String(a.record.date || "")));
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
  }

  function setView(view) {
    if (!PAGE_META[view]) return;
    activeView = view;
    $$(".view").forEach((node) => node.classList.toggle("active", node.dataset.view === view));
    $$(".nav-item").forEach((node) => node.classList.toggle("active", node.dataset.nav === view));
    $("#pageTitle").textContent = PAGE_META[view][0];
    $("#headerEyebrow").textContent = PAGE_META[view][1];
    window.scrollTo({ top: 0, behavior: "smooth" });
    $("#mainContent").focus({ preventScroll: true });
    renderAll();
  }

  function renderHeader() {
    const { nameA, nameB } = state.profile;
    const initials = `${nameA.slice(0, 1)}${nameB.slice(0, 1)}` || "♡";
    $("#profileInitials").textContent = initials;
    $("#coupleGreeting").textContent = nameA && nameB ? `${nameA}和${nameB}` : "我们";
    $("#nameA").value = nameA;
    $("#nameB").value = nameB;
    $("#startDate").value = state.profile.startDate || "";
    renderPayerOptions();
  }

  function renderHome() {
    const completed = getCompletedEntries();
    const count = completed.length;
    $("#progressNumber").textContent = count;
    $("#progressOrbit").style.setProperty("--progress", Math.min(100, count));
    $("#heroHint").textContent = count === 100 ? "100 件小事全部点亮，故事仍在继续。" : `还有 ${100 - count} 件小事，等着一起完成。`;

    const start = state.profile.startDate;
    if (start) {
      const startDate = new Date(`${start}T00:00:00`);
      const today = new Date(`${localDateString()}T00:00:00`);
      const days = Math.max(1, Math.floor((today - startDate) / 86400000) + 1);
      $("#loveDays").innerHTML = `相恋第 <strong>${days}</strong> 天`;
    } else {
      $("#loveDays").textContent = "设置相恋日期";
    }

    const month = localDateString().slice(0, 7);
    const monthCompletions = completed.filter(({ record }) => String(record.date).startsWith(month));
    const monthExpenses = state.expenses.filter((item) => String(item.date).startsWith(month));
    $("#monthDates").innerHTML = `${monthCompletions.length} <small>次</small>`;
    $("#monthSpend").innerHTML = `${formatMoney(monthExpenses.reduce((sum, item) => sum + Number(item.amountCents || 0), 0), false)} <small>元</small>`;

    renderRandomTask();
    const recent = completed.slice(0, 3);
    $("#recentMemories").innerHTML = recent.length ? recent.map(({ task, record }) => `
      <button class="memory-preview" data-task-id="${task.id}">
        <span class="memory-preview-thumb">${record.photo ? `<img src="${record.photo}" alt="">` : "♥"}</span>
        <div><h3>${escapeHtml(task.t)}</h3><p>${escapeHtml(record.note || record.location || "完成了一件心愿")}</p></div>
        <time>${formatDate(record.date, false)}</time>
      </button>`).join("") : `<div class="empty-mini">第一段回忆还在等你们一起创造 ♡</div>`;
  }

  function chooseRandomTask() {
    const allTasks = getAllTasks();
    const unfinished = allTasks.filter((task) => !state.completions[task.id]);
    const pool = unfinished.length ? unfinished : allTasks;
    let next = pool[Math.floor(Math.random() * pool.length)];
    if (pool.length > 1) while (next.id === randomTaskId) next = pool[Math.floor(Math.random() * pool.length)];
    randomTaskId = next.id;
    renderRandomTask();
  }

  function renderRandomTask() {
    const task = getTask(randomTaskId) || getAllTasks()[0];
    if (!task) return;
    const favorite = state.favorites.includes(task.id);
    $("#randomTaskCard").innerHTML = `
      <div class="idea-top"><span class="idea-category">NO.${String(task.id).padStart(3, "0")} · ${escapeHtml(task.c)}</span><button class="favorite-mini ${favorite ? "active" : ""}" data-action="toggle-favorite" data-task-id="${task.id}" aria-label="收藏">♥</button></div>
      <div data-task-id="${task.id}" role="button" tabindex="0"><h3>${escapeHtml(task.t)}</h3><p>${escapeHtml(task.d)}</p><div class="idea-meta"><span>预算 ${task.b}</span><span>${task.h}</span><span>${task.s}</span></div></div>`;
  }

  function renderCategoryFilters() {
    const allTasks = getAllTasks();
    $("#categoryFilters").innerHTML = CATEGORIES.map((category) => {
      const count = category === "全部" ? allTasks.length : allTasks.filter((task) => task.c === category).length;
      return `<button class="category-chip ${taskCategory === category ? "active" : ""}" data-category="${category}"><span>${category}</span><b>${count}</b></button>`;
    }).join("");
  }

  function filteredTasks() {
    const query = $("#taskSearch")?.value.trim().toLowerCase() || "";
    return getAllTasks().filter((task) => {
      const done = Boolean(state.completions[task.id]);
      const statusMatch = taskStatus === "all" || (taskStatus === "done" && done) || (taskStatus === "todo" && !done) || (taskStatus === "favorite" && state.favorites.includes(task.id));
      const categoryMatch = taskCategory === "全部" || task.c === taskCategory;
      const queryMatch = !query || `${task.t}${task.d}${task.c}`.toLowerCase().includes(query);
      return statusMatch && categoryMatch && queryMatch;
    });
  }

  function renderTasks() {
    renderCategoryFilters();
    const tasks = filteredTasks();
    $("#taskResultCount").textContent = `${tasks.length} 件小事`;
    $("#taskFilterHint").textContent = taskCategory === "全部" ? "慢慢来，爱在过程里" : taskCategory;
    const editButton = $("[data-action='toggle-edit-mode']");
    editButton.textContent = taskEditMode ? "完成编辑" : "编辑清单";
    editButton.classList.toggle("active", taskEditMode);
    $("#taskList").innerHTML = tasks.length ? tasks.map((task) => {
      const done = Boolean(state.completions[task.id]);
      const favorite = state.favorites.includes(task.id);
      return `<article class="task-card ${done ? "done" : ""} ${taskEditMode ? "editing" : ""}" data-task-id="${task.id}">
        <div class="task-number">${done ? "✓" : String(task.id).padStart(2, "0")}</div>
        <div class="task-content"><h3>${escapeHtml(task.t)}${favorite ? `<span class="fav-dot">♥</span>` : ""}</h3><p><span>${escapeHtml(task.c)}</span><span>${escapeHtml(task.b)}预算</span><span>${escapeHtml(task.h)}</span></p></div>
        ${taskEditMode ? `<button class="task-edit" data-action="edit-task" data-task-id="${task.id}" aria-label="修改清单内容">✎</button>` : `<button class="task-check" data-task-id="${task.id}" aria-label="${done ? "查看完成记录" : "标记完成"}">✓</button>`}
      </article>`;
    }).join("") : `<div class="no-results"><b>没有找到匹配的小事</b><span>换个关键词或筛选条件试试</span></div>`;
  }

  function renderMemories() {
    const entries = getCompletedEntries();
    $("#memoryCount").textContent = `${entries.length} 个珍贵瞬间`;
    $("#memorySubtitle").textContent = entries.length ? `已经共同点亮 ${entries.length} 件小事。` : "每一件完成的小事，都值得被好好记住。";
    $("#memoryTimeline").innerHTML = entries.length ? entries.map(({ task, record }) => `
      <article class="timeline-card" data-task-id="${task.id}">
        <div class="timeline-dot">♥</div>
        <div class="timeline-content">
          ${record.photo ? `<img class="timeline-photo" src="${record.photo}" alt="${escapeHtml(task.t)}的回忆照片">` : ""}
          <div class="timeline-head"><h3>${escapeHtml(task.t)}</h3><time>${formatDate(record.date, false)}</time></div>
          ${record.location ? `<p class="timeline-location">⌖ ${escapeHtml(record.location)}</p>` : ""}
          ${record.note ? `<p class="timeline-note">${escapeHtml(record.mood || "♥")} ${escapeHtml(record.note)}</p>` : ""}
        </div>
      </article>`).join("") : `<div class="empty-state"><div class="empty-heart">♥</div><h3>故事正要开始</h3><p>完成清单中的第一件小事，这里就会出现属于你们的时间线。</p><button class="primary-button" data-nav="tasks">去挑一件小事</button></div>`;
  }

  function currentMonthExpenses() {
    const month = localDateString().slice(0, 7);
    return state.expenses.filter((item) => String(item.date).startsWith(month));
  }

  function renderLedger() {
    const now = new Date();
    const monthExpenses = currentMonthExpenses();
    const total = monthExpenses.reduce((sum, item) => sum + Number(item.amountCents || 0), 0);
    $("#ledgerMonth").textContent = `${now.getFullYear()}年${now.getMonth() + 1}月`;
    $("#ledgerTotal").textContent = `¥ ${formatMoney(total)}`;
    $("#expenseCount").textContent = monthExpenses.length;
    $("#expenseAverage").textContent = `¥${formatMoney(monthExpenses.length ? Math.round(total / monthExpenses.length) : 0, false)}`;

    const categoryTotals = Object.keys(EXPENSE_ICONS).map((category) => ({
      category,
      value: monthExpenses.filter((item) => item.category === category).reduce((sum, item) => sum + Number(item.amountCents || 0), 0)
    })).sort((a, b) => b.value - a.value).slice(0, 3);
    $("#expenseCategories").innerHTML = categoryTotals.map(({ category, value }) => `<div class="category-stat"><i>${EXPENSE_ICONS[category]}</i><span>${category}</span><b>¥${formatMoney(value, false)}</b></div>`).join("");

    const expenses = [...state.expenses].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    $("#expenseList").innerHTML = expenses.length ? expenses.map((item) => {
      const task = getTask(item.taskId);
      return `<article class="expense-item"><span class="expense-icon">${EXPENSE_ICONS[item.category] || "·"}</span><div class="expense-main"><h3>${escapeHtml(item.note || item.category)}</h3><p>${formatDate(item.date, false)} · ${escapeHtml(item.payer || "共同")}${task ? ` · ${escapeHtml(task.t)}` : ""}</p></div><div class="expense-amount"><b>- ¥${formatMoney(item.amountCents)}</b><button data-action="delete-expense" data-expense-id="${item.id}">删除</button></div></article>`;
    }).join("") : `<div class="empty-mini">还没有账目，下一次约会后再来记一笔。</div>`;
  }

  function renderSettings() {
    $("#backupHint").textContent = state.lastBackupAt ? `上次导出：${formatDate(state.lastBackupAt.slice(0, 10))}` : "建议每月导出一次";
    applyCustomBackground();
    $("#backgroundPreview").innerHTML = state.backgroundImage
      ? `<img src="${state.backgroundImage}" alt="当前页面背景预览">`
      : `<span>尚未设置自定义背景</span>`;
    $("#removeBackground").hidden = !state.backgroundImage;
  }

  function applyCustomBackground() {
    const hasBackground = Boolean(state.backgroundImage);
    document.body.classList.toggle("has-custom-background", hasBackground);
    if (hasBackground) document.body.style.setProperty("--custom-background", `url("${state.backgroundImage}")`);
    else document.body.style.removeProperty("--custom-background");
  }

  function renderPayerOptions() {
    const select = $("#expensePayer");
    const previous = select.value;
    const names = ["共同", state.profile.nameA, state.profile.nameB].filter(Boolean);
    select.innerHTML = [...new Set(names)].map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
    if (names.includes(previous)) select.value = previous;
  }

  function renderAll() {
    renderHeader();
    renderHome();
    renderTasks();
    renderMemories();
    renderLedger();
    renderSettings();
  }

  function openTaskModal(id) {
    const task = getTask(id);
    if (!task) return;
    currentTaskId = task.id;
    const record = state.completions[task.id] || null;
    pendingPhoto = record?.photo || "";
    const favorite = state.favorites.includes(task.id);
    $("#taskModalBody").innerHTML = `
      <span class="task-detail-number">NO.${String(task.id).padStart(3, "0")} · ${escapeHtml(task.c)}</span>
      <h2 class="task-detail-title" id="taskModalTitle">${escapeHtml(task.t)}</h2>
      <p class="task-detail-desc">${escapeHtml(task.d)}</p>
      <div class="task-detail-meta"><div><span>预算</span><b>${escapeHtml(task.b)}</b></div><div><span>用时</span><b>${escapeHtml(task.h)}</b></div><div><span>适合</span><b>${escapeHtml(task.s)}</b></div></div>
      ${record ? `<div class="completed-banner">✓ 已在 ${formatDate(record.date)} 点亮这件小事</div>` : ""}
      <form class="completion-form" id="completionForm">
        <h3>${record ? "编辑这段回忆" : "完成后，留下一点回忆"}</h3>
        <div class="form-grid two-col date-row"><label><span>完成日期</span><input id="completionDate" type="date" required value="${record?.date || localDateString()}"></label><label><span>地点</span><input id="completionLocation" maxlength="30" placeholder="在哪里发生" value="${escapeHtml(record?.location || "")}"></label></div>
        <label><span>那天的心情</span><div class="mood-row">${["🥰","😊","😆","🥹","✨"].map((mood) => `<button type="button" class="mood-button ${record?.mood === mood ? "active" : ""}" data-mood="${mood}">${mood}</button>`).join("")}</div></label>
        <label><span>想说的话</span><textarea id="completionNote" rows="3" maxlength="180" placeholder="记录一句当时的心情……">${escapeHtml(record?.note || "")}</textarea></label>
        <label class="photo-picker"><span>${pendingPhoto ? "更换照片" : "＋ 添加一张回忆照片"}</span><input id="completionPhoto" type="file" accept="image/*"></label>
        <div class="photo-preview" id="photoPreview">${photoPreviewHtml()}</div>
        <div class="task-actions"><button type="button" class="favorite-button ${favorite ? "active" : ""}" data-action="toggle-favorite" data-task-id="${task.id}" aria-label="收藏">♥</button><button class="primary-button" type="submit">${record ? "更新这段回忆" : "点亮这件小事"}</button></div>
        ${record ? `<button type="button" class="undo-button" data-action="undo-completion" data-task-id="${task.id}">取消完成状态</button>` : ""}
      </form>`;
    $("#taskModal").hidden = false;
    document.body.style.overflow = "hidden";
  }

  function openTaskEditor(id) {
    const task = getTask(id);
    if (!task) return;
    currentEditingTaskId = task.id;
    $("#editTaskName").value = task.t;
    $("#editTaskDescription").value = task.d;
    $("#editTaskBudget").value = task.b;
    $("#editTaskDuration").value = task.h;
    $("#editTaskSeason").value = task.s;
    $("#editTaskCategory").innerHTML = CATEGORIES.slice(1).map((category) => `<option value="${category}">${category}</option>`).join("");
    $("#editTaskCategory").value = task.c;
    $("[data-action='restore-task']").hidden = !state.taskOverrides[task.id];
    $("#editTaskModal").hidden = false;
    document.body.style.overflow = "hidden";
    setTimeout(() => $("#editTaskName").focus(), 100);
  }

  function photoPreviewHtml() {
    return pendingPhoto ? `<img src="${pendingPhoto}" alt="待保存的回忆照片"><button type="button" data-action="remove-photo" aria-label="移除照片">×</button>` : "";
  }

  function closeModals() {
    $$(".modal-backdrop").forEach((modal) => { modal.hidden = true; });
    document.body.style.overflow = "";
    currentTaskId = null;
    currentEditingTaskId = null;
    pendingPhoto = "";
  }

  async function toggleFavorite(id) {
    const taskId = Number(id);
    const index = state.favorites.indexOf(taskId);
    if (index >= 0) state.favorites.splice(index, 1);
    else state.favorites.push(taskId);
    await saveState();
    if (!$("#taskModal").hidden && currentTaskId === taskId) openTaskModal(taskId);
  }

  async function compressPhoto(file, max = 1400, quality = 0.78) {
    if (!file.type.startsWith("image/")) throw new Error("请选择图片文件");
    if (file.size > 20 * 1024 * 1024) throw new Error("图片不能超过 20MB");
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
    const scale = Math.min(1, max / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  }

  function openExpenseModal(taskId = "") {
    const select = $("#expenseTask");
    select.innerHTML = `<option value="">不关联</option>${getAllTasks().map((task) => `<option value="${task.id}">${String(task.id).padStart(2,"0")} · ${escapeHtml(task.t)}</option>`).join("")}`;
    select.value = taskId ? String(taskId) : "";
    $("#expenseDate").value = localDateString();
    $("#expenseAmount").value = "";
    $("#expenseNote").value = "";
    renderPayerOptions();
    $("#expenseModal").hidden = false;
    document.body.style.overflow = "hidden";
    setTimeout(() => $("#expenseAmount").focus(), 100);
  }

  async function exportData() {
    state.lastBackupAt = new Date().toISOString();
    await saveState({ render: false });
    const payload = {
      app: "恋爱100件小事",
      exportVersion: 1,
      exportedAt: state.lastBackupAt,
      data: state
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `恋爱清单备份-${localDateString()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    renderAll();
    showToast("备份已导出，请保存到“文件”");
  }

  async function importData(file) {
    try {
      if (!file || file.size > 30 * 1024 * 1024) throw new Error("备份文件无效或过大");
      const parsed = JSON.parse(await file.text());
      if (parsed.app !== "恋爱100件小事" || !parsed.data) throw new Error("不是有效的恋爱清单备份");
      const next = normalizeState(parsed.data);
      if (!confirm("恢复备份会覆盖当前设备上的数据，确定继续吗？")) return;
      state = next;
      await saveState();
      showToast("备份恢复成功");
    } catch (error) {
      showToast(error.message || "备份文件读取失败");
    } finally {
      $("#importFile").value = "";
    }
  }

  async function handleAction(action, target) {
    if (action === "open-settings") return setView("settings");
    if (action === "shuffle-task") return chooseRandomTask();
    if (action === "close-modal") return closeModals();
    if (action === "open-expense") return openExpenseModal();
    if (action === "toggle-edit-mode") {
      taskEditMode = !taskEditMode;
      renderTasks();
      showToast(taskEditMode ? "点击清单右侧的铅笔进行修改" : "清单编辑已完成");
      return;
    }
    if (action === "edit-task") return openTaskEditor(target.dataset.taskId);
    if (action === "restore-task") {
      const taskId = currentEditingTaskId;
      if (!taskId || !state.taskOverrides[taskId]) return;
      if (!confirm("恢复这一项的默认标题和内容？完成记录不会受到影响。")) return;
      delete state.taskOverrides[taskId];
      closeModals();
      await saveState();
      showToast("已恢复默认内容");
      return;
    }
    if (action === "remove-background") {
      if (!state.backgroundImage) return;
      state.backgroundImage = "";
      await saveState();
      showToast("已恢复默认背景");
      return;
    }
    if (action === "toggle-favorite") return toggleFavorite(target.dataset.taskId);
    if (action === "remove-photo") { pendingPhoto = ""; $("#photoPreview").innerHTML = ""; return; }
    if (action === "save-profile") {
      state.profile.nameA = $("#nameA").value.trim();
      state.profile.nameB = $("#nameB").value.trim();
      state.profile.startDate = $("#startDate").value;
      await saveState();
      showToast("我们的信息已保存");
      return;
    }
    if (action === "finish-onboarding" || action === "skip-onboarding") {
      if (action === "finish-onboarding") {
        state.profile.nameA = $("#onboardNameA").value.trim();
        state.profile.nameB = $("#onboardNameB").value.trim();
      }
      state.onboarded = true;
      $("#onboarding").hidden = true;
      await saveState();
      return;
    }
    if (action === "undo-completion") {
      if (!confirm("取消完成状态？已经填写的文字和照片也会删除。")) return;
      delete state.completions[target.dataset.taskId];
      closeModals();
      await saveState();
      showToast("已恢复为待完成");
      return;
    }
    if (action === "delete-expense") {
      if (!confirm("删除这笔账目？")) return;
      state.expenses = state.expenses.filter((item) => item.id !== target.dataset.expenseId);
      await saveState();
      showToast("账目已删除");
      return;
    }
    if (action === "export-data") return exportData();
    if (action === "reset-data") {
      if (!confirm("确定清除所有本地数据吗？此操作无法撤销，建议先导出备份。")) return;
      const onboarded = state.onboarded;
      state = structuredCloneSafe(DEFAULT_STATE);
      state.onboarded = onboarded;
      await saveState();
      showToast("所有记录已清除");
    }
  }

  function bindEvents() {
    document.addEventListener("click", async (event) => {
      const nav = event.target.closest("[data-nav]");
      if (nav) { event.preventDefault(); setView(nav.dataset.nav); return; }
      const actionNode = event.target.closest("[data-action]");
      if (actionNode) { event.preventDefault(); await handleAction(actionNode.dataset.action, actionNode); return; }
      const taskNode = event.target.closest("[data-task-id]");
      if (taskNode) {
        event.preventDefault();
        if (taskEditMode) openTaskEditor(taskNode.dataset.taskId);
        else openTaskModal(taskNode.dataset.taskId);
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeModals();
      if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-task-id][role='button']")) openTaskModal(event.target.dataset.taskId);
    });

    $("#statusFilters").addEventListener("click", (event) => {
      const button = event.target.closest("[data-status]");
      if (!button) return;
      taskStatus = button.dataset.status;
      $$("[data-status]", $("#statusFilters")).forEach((node) => node.classList.toggle("active", node === button));
      renderTasks();
    });

    $("#categoryFilters").addEventListener("click", (event) => {
      const button = event.target.closest("[data-category]");
      if (!button) return;
      taskCategory = button.dataset.category;
      renderTasks();
    });
    $("#taskSearch").addEventListener("input", renderTasks);

    document.addEventListener("click", (event) => {
      const mood = event.target.closest("[data-mood]");
      if (!mood) return;
      $$(".mood-button", $("#completionForm")).forEach((node) => node.classList.toggle("active", node === mood));
    });

    document.addEventListener("change", async (event) => {
      if (event.target.id === "completionPhoto" && event.target.files[0]) {
        try {
          showToast("正在压缩照片…");
          pendingPhoto = await compressPhoto(event.target.files[0]);
          $("#photoPreview").innerHTML = photoPreviewHtml();
          showToast("照片已准备好，保存后生效");
        } catch (error) { showToast(error.message || "照片处理失败"); }
      }
      if (event.target.id === "backgroundFile" && event.target.files[0]) {
        try {
          showToast("正在处理背景图片…");
          state.backgroundImage = await compressPhoto(event.target.files[0], 1920, 0.8);
          await saveState();
          showToast("页面背景已更新");
        } catch (error) {
          showToast(error.message || "背景图片处理失败");
        } finally {
          event.target.value = "";
        }
      }
      if (event.target.id === "importFile" && event.target.files[0]) await importData(event.target.files[0]);
    });

    document.addEventListener("submit", async (event) => {
      if (event.target.id === "completionForm") {
        event.preventDefault();
        const taskId = currentTaskId;
        state.completions[taskId] = {
          date: $("#completionDate").value || localDateString(),
          location: $("#completionLocation").value.trim(),
          mood: $(".mood-button.active")?.dataset.mood || "♥",
          note: $("#completionNote").value.trim(),
          photo: pendingPhoto,
          updatedAt: new Date().toISOString()
        };
        closeModals();
        await saveState();
        showToast("这件小事已被点亮 ♥");
      }
      if (event.target.id === "expenseForm") {
        event.preventDefault();
        const amount = Number($("#expenseAmount").value.replace(",", "."));
        if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000) { showToast("请输入有效金额"); return; }
        state.expenses.push({
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          amountCents: Math.round(amount * 100),
          category: $("#expenseCategory").value,
          payer: $("#expensePayer").value,
          taskId: Number($("#expenseTask").value) || null,
          date: $("#expenseDate").value || localDateString(),
          note: $("#expenseNote").value.trim(),
          createdAt: new Date().toISOString()
        });
        closeModals();
        await saveState();
        showToast("账目已保存");
      }
      if (event.target.id === "editTaskForm") {
        event.preventDefault();
        const taskId = currentEditingTaskId;
        if (!taskId || !getBaseTask(taskId)) return;
        state.taskOverrides[taskId] = {
          t: $("#editTaskName").value.trim(),
          c: $("#editTaskCategory").value,
          d: $("#editTaskDescription").value.trim(),
          b: $("#editTaskBudget").value.trim() || "自定",
          h: $("#editTaskDuration").value.trim() || "自定",
          s: $("#editTaskSeason").value.trim() || "全年"
        };
        closeModals();
        await saveState();
        showToast("清单内容已更新");
      }
    });

    $$(".modal-backdrop").forEach((modal) => modal.addEventListener("click", (event) => { if (event.target === modal) closeModals(); }));
  }

  async function setupOffline() {
    if ("serviceWorker" in navigator) {
      try { await navigator.serviceWorker.register("./sw.js", { scope: "./" }); }
      catch (error) { console.warn("Service Worker registration failed", error); }
    }
    if (navigator.storage?.persist) {
      try { await navigator.storage.persist(); } catch { /* Browser decides persistence silently. */ }
    }
  }

  async function init() {
    bindEvents();
    await loadState();
    randomTaskId = getAllTasks().find((task) => !state.completions[task.id])?.id || 1;
    $("#onboarding").hidden = state.onboarded;
    renderAll();
    setupOffline();
  }

  init();
})();
