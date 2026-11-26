import { renderMarkdown } from "./markdown.js";

const STATUS_LABELS = {
  not_started: "Not Started",
  studying: "Studying",
  needs_review: "Needs Review",
  mastered: "Mastered",
};

const THEMES = [
  { id: "dark", label: "Dark", metaColor: "#0b1120" },
  { id: "midnight", label: "Midnight", metaColor: "#000000" },
  { id: "light", label: "Light", metaColor: "#f8fafc" },
];

const state = {
  csrfToken: "",
  authEnabled: false,
  authenticated: false,
  pinBuffer: "",
  pinSubmitting: false,
  lockoutUntil: 0,
  lockoutTimerId: null,
  activeBank: "fde",
  banks: [],
  storageLabel: "",
  geminiModel: "gemini-4-hydrogen",
  manifest: {},
  questions: [],
  questionsById: new Map(),
  progress: {},
  chatByQuestion: new Map(),
  chatLoading: false,
  coachMode: "tutor",
  searchMatchIds: null,
  filteredQuestions: [],
  activeQuestionId: null,
  activeQuestionDetail: null,
  activeTab: "guide",
  filters: {
    query: "",
    status: "all",
    domain: "all",
    skill: "all",
    topic: "all",
    l6Only: false,
    l7Only: false,
    showHidden: false,
    sortBy: "default",
  },
  timer: {
    remainingSec: 45 * 60,
    running: false,
    intervalId: null,
  },
};

const el = {
  lockScreen: document.getElementById("lock-screen"),
  appShell: document.getElementById("app-shell"),
  pinDots: document.getElementById("pin-dots"),
  lockSubtitle: document.getElementById("lock-subtitle"),
  lockMessage: document.getElementById("lock-message"),
  keypadGrid: document.getElementById("keypad-grid"),
  btnPinClear: document.getElementById("btn-pin-clear"),
  btnPinBack: document.getElementById("btn-pin-back"),
  btnLockApp: document.getElementById("btn-lock-app"),

  metaThemeColor: document.getElementById("meta-theme-color"),
  sidebar: document.getElementById("sidebar"),
  sidebarBackdrop: document.getElementById("sidebar-backdrop"),
  btnToggleSidebar: document.getElementById("btn-toggle-sidebar"),
  btnCloseSidebar: document.getElementById("btn-close-sidebar"),
  btnHome: document.getElementById("btn-home"),
  bankSelect: document.getElementById("bank-select"),
  headerProgressPill: document.getElementById("header-progress-pill"),
  dashHeroTitle: document.getElementById("dash-hero-title"),
  dashHeroSubtitle: document.getElementById("dash-hero-subtitle"),
  timerDisplay: document.getElementById("timer-display"),
  btnTimerToggle: document.getElementById("btn-timer-toggle"),
  btnTimerReset: document.getElementById("btn-timer-reset"),
  btnRandomPick: document.getElementById("btn-random-pick"),
  btnShortcuts: document.getElementById("btn-shortcuts"),
  btnTheme: document.getElementById("btn-theme"),
  themeLabel: document.getElementById("theme-label"),

  searchInput: document.getElementById("search-input"),
  filterStatus: document.getElementById("filter-status"),
  filterDomain: document.getElementById("filter-domain"),
  filterSkill: document.getElementById("filter-skill"),
  filterTopic: document.getElementById("filter-topic"),
  filterL6Only: document.getElementById("filter-l6-only"),
  filterL7Only: document.getElementById("filter-l7-only"),
  filterShowHidden: document.getElementById("filter-show-hidden"),
  labelShowHidden: document.getElementById("label-show-hidden"),
  sortBy: document.getElementById("sort-by"),
  filteredCount: document.getElementById("filtered-count"),
  btnClearFilters: document.getElementById("btn-clear-filters"),
  questionList: document.getElementById("question-list"),

  dashboardView: document.getElementById("dashboard-view"),
  statsGrid: document.getElementById("stats-grid"),
  skillBreakdown: document.getElementById("skill-breakdown"),
  domainBreakdown: document.getElementById("domain-breakdown"),
  confidentialityNotice: document.getElementById("confidentiality-notice"),
  storageNotice: document.getElementById("storage-notice"),
  notesStorageHint: document.getElementById("notes-storage-hint"),
  btnStartSysarch: document.getElementById("btn-start-sysarch"),
  btnStartDsa: document.getElementById("btn-start-dsa"),
  btnStartReview: document.getElementById("btn-start-review"),
  btnExportProgress: document.getElementById("btn-export-progress"),
  btnOpenReset: document.getElementById("btn-open-reset"),

  questionView: document.getElementById("question-view"),
  btnBackDash: document.getElementById("btn-back-dash"),
  btnPrevQ: document.getElementById("btn-prev-q"),
  btnNextQ: document.getElementById("btn-next-q"),
  qIdBadge: document.getElementById("q-id-badge"),
  qDomainBadge: document.getElementById("q-domain-badge"),
  qCorpLink: document.getElementById("q-corp-link"),
  qTitle: document.getElementById("q-title"),
  qTags: document.getElementById("q-tags"),
  qStatusSelect: document.getElementById("q-status-select"),
  qConfidenceStars: document.getElementById("q-confidence-stars"),
  btnBookmark: document.getElementById("btn-bookmark"),
  btnHideQuestion: document.getElementById("btn-hide-question"),
  saveIndicator: document.getElementById("save-indicator"),

  panelProblem: document.getElementById("panel-problem"),
  panelHints: document.getElementById("panel-hints"),
  panelSolution: document.getElementById("panel-solution"),
  panelRubric: document.getElementById("panel-rubric"),
  panelGuide: document.getElementById("panel-guide"),
  panelNotes: document.getElementById("panel-notes"),
  panelGemini: document.getElementById("panel-gemini"),
  qNotesInput: document.getElementById("q-notes-input"),
  relatedQuestionsBox: document.getElementById("related-questions-box"),
  relatedQuestionsList: document.getElementById("related-questions-list"),

  btnCoachTutor: document.getElementById("btn-coach-tutor"),
  btnCoachSocratic: document.getElementById("btn-coach-socratic"),
  btnClearChat: document.getElementById("btn-clear-chat"),
  quickPrompts: document.getElementById("quick-prompts"),
  chatMessages: document.getElementById("chat-messages"),
  chatForm: document.getElementById("chat-form"),
  chatInput: document.getElementById("chat-input"),
  btnChatSend: document.getElementById("btn-chat-send"),

  dialogShortcuts: document.getElementById("dialog-shortcuts"),
  dialogReset: document.getElementById("dialog-reset"),
  btnConfirmReset: document.getElementById("btn-confirm-reset"),
  dialogClearChat: document.getElementById("dialog-clear-chat"),
  btnConfirmClearChat: document.getElementById("btn-confirm-clear-chat"),
};

function getProgress(qid) {
  const raw = state.progress[String(qid)] || {};
  return {
    status: raw.status || "not_started",
    confidence: Number.isInteger(raw.confidence) ? raw.confidence : 0,
    bookmarked: Boolean(raw.bookmarked),
    hidden: Boolean(raw.hidden),
    notes: typeof raw.notes === "string" ? raw.notes : "",
    updated_at: raw.updated_at || 0,
  };
}

