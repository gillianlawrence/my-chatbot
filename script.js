// =====================================================================
//  This file makes the chatbot work.
//  You don't need to edit it. Change your bot's settings in config.js.
// =====================================================================

// ---------- Grab the parts of the page ----------
const messagesEl = document.getElementById("messages");
const startersEl = document.getElementById("starters");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("sendBtn");
const newChatBtn = document.getElementById("newChatBtn");
const keyBtn = document.getElementById("keyBtn");
const keyModal = document.getElementById("keyModal");
const keyInput = document.getElementById("keyInput");
const rememberBox = document.getElementById("rememberBox");
const keySave = document.getElementById("keySave");
const keyCancel = document.getElementById("keyCancel");
const statusEl = document.getElementById("knowledgeStatus");

// Adds a listener only if the element exists, so one missing piece of the
// page can't stop the whole chatbot from starting.
function on(element, eventName, handler) {
  if (element) element.addEventListener(eventName, handler);
}

// The conversation so far, in the format Gemini expects.
// (This only ever holds your plain questions, never the notes.)
let history = [];
let isWaiting = false;

const CHAT_KEY = "bitebuddy_chat"; // where the saved conversation lives

// ---------- Set up the page from config.js ----------
function setText(id, value) {
  const el = document.getElementById(id);
  if (el && value !== undefined) el.textContent = value;
}

function applyConfig() {
  document.title = BOT_CONFIG.name;
  setText("botName", BOT_CONFIG.name);
  setText("botEmoji", BOT_CONFIG.emoji);
  setText("botTagline", BOT_CONFIG.tagline);
  if (BOT_CONFIG.themeColor) {
    document.documentElement.style.setProperty("--accent", BOT_CONFIG.themeColor);
  }
}

// ---------- API key storage (wrapped in try/catch) ----------
function getKey() {
  try {
    const sessionKey = sessionStorage.getItem("gemini_api_key");
    if (sessionKey) return sessionKey;
  } catch (e) { /* storage not available */ }
  try {
    const savedKey = localStorage.getItem("gemini_api_key");
    if (savedKey) return savedKey;
  } catch (e) { /* storage not available */ }
  return "";
}

function saveKey(key, remember) {
  try { sessionStorage.setItem("gemini_api_key", key); } catch (e) { /* ignore */ }
  try {
    if (remember) {
      localStorage.setItem("gemini_api_key", key);
    } else {
      localStorage.removeItem("gemini_api_key");
    }
  } catch (e) { /* ignore */ }
}

function openKeyModal() {
  keyInput.value = "";
  let remembered = false;
  try { remembered = !!localStorage.getItem("gemini_api_key"); } catch (e) { /* ignore */ }
  rememberBox.checked = remembered;
  keyModal.hidden = false;
  keyInput.focus();
}

function closeKeyModal() {
  keyModal.hidden = true;
}

on(keyBtn, "click", openKeyModal);
on(keyCancel, "click", closeKeyModal);
on(keyModal, "click", (e) => {
  if (e.target === keyModal) closeKeyModal();
});
on(keySave, "click", () => {
  const key = keyInput.value.trim();
  if (!key) return;
  saveKey(key, rememberBox.checked);
  closeKeyModal();
  addBubble("bot", "Key saved! Ask me anything. 🎉");
  initKnowledge(); // now that there is a key, load / prepare the notes
});
on(keyInput, "keydown", (e) => {
  if (e.key === "Enter") keySave.click();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && keyModal && !keyModal.hidden) closeKeyModal();
});

// ---------- Safe text formatting ----------
// Step 1: escape HTML so nothing sneaky can run. Step 2: add bold + bullets.
function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatText(text) {
  const lines = escapeHtml(text).split("\n");
  let html = "";
  let inList = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const bulletMatch = line.match(/^[*\-•]\s+(.*)$/);

    if (bulletMatch) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += "<li>" + bold(bulletMatch[1]) + "</li>";
    } else {
      if (inList) { html += "</ul>"; inList = false; }
      if (line !== "") html += "<p>" + bold(line) + "</p>";
    }
  }
  if (inList) html += "</ul>";
  return html;
}

function bold(text) {
  return text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

// ---------- Chat bubbles ----------
function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addBubble(kind, text) {
  const div = document.createElement("div");
  div.className = "bubble " + kind;
  if (kind === "user") {
    div.textContent = text; // user text is shown as plain text
  } else {
    div.innerHTML = formatText(text);
  }
  messagesEl.appendChild(div);
  scrollToBottom();
  return div;
}

// ---------- Copy button ----------
// Adds a small "Copy" button to the bottom of a bot reply.
function addCopyButton(bubble, text) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "copy-btn";
  btn.textContent = "📋 Copy";

  btn.addEventListener("click", async () => {
    // Remove the **bold** markers so the copied text is clean
    const plain = text.replace(/\*\*/g, "");
    let copied = false;

    try {
      await navigator.clipboard.writeText(plain);
      copied = true;
    } catch (e) {
      // Older-browser fallback
      try {
        const temp = document.createElement("textarea");
        temp.value = plain;
        temp.style.position = "fixed";
        temp.style.opacity = "0";
        document.body.appendChild(temp);
        temp.select();
        copied = document.execCommand("copy");
        temp.remove();
      } catch (e2) { /* ignore */ }
    }

    btn.textContent = copied ? "✅ Copied!" : "Couldn't copy";
    setTimeout(() => { btn.textContent = "📋 Copy"; }, 1500);
  });

  bubble.appendChild(btn);
}

