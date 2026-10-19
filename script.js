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

// The conversation so far, in the format Gemini expects.
// (This only ever holds your plain questions, never the notes.)
let history = [];
let isWaiting = false;

// ---------- Set up the page from config.js ----------
function applyConfig() {
  document.title = BOT_CONFIG.name;
  document.getElementById("botName").textContent = BOT_CONFIG.name;
  document.getElementById("botEmoji").textContent = BOT_CONFIG.emoji;
  document.getElementById("botTagline").textContent = BOT_CONFIG.tagline;
  document.documentElement.style.setProperty("--accent", BOT_CONFIG.themeColor);
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

keyBtn.addEventListener("click", openKeyModal);
keyCancel.addEventListener("click", closeKeyModal);
keyModal.addEventListener("click", (e) => {
  if (e.target === keyModal) closeKeyModal();
});
keySave.addEventListener("click", () => {
  const key = keyInput.value.trim();
  if (!key) return;
  saveKey(key, rememberBox.checked);
  closeKeyModal();
  addBubble("bot", "Key saved! Ask me anything. 🎉");
  initKnowledge(); // now that there is a key, load / prepare the notes
});
keyInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") keySave.click();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !keyModal.hidden) closeKeyModal();
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
  startersEl.innerHTML = "";
  for (const question of BOT_CONFIG.starterQuestions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "starter";
    btn.textContent = question;
    btn.addEventListener("click", () => sendMessage(question));
    startersEl.appendChild(btn);
  }
}

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
  if (!KNOWLEDGE_ON || !message) {
    statusEl.hidden = true;
    statusEl.textContent = "";
    return;
  }
  statusEl.textContent = message;
  statusEl.hidden = false;
}

function updateStatus() {
  const count = knowledge.notes.length;
  const noteWord = count === 1 ? "note" : "notes";

  if (knowledge.currentMethod === "meaning") {
    setStatus("📚 " + count + " " + noteWord + " loaded · meaning search");
  } else if (WANTS_MEANING && !getKey()) {
    setStatus("📚 " + count + " " + noteWord + " loaded · keyword search (add your API key to turn on meaning search)");
  } else if (WANTS_MEANING) {
    setStatus("📚 " + count + " " + noteWord + " loaded · keyword search (meaning search isn't working right now)");
  } else {
    setStatus("📚 " + count + " " + noteWord + " loaded · keyword search");
  }
}

// ---------- Step 1: read knowledge.md and split it into notes ----------
// Each note starts with a line like "## Note title".
// Anything above the first "##" line is ignored.
function splitLongText(text, maxLength) {
  if (text.length <= maxLength) return [text];

  const paragraphs = text.split(/\n\s*\n/); // blank lines
  const parts = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const para = paragraph.trim();
    if (!para) continue;
    if (current && current.length + 2 + para.length > maxLength) {
      parts.push(current);
      current = para;
    } else {
      current = current ? current + "\n\n" + para : para;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function parseNotes(markdown) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const rawNotes = [];
  let current = null;

  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = { title: heading[1], lines: [] };
      rawNotes.push(current);
    } else if (current) {
      current.lines.push(line);
    }
    // lines before the first "##" are ignored
  }

  const notes = [];
  for (const raw of rawNotes) {
    const body = raw.lines.join("\n").trim();
    if (!body) continue; // skip a title with no text
    const parts = splitLongText(body, MAX_NOTE_LENGTH);
    parts.forEach((part, index) => {
      const title = parts.length === 1
        ? raw.title
        : raw.title + " (part " + (index + 1) + " of " + parts.length + ")";
      notes.push({ title: title, text: part });
    });
  }
  return notes;
}

// ---------- A short "fingerprint" of the notes file ----------
// If knowledge.md changes, the fingerprint changes, and the saved
// numbers are made again. Otherwise the saved numbers are reused.
function hashText(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16) + "-" + text.length;
}

function loadCachedVectors(fingerprint, count) {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (
      saved &&
      saved.fingerprint === fingerprint &&
      Array.isArray(saved.vectors) &&
      saved.vectors.length === count
    ) {
      return saved.vectors;
    }
  } catch (e) { /* storage not available or damaged: just make them again */ }
  return null;
}

function saveCachedVectors(fingerprint, vectors) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ fingerprint: fingerprint, vectors: vectors }));
  } catch (e) { /* too big or not available: that's okay */ }
}

// ---------- Step 2: turn text into numbers (embeddings) ----------
async function embedBatch(texts) {
  const model = BOT_CONFIG.embeddingModel || "gemini-embedding-2";
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(model) +
    ":batchEmbedContents";

  const response = await fetch(url, {
    method: "POST",