/* ---------- Reading Position & Last View Memory ---------- */
function readScrollMap() {
  try {
    const raw = localStorage.getItem("swe6_scroll_positions");
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveScrollPosition(bank, qid, tab, scrollTop) {
  if (!bank || qid === null || !tab) return;
  const map = readScrollMap();
  map[`${bank}:${qid}:${tab}`] = Math.max(0, Math.round(scrollTop));
  try {
    localStorage.setItem("swe6_scroll_positions", JSON.stringify(map));
  } catch {
    // Ignore storage quota errors
  }
}

function getSavedScrollPosition(bank, qid, tab) {
  const map = readScrollMap();
  const val = map[`${bank}:${qid}:${tab}`];
  return typeof val === "number" && val > 0 ? val : 0;
}

function saveLastView(bank, qid, tab) {
  if (!bank) return;
  const key = `swe6_last_view_${bank}`;
  try {
    if (qid === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify({ qid, tab: tab || "guide" }));
    }
  } catch {
    // Ignore storage errors
  }
}

function getLastView(bank) {
  try {
    const raw = localStorage.getItem(`swe6_last_view_${bank}`);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && Number.isInteger(parsed.qid)) {
      return parsed;
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

function restoreScrollForCurrentView() {
  const mainEl = document.getElementById("main-content");
  if (!mainEl || state.activeQuestionId === null) return;
  const savedTop = getSavedScrollPosition(state.activeBank, state.activeQuestionId, state.activeTab);
  requestAnimationFrame(() => {
    mainEl.scrollTo({ top: savedTop, behavior: "instant" });
  });
}

/* ---------- Mobile Sidebar Drawer ---------- */
function setSidebarOpen(open) {
  el.sidebar.classList.toggle("open", open);
  el.sidebarBackdrop.classList.toggle("hidden", !open);
}

/* ---------- Theme (Light / Dark / Midnight) ---------- */
function applyTheme(themeId) {
  const def = THEMES.find((t) => t.id === themeId) || THEMES[0];
  document.documentElement.setAttribute("data-theme", def.id);
  if (el.metaThemeColor) el.metaThemeColor.setAttribute("content", def.metaColor);
  if (el.themeLabel) el.themeLabel.textContent = def.label;
  localStorage.setItem("swe6_theme", def.id);
}

function initTheme() {
  const saved = localStorage.getItem("swe6_theme");
  if (saved && THEMES.some((t) => t.id === saved)) {
    applyTheme(saved);
  } else {
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(prefersDark ? "dark" : "light");
  }
}

function cycleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const idx = THEMES.findIndex((t) => t.id === current);
  const next = THEMES[(idx + 1) % THEMES.length];
  applyTheme(next.id);
}

/* ---------- Timer ---------- */
function renderTimer() {
  const mins = Math.floor(state.timer.remainingSec / 60);
  const secs = state.timer.remainingSec % 60;
  el.timerDisplay.textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  el.timerDisplay.classList.remove("timer-warn", "timer-danger");
  if (state.timer.remainingSec <= 5 * 60) {
    el.timerDisplay.classList.add("timer-danger");
  } else if (state.timer.remainingSec <= 15 * 60) {
    el.timerDisplay.classList.add("timer-warn");
  }
  el.btnTimerToggle.textContent = state.timer.running ? "Pause" : "Start";
}

function toggleTimer() {
  if (state.timer.running) {
    clearInterval(state.timer.intervalId);
    state.timer.intervalId = null;
    state.timer.running = false;
  } else {
    state.timer.running = true;
    state.timer.intervalId = setInterval(() => {
      if (state.timer.remainingSec > 0) {
        state.timer.remainingSec -= 1;
        renderTimer();
      } else {
        toggleTimer();
      }
    }, 1000);
  }
  renderTimer();
}

function resetTimer() {
  if (state.timer.running) toggleTimer();
  state.timer.remainingSec = 45 * 60;
  renderTimer();
}

/* ---------- API ---------- */
function apiUrl(path) {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}bank=${encodeURIComponent(state.activeBank)}`;
}

function renderBankSelector() {
  if (!el.bankSelect) return;
  el.bankSelect.replaceChildren();
  for (const b of state.banks) {
    const opt = document.createElement("option");
    opt.value = b.id;
    opt.textContent = `${b.label} (${b.count})`;
    el.bankSelect.appendChild(opt);
  }
  el.bankSelect.value = state.activeBank;
  el.bankSelect.classList.toggle("hidden", state.banks.length <= 1);
}

async function fetchBootstrap(bankId) {
  const targetBank = bankId || state.activeBank || "fde";
  const res = await fetch(`/api/bootstrap?bank=${encodeURIComponent(targetBank)}`);
  if (!res.ok) throw new Error("Failed to load study guide data");
  const data = await res.json();
  state.csrfToken = data.csrf_token;
  state.activeBank = data.active_bank || targetBank;
  state.banks = data.banks || [];
  state.storageLabel = data.storage_label || "";
  state.geminiModel = data.gemini_model || "gemini-4-hydrogen";
  state.manifest = data.manifest || {};
  state.questions = data.questions || [];
  state.questionsById = new Map(state.questions.map((q) => [q.id, q]));
  state.progress = data.progress || {};
  state.chatByQuestion.clear();
  localStorage.setItem("swe6_active_bank", state.activeBank);
  renderBankSelector();
}

async function switchBank(nextBankId) {
  if (!nextBankId || nextBankId === state.activeBank) return;
  state.activeBank = nextBankId;
  resetFiltersState();
  await fetchBootstrap(nextBankId);
  populateFilterDropdowns();
  updateHeaderProgress();
  applyFilters();
  const lastView = getLastView(state.activeBank);
  if (lastView && state.questionsById.has(lastView.qid)) {
    openQuestion(lastView.qid, lastView.tab);
  } else {
    showDashboard();
  }
}

async function saveProgress(qid, patch) {
  el.saveIndicator.textContent = "Saving...";
  const res = await fetch(apiUrl(`/api/progress/${qid}`), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": state.csrfToken,
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    el.saveIndicator.textContent = "Save failed";
    return;
  }
  const data = await res.json();
  state.progress[String(qid)] = data.progress;
  el.saveIndicator.textContent = "Saved";
  setTimeout(() => {
    if (el.saveIndicator.textContent === "Saved") {
      el.saveIndicator.textContent = "";
    }
  }, 1400);
  updateHeaderProgress();
  applyFilters();
  if (state.activeQuestionId === null) {
    renderDashboard();
  }
}

/* ---------- Gemini Chat ---------- */
async function loadChatThread(qid) {
  const res = await fetch(apiUrl(`/api/chat/${qid}`));
  if (!res.ok) return;
  const data = await res.json();
  state.chatByQuestion.set(qid, data.messages || []);
  if (state.activeQuestionId === qid) {
    renderChatMessages(qid);
  }
}

function renderChatMessages(qid) {
  el.chatMessages.replaceChildren();
  const messages = state.chatByQuestion.get(qid) || [];
  if (messages.length === 0 && !state.chatLoading) {
    const empty = document.createElement("div");
    empty.className = "chat-empty";
    empty.textContent = `Ask Gemini (${state.geminiModel}) anything about this question. Conversation threads are saved automatically.`;
    el.chatMessages.appendChild(empty);
    return;
  }

  for (const msg of messages) {
    const isUser = msg.role === "user";
    const bubble = document.createElement("div");
    bubble.className = isUser ? "chat-bubble chat-bubble-user" : "chat-bubble chat-bubble-model";

    const meta = document.createElement("div");
    meta.className = "chat-meta";
    const modeTag = msg.mode === "socratic" ? " · Socratic" : "";
    meta.textContent = isUser ? "You" : `✦ Gemini${modeTag}`;
    bubble.appendChild(meta);

    if (isUser) {
      const p = document.createElement("div");
      p.style.whiteSpace = "pre-wrap";
      p.textContent = msg.text || "";
      bubble.appendChild(p);
    } else {
      bubble.appendChild(renderMarkdown(msg.text || ""));
    }
    el.chatMessages.appendChild(bubble);
  }

  if (state.chatLoading) {
    const thinking = document.createElement("div");
    thinking.className = "chat-bubble chat-bubble-model";
    thinking.textContent = "✦ Gemini is thinking...";
    el.chatMessages.appendChild(thinking);
  }

  el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
}

async function sendChatMessage(text) {
  const qid = state.activeQuestionId;
  const trimmed = text.trim();
  if (qid === null || !trimmed || state.chatLoading) return;

  const existing = state.chatByQuestion.get(qid) || [];
  state.chatByQuestion.set(qid, [
    ...existing,
    { role: "user", text: trimmed, timestamp: Math.floor(Date.now() / 1000), mode: state.coachMode },
  ]);
  state.chatLoading = true;
  el.chatInput.value = "";
  el.btnChatSend.disabled = true;
  renderChatMessages(qid);

  try {
    const res = await fetch(apiUrl(`/api/chat/${qid}`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": state.csrfToken,
      },
      body: JSON.stringify({ message: trimmed, coach_mode: state.coachMode }),
    });
    const data = await res.json();
    if (!res.ok) {
      const errMsg = data.error || "Could not reach Gemini. Please try again.";
      const cur = state.chatByQuestion.get(qid) || [];
      state.chatByQuestion.set(qid, [...cur, { role: "model", text: `Error: ${errMsg}`, mode: state.coachMode }]);
    } else {
      state.chatByQuestion.set(qid, data.messages || []);
    }
  } catch {
    const cur = state.chatByQuestion.get(qid) || [];
    state.chatByQuestion.set(qid, [
      ...cur,
      { role: "model", text: "Network error while contacting Gemini.", mode: state.coachMode },
    ]);
  } finally {
    state.chatLoading = false;
    el.btnChatSend.disabled = false;
    if (state.activeQuestionId === qid) {
      renderChatMessages(qid);
    }
  }
}

/* ---------- Filters & Sorting ---------- */
function populateFilterDropdowns() {
  const domains = new Map();
  const skills = new Map();
  const topics = new Map();

  for (const q of state.questions) {
    domains.set(q.domain, (domains.get(q.domain) || 0) + 1);
    for (const s of q.skills) skills.set(s, (skills.get(s) || 0) + 1);
    for (const t of q.topics) topics.set(t, (topics.get(t) || 0) + 1);
  }

  const fillSelect = (selectEl, map, defaultLabel) => {
    selectEl.replaceChildren();
    const def = document.createElement("option");
    def.value = "all";
    def.textContent = defaultLabel;
    selectEl.appendChild(def);
    const sorted = [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    for (const [name, count] of sorted) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = `${name} (${count})`;
      selectEl.appendChild(opt);
    }
  };

  fillSelect(el.filterDomain, domains, "All Domains");
  fillSelect(el.filterSkill, skills, "All Skills");
  fillSelect(el.filterTopic, topics, "All Topics");
}

function applyFilters() {
  const f = state.filters;
  const matchSet = state.searchMatchIds ? new Set(state.searchMatchIds) : null;

  let hiddenCount = 0;
  for (const q of state.questions) {
    if (getProgress(q.id).hidden) hiddenCount += 1;
  }
  if (el.labelShowHidden) {
    el.labelShowHidden.textContent = hiddenCount > 0 ? `Show hidden (${hiddenCount})` : "Show hidden";
  }

  let list = state.questions.filter((q) => {
    if (matchSet && !matchSet.has(q.id)) return false;
    const p = getProgress(q.id);
    if (p.hidden && !f.showHidden) return false;
    if (f.status === "bookmarked") {
      if (!p.bookmarked) return false;
    } else if (f.status !== "all" && p.status !== f.status) {
      return false;
    }
    if (f.domain !== "all" && q.domain !== f.domain) return false;
    if (f.skill !== "all" && !q.skills.includes(f.skill)) return false;
    if (f.topic !== "all" && !q.topics.includes(f.topic)) return false;
    if (f.l6Only && !q.has_l6_signals) return false;
    if (f.l7Only && !q.has_l7_signals) return false;
    return true;
  });

  if (f.sortBy === "confidence_asc") {
    list = [...list].sort((a, b) => getProgress(a.id).confidence - getProgress(b.id).confidence);
  } else if (f.sortBy === "recent") {
    list = [...list].sort((a, b) => getProgress(b.id).updated_at - getProgress(a.id).updated_at);
  } else if (f.sortBy === "title") {
    list = [...list].sort((a, b) => a.title.localeCompare(b.title));
  } else if (f.sortBy === "id_desc") {
    list = [...list].sort((a, b) => b.id - a.id);
  }

  state.filteredQuestions = list;
  el.filteredCount.textContent = `${list.length} of ${state.questions.length} questions`;
  renderQuestionList();
}

function renderQuestionList() {
  el.questionList.replaceChildren();
  if (state.filteredQuestions.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted-text";
    empty.style.padding = "12px";
    empty.textContent = "No questions match the current filters.";
    el.questionList.appendChild(empty);
    return;
  }

  const frag = document.createDocumentFragment();
  for (const q of state.filteredQuestions) {
    const p = getProgress(q.id);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "q-list-item" +
      (q.id === state.activeQuestionId ? " active" : "") +
      (p.hidden ? " is-hidden-item" : "");
    btn.addEventListener("click", () => {
      openQuestion(q.id);
      setSidebarOpen(false);
    });

    const top = document.createElement("div");
    top.className = "q-item-top";

    const idGroup = document.createElement("span");
    idGroup.className = "q-item-id-group";
    const dot = document.createElement("span");
    dot.className = `status-dot status-${p.status}`;
    dot.title = STATUS_LABELS[p.status] || p.status;
    idGroup.appendChild(dot);
    idGroup.appendChild(document.createTextNode(`#${q.id}`));
    top.appendChild(idGroup);

    if (p.bookmarked) {
      const star = document.createElement("span");
      star.className = "bookmark-star";
      star.textContent = "★";
      star.title = "Bookmarked";
      top.appendChild(star);
    }

    const title = document.createElement("div");
    title.className = "q-item-title";
    title.textContent = q.title;

    const meta = document.createElement("div");
    meta.className = "q-item-meta";
    if (p.hidden) {
      const hid = document.createElement("span");
      hid.className = "mini-tag mini-tag-hidden";
      hid.textContent = "Hidden";
      meta.appendChild(hid);
    }
    if (q.has_l6_signals) {
      const l6 = document.createElement("span");
      l6.className = "mini-tag mini-tag-l6";
      l6.textContent = "L6 Rubric";
      meta.appendChild(l6);
    }
    if (q.has_l7_signals) {
      const l7 = document.createElement("span");
      l7.className = "mini-tag mini-tag-l7";
      l7.textContent = "L7 Rubric";
      meta.appendChild(l7);
    }
    for (const s of q.skills.slice(0, 2)) {
      const tag = document.createElement("span");
      tag.className = "mini-tag";
      tag.textContent = s;
      meta.appendChild(tag);
    }

    btn.appendChild(top);
    btn.appendChild(title);
    btn.appendChild(meta);
    frag.appendChild(btn);
  }
  el.questionList.appendChild(frag);
}