function showThinking() {
  const div = document.createElement("div");
  div.className = "bubble bot thinking";
  div.innerHTML = "<span></span><span></span><span></span>";
  messagesEl.appendChild(div);
  scrollToBottom();
  return div;
}

// ---------- Starter buttons ----------
function renderStarters() {
  if (!startersEl) return;
  startersEl.innerHTML = "";
  for (const question of (BOT_CONFIG.starterQuestions || [])) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "starter";
    btn.textContent = question;
    btn.addEventListener("click", () => sendMessage(question));
    startersEl.appendChild(btn);
  }
}

function showStarters(show) {
  if (startersEl) startersEl.style.display = show ? "" : "none";
}

// ---------- Saved conversation ----------
// The conversation is saved on your device, so it is still here
// after you refresh or come back later. "New chat" clears it.
function saveChat() {
  try {
    localStorage.setItem(CHAT_KEY, JSON.stringify(history));
  } catch (e) { /* storage not available: that's okay */ }
}

function clearSavedChat() {
  try { localStorage.removeItem(CHAT_KEY); } catch (e) { /* ignore */ }
}

function loadSavedChat() {
  try {
    const raw = localStorage.getItem(CHAT_KEY);
    if (!raw) return [];
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved)) return [];
    // Keep only well-formed messages
    return saved.filter((m) =>
      m &&
      (m.role === "user" || m.role === "model") &&
      Array.isArray(m.parts) &&
      m.parts[0] &&
      typeof m.parts[0].text === "string"
    );
  } catch (e) {
    return [];
  }
}

function welcomeText() {
  if (BOT_CONFIG.welcomeMessage) return BOT_CONFIG.welcomeMessage;
  const first = (BOT_CONFIG.starterQuestions || [])[0];
  let text = "Hi, I'm " + BOT_CONFIG.name + "! " + BOT_CONFIG.emoji + " I'll help you find the perfect restaurant for your cravings.";
  if (first) text += "\n" + first;
  if (!getKey()) text += "\nTap **API key** at the top to get started.";
  return text;
}

// Draws the whole conversation (or the welcome message if it is empty).
function renderChat() {
  messagesEl.innerHTML = "";
  if (history.length === 0) {
    addBubble("bot", welcomeText());
    showStarters(true);
    return;
  }
  showStarters(false);
  for (const msg of history) {
    const text = msg.parts[0].text;
    if (msg.role === "user") {
      addBubble("user", text);
    } else {
      const bubble = addBubble("bot", text);
      addCopyButton(bubble, text);
    }
  }
}

// ---------- New chat ----------
on(newChatBtn, "click", () => {
  if (isWaiting) return;
  history = [];
  clearSavedChat();
  renderChat();
  inputEl.focus();
});

// =====================================================================
//  KNOWLEDGE (RAG): your notes in knowledge.md
//  Step 1: read the notes file and split it into notes.
//  Step 2: turn each note into numbers (an "embedding") so the bot can
//          compare notes by meaning. These are saved on your device.
//  Step 3: for each question, pick the best-matching notes.
// =====================================================================

const CACHE_KEY = "bitebuddy_embeddings";   // where the saved numbers live
const MAX_NOTE_LENGTH = 1500;               // longer notes get split into parts
const EMBED_BATCH_SIZE = 50;                // most notes sent per request

const KNOWLEDGE_ON = BOT_CONFIG.useKnowledge !== false;
const WANTS_MEANING = (BOT_CONFIG.searchMethod || "meaning") !== "keywords";
const EMBEDDING_MODEL = BOT_CONFIG.embeddingModel || "gemini-embedding-2";
const TOP_K = Number(BOT_CONFIG.topK) > 0 ? Number(BOT_CONFIG.topK) : 3;

// Everything the bot knows about your notes right now
let knowledge = {
  notes: [],            // [{ title, text }]
  vectors: null,        // one list of numbers per note (or null)
  currentMethod: "keywords",
  state: "off"          // "off", "loading", "missing", "empty" or "ready"
};
let knowledgeLoading = Promise.resolve(); // lets questions wait for loading
let loadRun = 0;                          // used to ignore out-of-date loads

// ---------- Status line under the header ----------
function setStatus(message) {
  if