/* ---------- Dashboard ---------- */
function updateHeaderProgress() {
  let mastered = 0;
  for (const q of state.questions) {
    if (getProgress(q.id).status === "mastered") mastered += 1;
  }
  el.headerProgressPill.textContent = `${mastered} / ${state.questions.length} mastered`;
}

function renderDashboard() {
  const counts = { not_started: 0, studying: 0, needs_review: 0, mastered: 0, bookmarked: 0, with_notes: 0 };
  for (const q of state.questions) {
    const p = getProgress(q.id);
    counts[p.status] = (counts[p.status] || 0) + 1;
    if (p.bookmarked) counts.bookmarked += 1;
    if (p.notes.trim()) counts.with_notes += 1;
  }

  const statDefs = [
    { label: "Total Questions", value: state.questions.length },
    { label: "Mastered", value: counts.mastered },
    { label: "Studying", value: counts.studying },
    { label: "Needs Review", value: counts.needs_review },
    { label: "Bookmarked", value: counts.bookmarked },
    { label: "With Notes", value: counts.with_notes },
  ];

  el.statsGrid.replaceChildren();
  for (const s of statDefs) {
    const card = document.createElement("div");
    card.className = "stat-card";
    const val = document.createElement("div");
    val.className = "stat-value";
    val.textContent = String(s.value);
    const lbl = document.createElement("div");
    lbl.className = "stat-label";
    lbl.textContent = s.label;
    card.appendChild(val);
    card.appendChild(lbl);
    el.statsGrid.appendChild(card);
  }

  const renderBreakdown = (container, entries, onSelect) => {
    container.replaceChildren();
    for (const [name, info] of entries) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "breakdown-row";
      btn.addEventListener("click", () => onSelect(name));

      const head = document.createElement("div");
      head.className = "breakdown-row-head";
      const left = document.createElement("span");
      left.textContent = name;
      const right = document.createElement("span");
      right.className = "muted-text";
      right.textContent = `${info.mastered}/${info.total} mastered`;
      head.appendChild(left);
      head.appendChild(right);

      const track = document.createElement("div");
      track.className = "progress-track";
      const fill = document.createElement("div");
      fill.className = "progress-fill mastered";
      const pct = info.total > 0 ? Math.round((info.mastered / info.total) * 100) : 0;
      fill.style.width = `${pct}%`;
      track.appendChild(fill);

      btn.appendChild(head);
      btn.appendChild(track);
      container.appendChild(btn);
    }
  };

  const skillStats = new Map();
  const domainStats = new Map();
  for (const q of state.questions) {
    const isMastered = getProgress(q.id).status === "mastered" ? 1 : 0;
    const d = domainStats.get(q.domain) || { total: 0, mastered: 0 };
    d.total += 1;
    d.mastered += isMastered;
    domainStats.set(q.domain, d);

    for (const s of q.skills) {
      const cur = skillStats.get(s) || { total: 0, mastered: 0 };
      cur.total += 1;
      cur.mastered += isMastered;
      skillStats.set(s, cur);
    }
  }

  const topSkills = [...skillStats.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 12);
  const topDomains = [...domainStats.entries()].sort((a, b) => b[1].total - a[1].total);

  renderBreakdown(el.skillBreakdown, topSkills, (skillName) => {
    resetFiltersState();
    state.filters.skill = skillName;
    el.filterSkill.value = skillName;
    applyFilters();
    if (state.filteredQuestions.length > 0) openQuestion(state.filteredQuestions[0].id);
  });

  renderBreakdown(el.domainBreakdown, topDomains, (domainName) => {
    resetFiltersState();
    state.filters.domain = domainName;
    el.filterDomain.value = domainName;
    applyFilters();
    if (state.filteredQuestions.length > 0) openQuestion(state.filteredQuestions[0].id);
  });

  el.confidentialityNotice.textContent =
    state.manifest.confidentiality || "Confidential — personal study use only.";
  const activeBankInfo = state.banks.find((b) => b.id === state.activeBank);
  if (el.dashHeroTitle) {
    el.dashHeroTitle.textContent = activeBankInfo
      ? `${activeBankInfo.label} Study Guide`
      : "Interview Study Guide";
  }
  if (el.dashHeroSubtitle) {
    el.dashHeroSubtitle.textContent = `${state.questions.length} active interview questions with progressive hints, solutions, level-calibrated rubrics, and a persistent Gemini AI coach.`;
  }
  el.storageNotice.textContent = state.storageLabel
    ? `Durable storage: ${state.storageLabel} · Gemini: ${state.geminiModel}`
    : "";
  el.notesStorageHint.textContent = state.storageLabel
    ? `Auto-saved to ${state.storageLabel}`
    : "Auto-saved";
}

function showDashboard() {
  state.activeQuestionId = null;
  state.activeQuestionDetail = null;
  saveLastView(state.activeBank, null, null);
  el.questionView.classList.add("hidden");
  el.dashboardView.classList.remove("hidden");
  renderDashboard();
  renderQuestionList();
  window.location.hash = "";
}

/* ---------- Question Detail ---------- */
async function openQuestion(qid, initialTab) {
  state.activeQuestionId = qid;
  el.dashboardView.classList.add("hidden");
  el.questionView.classList.remove("hidden");
  renderQuestionList();
  window.location.hash = `q-${qid}`;

  const res = await fetch(apiUrl(`/api/questions/${qid}`));
  if (!res.ok) return;
  const q = await res.json();
  state.activeQuestionDetail = q;
  renderQuestionDetail();
  const targetTab = initialTab || "guide";
  setActiveTab(targetTab);
  loadChatThread(qid);
  restoreScrollForCurrentView();
}

function renderConfidenceStars(qid, currentValue) {
  el.qConfidenceStars.replaceChildren();
  for (let n = 1; n <= 5; n += 1) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "star-btn" + (n <= currentValue ? " filled" : "");
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", String(n === currentValue));
    btn.setAttribute("aria-label", `Confidence ${n} of 5`);
    btn.textContent = n <= currentValue ? "★" : "☆";
    btn.addEventListener("click", () => {
      const nextVal = n === currentValue ? 0 : n;
      renderConfidenceStars(qid, nextVal);
      saveProgress(qid, { confidence: nextVal });
    });
    el.qConfidenceStars.appendChild(btn);
  }
}

function createCollapsible(summaryText, mdContent, openByDefault) {
  const details = document.createElement("details");
  details.className = "collapsible";
  if (openByDefault) details.open = true;
  const summary = document.createElement("summary");
  summary.textContent = summaryText;
  details.appendChild(summary);
  const body = document.createElement("div");
  body.className = "collapsible-body";
  body.appendChild(renderMarkdown(mdContent));
  details.appendChild(body);
  return details;
}

function createSpoilerGate(title, description, onReveal) {
  const box = document.createElement("div");
  box.className = "spoiler-gate";
  const h = document.createElement("h3");
  h.style.margin = "0";
  h.textContent = title;
  const p = document.createElement("p");
  p.textContent = description;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-primary";
  btn.textContent = "Reveal Now";
  btn.addEventListener("click", onReveal);
  box.appendChild(h);
  box.appendChild(p);
  box.appendChild(btn);
  return box;
}

function renderQuestionDetail() {
  const q = state.activeQuestionDetail;
  if (!q) return;
  const p = getProgress(q.id);

  el.qIdBadge.textContent = `#${q.id}`;
  el.qDomainBadge.textContent = q.domain || "SWE";
  if (q.url && q.url.startsWith("https://")) {
    el.qCorpLink.setAttribute("href", q.url);
    el.qCorpLink.classList.remove("hidden");
  } else {
    el.qCorpLink.classList.add("hidden");
  }
  el.qTitle.textContent = q.title;

  el.qTags.replaceChildren();
  for (const s of q.skills || []) {
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.textContent = s;
    el.qTags.appendChild(pill);
  }
  for (const t of q.topics || []) {
    const pill = document.createElement("span");
    pill.className = "pill pill-topic";
    pill.textContent = t;
    el.qTags.appendChild(pill);
  }

  el.qStatusSelect.value = p.status;
  renderConfidenceStars(q.id, p.confidence);
  el.btnBookmark.textContent = p.bookmarked ? "★ Bookmarked" : "☆ Bookmark";
  el.btnHideQuestion.textContent = p.hidden ? "Unhide" : "Hide";
  el.btnHideQuestion.classList.toggle("btn-active-mode", p.hidden);
  el.qNotesInput.value = p.notes;

  renderProblemPanel(q);
  renderHintsPanel(q);
  renderSolutionPanel(q);
  renderRubricPanel(q);
  renderStudyGuidePanel(q);
  renderRelatedQuestions(q);
  renderChatMessages(q.id);
}

function renderProblemPanel(q) {
  el.panelProblem.replaceChildren();

  if (q.intro_md && q.intro_md.trim()) {
    const introCard = document.createElement("div");
    introCard.className = "section-card";
    const h = document.createElement("h2");
    h.textContent = "Context & Interview Scope";
    introCard.appendChild(h);
    introCard.appendChild(renderMarkdown(q.intro_md));
    el.panelProblem.appendChild(introCard);
  }

  const mainCard = document.createElement("div");
  mainCard.className = "section-card";
  const mh = document.createElement("h2");
  mh.textContent = q.main_question?.title || "Main Question";
  mainCard.appendChild(mh);
  mainCard.appendChild(renderMarkdown(q.main_question?.question_md || "_No main prompt available._"));

  if (q.main_question?.assume_md && q.main_question.assume_md.trim()) {
    mainCard.appendChild(
      createCollapsible("Assumptions & Clarifying Details", q.main_question.assume_md, true)
    );
  }
  el.panelProblem.appendChild(mainCard);

  if (q.follow_ups && q.follow_ups.length > 0) {
    const fuWrap = document.createElement("div");
    fuWrap.className = "section-card";
    const fh = document.createElement("h2");
    fh.textContent = `Follow-up Questions (${q.follow_ups.length})`;
    fuWrap.appendChild(fh);

    q.follow_ups.forEach((fu, idx) => {
      const sub = document.createElement("div");
      sub.style.paddingTop = idx === 0 ? "4px" : "16px";
      if (idx > 0) {
        sub.style.marginTop = "16px";
        sub.style.borderTop = "1px solid var(--border)";
      }
      const sh = document.createElement("h3");
      sh.textContent = fu.title ? `${idx + 1}. ${fu.title}` : `Follow-up ${idx + 1}`;
      sub.appendChild(sh);
      sub.appendChild(renderMarkdown(fu.question_md || ""));
      if (fu.assume_md && fu.assume_md.trim()) {
        sub.appendChild(createCollapsible("Follow-up Assumptions", fu.assume_md, true));
      }
      if (fu.hints_md && fu.hints_md.trim()) {
        sub.appendChild(createCollapsible("Follow-up Hints", fu.hints_md, true));
      }
      fuWrap.appendChild(sub);
    });
    el.panelProblem.appendChild(fuWrap);
  }
}

function renderHintsPanel(q) {
  el.panelHints.replaceChildren();
  const hasMainHints = Boolean(q.main_question?.hints_md && q.main_question.hints_md.trim());
  const fuHints = (q.follow_ups || []).filter((f) => f.hints_md && f.hints_md.trim());

  if (!hasMainHints && fuHints.length === 0) {
    const card = document.createElement("div");
    card.className = "section-card";
    const p = document.createElement("p");
    p.className = "muted-text";
    p.textContent = "No interviewer hints or prompts are listed for this question. Try asking Gemini in Socratic mode!";
    card.appendChild(p);
    el.panelHints.appendChild(card);
    return;
  }

  if (hasMainHints) {
    const card = document.createElement("div");
    card.className = "section-card";
    const h = document.createElement("h2");
    h.textContent = "Main Question Hints & Pacing";
    card.appendChild(h);
    card.appendChild(renderMarkdown(q.main_question.hints_md));
    el.panelHints.appendChild(card);
  }

  fuHints.forEach((fu, idx) => {
    const card = document.createElement("div");
    card.className = "section-card";
    const h = document.createElement("h3");
    h.textContent = fu.title ? `Hints: ${fu.title}` : `Follow-up ${idx + 1} Hints`;
    card.appendChild(h);
    card.appendChild(renderMarkdown(fu.hints_md));
    el.panelHints.appendChild(card);
  });
}

function renderSolutionPanel(q) {
  el.panelSolution.replaceChildren();
  const desc = q.solution?.description_md || "";
  const snippets = q.solution?.code_snippets || [];

  if (!desc.trim() && snippets.length === 0) {
    const card = document.createElement("div");
    card.className = "section-card";
    const p = document.createElement("p");
    p.className = "muted-text";
    p.textContent = "No written solution guide is included for this question. Check the L6 Rubric tab or ask Gemini!";
    card.appendChild(p);
    el.panelSolution.appendChild(card);
    return;
  }

  if (desc.trim()) {
    const card = document.createElement("div");
    card.className = "section-card";
    const h = document.createElement("h2");
    h.textContent = "Solution Walkthrough";
    card.appendChild(h);
    card.appendChild(renderMarkdown(desc));
    el.panelSolution.appendChild(card);
  }

  const needsGeneratedPy = Boolean(q.solution?.needs_generated_python);
  if (snippets.length > 0 || needsGeneratedPy) {
    const card = document.createElement("div");
    card.className = "section-card";
    const h = document.createElement("h2");
    h.textContent = "Reference Code Implementations";
    card.appendChild(h);

    const tabs = document.createElement("div");
    tabs.className = "snippet-tabs";
    const body = document.createElement("div");

    const setActiveSnippetTab = (activeBtn) => {
      Array.from(tabs.children).forEach((b) => {
        b.classList.toggle("active", b === activeBtn);
      });
    };

    const showSnippet = (index, btn) => {
      setActiveSnippetTab(btn);
      body.replaceChildren();
      const s = snippets[index];
      const raw = (s.code_md || "").trim();
      body.appendChild(renderMarkdown(raw, s.language || ""));
    };

    const renderGeneratedPython = (genData, btn) => {
      setActiveSnippetTab(btn);
      body.replaceChildren();

      const banner = document.createElement("div");
      banner.className = "generated-code-banner";
      const info = document.createElement("span");
      const srcLangs = (genData.source_languages || []).join(", ") || "Java/Go/C++";
      info.textContent = `✦ AI-Generated Python (${genData.model || state.geminiModel}) — translated from original ${srcLangs}; not originally included in go/iq.`;
      banner.appendChild(info);

      const regenBtn = document.createElement("button");
      regenBtn.type = "button";
      regenBtn.className = "btn btn-sm";
      regenBtn.textContent = "Regenerate";
      regenBtn.addEventListener("click", () => fetchGeneratedPython(true, btn));
      banner.appendChild(regenBtn);

      body.appendChild(banner);
      body.appendChild(renderMarkdown(genData.code_md || ""));
    };

    const fetchGeneratedPython = async (force, btn) => {
      setActiveSnippetTab(btn);
      body.replaceChildren();
      const loading = document.createElement("div");
      loading.className = "generated-code-banner";
      loading.textContent = `✦ Generating idiomatic Python translation from Java/Go/C++ via ${state.geminiModel}...`;
      body.appendChild(loading);

      try {
        const res = await fetch(apiUrl(`/api/questions/${q.id}/python`), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": state.csrfToken,
          },
          body: JSON.stringify({ force: Boolean(force) }),
        });
        const data = await res.json();
        if (!res.ok) {
          body.replaceChildren();
          const err = document.createElement("p");
          err.className = "muted-text";
          err.textContent = data.error || "Failed to generate Python translation.";
          body.appendChild(err);
          return;
        }
        q.solution.generated_python = data;
        if (state.activeQuestionId === q.id) {
          renderGeneratedPython(data, btn);
        }
      } catch {
        body.replaceChildren();
        const err = document.createElement("p");
        err.className = "muted-text";
        err.textContent = "Network error while generating Python translation.";
        body.appendChild(err);
      }
    };

    snippets.forEach((s, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "snippet-tab";
      btn.textContent = s.language || `Snippet ${idx + 1}`;
      btn.addEventListener("click", () => showSnippet(idx, btn));
      tabs.appendChild(btn);
    });

    if (needsGeneratedPy) {
      const pyBtn = document.createElement("button");
      pyBtn.type = "button";
      pyBtn.className = "snippet-tab snippet-tab-generated";
      pyBtn.textContent = "✦ Python (AI-Generated)";
      pyBtn.addEventListener("click", () => {
        if (q.solution?.generated_python) {
          renderGeneratedPython(q.solution.generated_python, pyBtn);
        } else {
          fetchGeneratedPython(false, pyBtn);
        }
      });
      tabs.appendChild(pyBtn);
    }

    card.appendChild(tabs);
    card.appendChild(body);
    if (snippets.length > 0) {
      showSnippet(0, tabs.children[0]);
    } else if (needsGeneratedPy) {
      const pyBtn = tabs.children[0];
      if (q.solution?.generated_python) {
        renderGeneratedPython(q.solution.generated_python, pyBtn);
      } else {
        const hint = document.createElement("p");
        hint.className = "muted-text";
        hint.textContent = "Click \"✦ Python (AI-Generated)\" above to translate the solution code into Python.";
        body.appendChild(hint);
      }
    }
    el.panelSolution.appendChild(card);
  }
}

function renderRubricPanel(q) {
  el.panelRubric.replaceChildren();
  const levels = q.level_signals || [];

  if (levels.length === 0) {
    const card = document.createElement("div");
    card.className = "section-card";
    const p = document.createElement("p");
    p.className = "muted-text";
    p.textContent = "No level-specific rubric signals are listed for this question.";
    card.appendChild(p);
    el.panelRubric.appendChild(card);
    return;
  }

  const sorted = [...levels].sort((a, b) => {
    if (a.level === 6) return -1;
    if (b.level === 6) return 1;
    return (b.level || 0) - (a.level || 0);
  });

  for (const ls of sorted) {
    const isL6 = ls.level === 6;
    const card = document.createElement("div");
    card.className = isL6 ? "section-card section-card-l6" : "section-card";

    if (isL6) {
      const badge = document.createElement("div");
      badge.className = "l6-banner";
      badge.textContent = "★ TARGET LEVEL: SWE L6 SIGNALS";
      card.appendChild(badge);
    }

    const h = document.createElement("h2");
    h.textContent = `Level ${ls.level} Expectations`;
    card.appendChild(h);

    for (const ss of ls.skill_signals || []) {
      const sh = document.createElement("h3");
      sh.textContent = ss.skill_name || "General Signal";
      card.appendChild(sh);

      const ul = document.createElement("ul");
      ul.style.paddingLeft = "1.4em";
      for (const sigMd of ss.signals || []) {
        const li = document.createElement("li");
        li.style.marginBottom = "8px";
        li.appendChild(renderMarkdown(sigMd));
        ul.appendChild(li);
      }
      card.appendChild(ul);
    }

    el.panelRubric.appendChild(card);
  }
}

function renderStudyGuidePanel(q) {
  el.panelGuide.replaceChildren();

  const fetchGuide = async (force) => {
    el.panelGuide.replaceChildren();
    const loading = document.createElement("div");
    loading.className = "generated-code-banner";
    loading.textContent = `✦ Generating structured Study Guide via ${state.geminiModel}...`;
    el.panelGuide.appendChild(loading);
    try {
      const res = await fetch(apiUrl(`/api/questions/${q.id}/study-guide`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": state.csrfToken,
        },
        body: JSON.stringify({ force: Boolean(force) }),
      });
      const data = await res.json();
      if (!res.ok) {
        el.panelGuide.replaceChildren();
        const err = document.createElement("p");
        err.className = "muted-text";
        err.textContent = data.error || "Failed to generate study guide.";
        el.panelGuide.appendChild(err);
        return;
      }
      q.study_guide = data;
      if (state.activeQuestionId === q.id) {
        renderStudyGuidePanel(q);
      }
    } catch {
      el.panelGuide.replaceChildren();
      const err = document.createElement("p");
      err.className = "muted-text";
      err.textContent = "Network error while generating study guide.";
      el.panelGuide.appendChild(err);
    }
  };

  if (!q.study_guide || !q.study_guide.guide_md) {
    const box = document.createElement("div");
    box.className = "spoiler-gate";
    const h = document.createElement("h3");
    h.style.margin = "0";
    h.textContent = "No Study Guide Cached Yet";
    const p = document.createElement("p");
    p.textContent = "Generate a tailored 6-section study guide (framing, trade-off matrix, API design, follow-ups, dry-run checklist, and L5/L6 calibration) for this question.";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-primary";
    btn.textContent = "✦ Generate Study Guide";
    btn.addEventListener("click", () => fetchGuide(false));
    box.appendChild(h);
    box.appendChild(p);
    box.appendChild(btn);
    el.panelGuide.appendChild(box);
    return;
  }

  const card = document.createElement("div");
  card.className = "section-card";

  const banner = document.createElement("div");
  banner.className = "generated-code-banner";
  const info = document.createElement("span");
  info.textContent = `✦ Structured Study Guide (${q.study_guide.model || state.geminiModel}) — cached in ${state.storageLabel || "storage"}`;
  banner.appendChild(info);

  const regenBtn = document.createElement("button");
  regenBtn.type = "button";
  regenBtn.className = "btn btn-sm";
  regenBtn.textContent = "Regenerate";
  regenBtn.addEventListener("click", () => fetchGuide(true));
  banner.appendChild(regenBtn);

  card.appendChild(banner);
  card.appendChild(renderMarkdown(q.study_guide.guide_md));
  el.panelGuide.appendChild(card);
}

function renderRelatedQuestions(q) {
  const ids = (q.related_question_ids || []).filter((id) => state.questionsById.has(id));
  if (ids.length === 0) {
    el.relatedQuestionsBox.classList.add("hidden");
    return;
  }
  el.relatedQuestionsBox.classList.remove("hidden");
  el.relatedQuestionsList.replaceChildren();
  for (const id of ids) {
    const rq = state.questionsById.get(id);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-sm";
    btn.textContent = `#${rq.id} — ${rq.title}`;
    btn.addEventListener("click", () => openQuestion(rq.id));
    el.relatedQuestionsList.appendChild(btn);
  }
}

function setActiveTab(tabName) {
  state.activeTab = tabName;
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    const active = btn.dataset.tab === tabName;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", String(active));
  });
  const panels = {
    problem: el.panelProblem,
    hints: el.panelHints,
    solution: el.panelSolution,
    rubric: el.panelRubric,
    guide: el.panelGuide,
    notes: el.panelNotes,
    gemini: el.panelGemini,
  };
  for (const [key, panel] of Object.entries(panels)) {
    panel.classList.toggle("hidden", key !== tabName);
  }
  if (state.activeQuestionId !== null) {
    saveLastView(state.activeBank, state.activeQuestionId, tabName);
    restoreScrollForCurrentView();
  }
  if (tabName === "gemini" && state.activeQuestionId !== null) {
    renderChatMessages(state.activeQuestionId);
  }
}

function navigateRelative(delta) {
  if (state.filteredQuestions.length === 0) return;
  if (state.activeQuestionId === null) {
    openQuestion(state.filteredQuestions[0].id);
    return;
  }
  const idx = state.filteredQuestions.findIndex((q) => q.id === state.activeQuestionId);
  const nextIdx = idx === -1 ? 0 : (idx + delta + state.filteredQuestions.length) % state.filteredQuestions.length;
  openQuestion(state.filteredQuestions[nextIdx].id);
}

function pickRandomQuestion() {
  const pool = state.filteredQuestions.filter((q) => getProgress(q.id).status !== "mastered");
  const candidates = pool.length > 0 ? pool : state.filteredQuestions;
  if (candidates.length === 0) return;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  openQuestion(pick.id);
}

function resetFiltersState() {
  state.filters = {
    query: "",
    status: "all",
    domain: "all",
    skill: "all",
    topic: "all",
    l6Only: false,
    l7Only: false,
    showHidden: false,
    sortBy: "default",
  };
  state.searchMatchIds = null;
  el.searchInput.value = "";
  el.filterStatus.value = "all";
  el.filterDomain.value = "all";
  el.filterSkill.value = "all";
  el.filterTopic.value = "all";
  el.filterL6Only.checked = false;
  el.filterL7Only.checked = false;
  el.filterShowHidden.checked = false;
  el.sortBy.value = "default";
}

function exportProgressJson() {
  const blob = new Blob([JSON.stringify(state.progress, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.setAttribute("href", url);
  a.setAttribute("download", "swe6-study-progress.json");
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ---------- Events ---------- */
function bindEvents() {
  el.btnToggleSidebar.addEventListener("click", () => setSidebarOpen(!el.sidebar.classList.contains("open")));
  el.btnCloseSidebar.addEventListener("click", () => setSidebarOpen(false));
  el.sidebarBackdrop.addEventListener("click", () => setSidebarOpen(false));
  el.btnHome.addEventListener("click", showDashboard);
  if (el.bankSelect) {
    el.bankSelect.addEventListener("change", () => switchBank(el.bankSelect.value));
  }
  el.btnBackDash.addEventListener("click", showDashboard);
  el.btnTheme.addEventListener("click", cycleTheme);
  el.btnTimerToggle.addEventListener("click", toggleTimer);
  el.btnTimerReset.addEventListener("click", resetTimer);
  el.btnRandomPick.addEventListener("click", pickRandomQuestion);
  el.btnPrevQ.addEventListener("click", () => navigateRelative(-1));
  el.btnNextQ.addEventListener("click", () => navigateRelative(1));

  el.btnShortcuts.addEventListener("click", () => el.dialogShortcuts.showModal());
  el.btnOpenReset.addEventListener("click", () => el.dialogReset.showModal());
  el.btnClearChat.addEventListener("click", () => el.dialogClearChat.showModal());
  el.btnExportProgress.addEventListener("click", exportProgressJson);

  document.querySelectorAll("[data-close-dialog]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dlg = document.getElementById(btn.dataset.closeDialog);
      if (dlg && dlg.open) dlg.close();
    });
  });

  [el.dialogShortcuts, el.dialogReset, el.dialogClearChat].forEach((dlg) => {
    dlg.addEventListener("click", (ev) => {
      if (ev.target === dlg) dlg.close();
    });
  });

  el.btnConfirmReset.addEventListener("click", async () => {
    const res = await fetch(apiUrl("/api/progress/reset"), {
      method: "POST",
      headers: { "X-CSRF-Token": state.csrfToken },
    });
    if (res.ok) {
      state.progress = {};
      updateHeaderProgress();
      applyFilters();
      renderDashboard();
      if (state.activeQuestionDetail) renderQuestionDetail();
    }
    el.dialogReset.close();
  });

  el.btnConfirmClearChat.addEventListener("click", async () => {
    const qid = state.activeQuestionId;
    if (qid !== null) {
      const res = await fetch(apiUrl(`/api/chat/${qid}/clear`), {
        method: "POST",
        headers: { "X-CSRF-Token": state.csrfToken },
      });
      if (res.ok) {
        state.chatByQuestion.set(qid, []);
        renderChatMessages(qid);
      }
    }
    el.dialogClearChat.close();
  });

  // Gemini Coach mode & quick prompts
  [el.btnCoachTutor, el.btnCoachSocratic].forEach((btn) => {
    btn.addEventListener("click", () => {
      state.coachMode = btn.dataset.coach;
      el.btnCoachTutor.classList.toggle("active", state.coachMode === "tutor");
      el.btnCoachSocratic.classList.toggle("active", state.coachMode === "socratic");
    });
  });

  el.quickPrompts.querySelectorAll(".chip-btn").forEach((chip) => {
    chip.addEventListener("click", () => {
      sendChatMessage(chip.dataset.prompt || "");
    });
  });

  el.chatForm.addEventListener("submit", (ev) => {
    ev.preventDefault();
    sendChatMessage(el.chatInput.value);
  });

  el.chatInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      sendChatMessage(el.chatInput.value);
    }
  });

  // Dashboard quick-start buttons
  el.btnStartSysarch.addEventListener("click", () => {
    resetFiltersState();
    state.filters.skill = "Systems Architecture";
    el.filterSkill.value = "Systems Architecture";
    applyFilters();
    pickRandomQuestion();
  });

  el.btnStartDsa.addEventListener("click", () => {
    resetFiltersState();
    state.filters.skill = "Data Structures & Algorithms";
    el.filterSkill.value = "Data Structures & Algorithms";
    applyFilters();
    pickRandomQuestion();
  });

  el.btnStartReview.addEventListener("click", () => {
    resetFiltersState();
    state.filters.status = "needs_review";
    el.filterStatus.value = "needs_review";
    applyFilters();
    if (state.filteredQuestions.length > 0) {
      openQuestion(state.filteredQuestions[0].id);
    } else {
      resetFiltersState();
      applyFilters();
      pickRandomQuestion();
    }
  });

  // Debounced full-text search
  let searchTimer = null;
  el.searchInput.addEventListener("input", () => {
    const q = el.searchInput.value.trim();
    state.filters.query = q;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      if (!q) {
        state.searchMatchIds = null;
        applyFilters();
        return;
      }
      const res = await fetch(apiUrl(`/api/search?q=${encodeURIComponent(q)}`));
      if (res.ok) {
        const data = await res.json();
        state.searchMatchIds = data.ids || [];
        applyFilters();
      }
    }, 180);
  });

  el.filterStatus.addEventListener("change", () => { state.filters.status = el.filterStatus.value; applyFilters(); });
  el.filterDomain.addEventListener("change", () => { state.filters.domain = el.filterDomain.value; applyFilters(); });
  el.filterSkill.addEventListener("change", () => { state.filters.skill = el.filterSkill.value; applyFilters(); });
  el.filterTopic.addEventListener("change", () => { state.filters.topic = el.filterTopic.value; applyFilters(); });
  el.filterL6Only.addEventListener("change", () => { state.filters.l6Only = el.filterL6Only.checked; applyFilters(); });
  el.filterL7Only.addEventListener("change", () => { state.filters.l7Only = el.filterL7Only.checked; applyFilters(); });
  el.filterShowHidden.addEventListener("change", () => { state.filters.showHidden = el.filterShowHidden.checked; applyFilters(); });
  el.sortBy.addEventListener("change", () => { state.filters.sortBy = el.sortBy.value; applyFilters(); });
  el.btnClearFilters.addEventListener("click", () => { resetFiltersState(); applyFilters(); });

  el.qStatusSelect.addEventListener("change", () => {
    if (state.activeQuestionId !== null) {
      saveProgress(state.activeQuestionId, { status: el.qStatusSelect.value });
    }
  });

  el.btnBookmark.addEventListener("click", () => {
    if (state.activeQuestionId === null) return;
    const next = !getProgress(state.activeQuestionId).bookmarked;
    el.btnBookmark.textContent = next ? "★ Bookmarked" : "☆ Bookmark";
    saveProgress(state.activeQuestionId, { bookmarked: next });
  });

  el.btnHideQuestion.addEventListener("click", () => {
    if (state.activeQuestionId === null) return;
    const next = !getProgress(state.activeQuestionId).hidden;
    el.btnHideQuestion.textContent = next ? "Unhide" : "Hide";
    el.btnHideQuestion.classList.toggle("btn-active-mode", next);
    saveProgress(state.activeQuestionId, { hidden: next });
  });

  let noteSaveTimer = null;
  el.qNotesInput.addEventListener("input", () => {
    if (state.activeQuestionId === null) return;
    const qid = state.activeQuestionId;
    const text = el.qNotesInput.value;
    clearTimeout(noteSaveTimer);
    noteSaveTimer = setTimeout(() => {
      saveProgress(qid, { notes: text });
    }, 450);
  });

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
  });

  // Persist scroll position per (bank, question, tab) so we jump back to the last section
  const mainEl = document.getElementById("main-content");
  if (mainEl) {
    let scrollSaveTimer = null;
    mainEl.addEventListener(
      "scroll",
      () => {
        if (state.activeQuestionId === null) return;
        const bank = state.activeBank;
        const qid = state.activeQuestionId;
        const tab = state.activeTab;
        clearTimeout(scrollSaveTimer);
        scrollSaveTimer = setTimeout(() => {
          saveScrollPosition(bank, qid, tab, mainEl.scrollTop);
        }, 150);
      },
      { passive: true }
    );
  }

  // Keyboard shortcuts
  document.addEventListener("keydown", (ev) => {
    if (!state.authenticated) return;
    const tag = document.activeElement?.tagName;
    const inInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

    if (ev.key === "Escape" && inInput) {
      document.activeElement.blur();
      return;
    }
    if (inInput || ev.metaKey || ev.ctrlKey || ev.altKey) return;

    if (ev.key === "/") {
      ev.preventDefault();
      el.searchInput.focus();
    } else if (ev.key === "?") {
      ev.preventDefault();
      if (!el.dialogShortcuts.open) el.dialogShortcuts.showModal();
    } else if (ev.key === "j") {
      navigateRelative(1);
    } else if (ev.key === "k") {
      navigateRelative(-1);
    } else if (ev.key === "t") {
      toggleTimer();
    } else if (ev.key === "b" && state.activeQuestionId !== null) {
      el.btnBookmark.click();
    } else if (ev.key === "h" && state.activeQuestionId !== null) {
      el.btnHideQuestion.click();
    } else if (state.activeQuestionId !== null && ["1", "2", "3", "4", "5", "6", "7"].includes(ev.key)) {
      const map = ["problem", "hints", "solution", "rubric", "guide", "notes", "gemini"];
      setActiveTab(map[Number(ev.key) - 1]);
    }
  });
}

/* ---------- Keypad Auth & Lockout ---------- */
function renderPinDots() {
  const dots = el.pinDots.querySelectorAll(".pin-dot");
  dots.forEach((dot, idx) => {
    dot.classList.toggle("filled", idx < state.pinBuffer.length);
  });
}

function setKeypadDisabled(disabled) {
  el.keypadGrid.querySelectorAll("button").forEach((btn) => {
    btn.disabled = disabled;
  });
}

function updateLockoutCountdown() {
  const nowSec = Math.floor(Date.now() / 1000);
  const remaining = Math.max(0, state.lockoutUntil - nowSec);
  if (remaining <= 0) {
    clearInterval(state.lockoutTimerId);
    state.lockoutTimerId = null;
    state.lockoutUntil = 0;
    setKeypadDisabled(false);
    el.lockSubtitle.textContent = "Enter 4-digit passcode to unlock";
    el.lockMessage.textContent = "";
    return;
  }
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  setKeypadDisabled(true);
  el.lockSubtitle.textContent = "Login temporarily disabled";
  el.lockMessage.textContent = `Too many failed attempts. Try again in ${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function applyLockout(lockedUntilUnix) {
  if (state.lockoutTimerId) {
    clearInterval(state.lockoutTimerId);
    state.lockoutTimerId = null;
  }
  state.lockoutUntil = lockedUntilUnix || 0;
  if (state.lockoutUntil > Math.floor(Date.now() / 1000)) {
    updateLockoutCountdown();
    state.lockoutTimerId = setInterval(updateLockoutCountdown, 1000);
  } else {
    setKeypadDisabled(false);
  }
}

function shakePinDots() {
  el.pinDots.classList.remove("shake");
  void el.pinDots.offsetWidth;
  el.pinDots.classList.add("shake");
}

function handlePinDigit(digit) {
  if (state.authenticated || state.pinSubmitting || state.lockoutUntil > Math.floor(Date.now() / 1000)) {
    return;
  }
  if (state.pinBuffer.length >= 4) return;
  state.pinBuffer += digit;
  el.lockMessage.textContent = "";
  renderPinDots();
  if (state.pinBuffer.length === 4) {
    submitPin(state.pinBuffer);
  }
}

async function submitPin(code) {
  state.pinSubmitting = true;
  setKeypadDisabled(true);
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": state.csrfToken,
      },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    if (res.ok && data.authenticated) {
      state.authenticated = true;
      state.pinBuffer = "";
      renderPinDots();
      el.lockScreen.classList.add("hidden");
      el.appShell.classList.remove("hidden");
      await bootAuthenticatedApp();
      return;
    }

    state.pinBuffer = "";
    renderPinDots();
    shakePinDots();
    if (res.status === 429 && data.locked_until) {
      applyLockout(data.locked_until);
    } else {
      el.lockMessage.textContent = data.error || "Incorrect code.";
      setKeypadDisabled(false);
    }
  } catch {
    state.pinBuffer = "";
    renderPinDots();
    el.lockMessage.textContent = "Connection error. Please try again.";
    setKeypadDisabled(false);
  } finally {
    state.pinSubmitting = false;
  }
}

async function handleLogout() {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "X-CSRF-Token": state.csrfToken },
    });
  } finally {
    window.location.reload();
  }
}

function bindKeypadEvents() {
  el.keypadGrid.querySelectorAll("[data-digit]").forEach((btn) => {
    btn.addEventListener("click", () => handlePinDigit(btn.dataset.digit));
  });
  el.btnPinClear.addEventListener("click", () => {
    if (state.pinSubmitting) return;
    state.pinBuffer = "";
    renderPinDots();
  });
  el.btnPinBack.addEventListener("click", () => {
    if (state.pinSubmitting) return;
    state.pinBuffer = state.pinBuffer.slice(0, -1);
    renderPinDots();
  });
  el.btnLockApp.addEventListener("click", handleLogout);

  // Allow typing digits on Desktop Chrome when lock screen is visible
  document.addEventListener("keydown", (ev) => {
    if (state.authenticated || el.lockScreen.classList.contains("hidden")) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (/^[0-9]$/.test(ev.key)) {
      ev.preventDefault();
      handlePinDigit(ev.key);
    } else if (ev.key === "Backspace") {
      ev.preventDefault();
      if (!state.pinSubmitting) {
        state.pinBuffer = state.pinBuffer.slice(0, -1);
        renderPinDots();
      }
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      if (!state.pinSubmitting) {
        state.pinBuffer = "";
        renderPinDots();
      }
    }
  });
}

/* ---------- Boot ---------- */
async function bootAuthenticatedApp() {
  try {
    const savedBank = localStorage.getItem("swe6_active_bank");
    await fetchBootstrap(savedBank || "fde");
    if (state.authEnabled) {
      el.btnLockApp.classList.remove("hidden");
    }
    populateFilterDropdowns();
    updateHeaderProgress();
    applyFilters();

    const hashMatch = window.location.hash.match(/^#q-(\d+)$/);
    const lastView = getLastView(state.activeBank);
    if (hashMatch && state.questionsById.has(Number(hashMatch[1]))) {
      const qid = Number(hashMatch[1]);
      const tab = lastView && lastView.qid === qid ? lastView.tab : "guide";
      openQuestion(qid, tab);
    } else if (lastView && state.questionsById.has(lastView.qid)) {
      openQuestion(lastView.qid, lastView.tab);
    } else {
      showDashboard();
    }
  } catch {
    el.filteredCount.textContent = "Failed to load questions.";
  }
}

async function init() {
  initTheme();
  renderTimer();
  bindEvents();
  bindKeypadEvents();

  try {
    const res = await fetch("/api/auth/status");
    const status = await res.json();
    state.csrfToken = status.csrf_token || "";
    state.authEnabled = Boolean(status.auth_enabled);
    state.authenticated = Boolean(status.authenticated);

    if (state.authenticated) {
      el.lockScreen.classList.add("hidden");
      el.appShell.classList.remove("hidden");
      await bootAuthenticatedApp();
    } else {
      el.appShell.classList.add("hidden");
      el.lockScreen.classList.remove("hidden");
      if (status.locked_until && status.retry_after_sec > 0) {
        applyLockout(status.locked_until);
      } else if (status.attempts_remaining > 0 && status.attempts_remaining < 3) {
        el.lockMessage.textContent = `${status.attempts_remaining} attempt(s) remaining.`;
      }
    }
  } catch {
    el.lockScreen.classList.remove("hidden");
    el.lockMessage.textContent = "Unable to connect to server.";
  }
}

init();
