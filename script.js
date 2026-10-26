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

const CHAT_KEY = "bitebuddy_chat"; // where the saved conversation lives

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
  startersEl.style.display = show ? "" : "none";
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
newChatBtn.addEventListener("click", () => {
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
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(EMBEDDING_MODEL) +
    ":batchEmbedContents";

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": getKey()
    },
    body: JSON.stringify({
      requests: texts.map((text) => ({
        model: "models/" + EMBEDDING_MODEL,
        content: { parts: [{ text: text }] }
      }))
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error((data.error && data.error.message) || "Embedding request failed");
  }
  if (!data.embeddings || data.embeddings.length !== texts.length) {
    throw new Error("Unexpected embedding response");
  }
  return data.embeddings.map((e) => e.values);
}

async function embedAll(notes) {
  const texts = notes.map((n) => n.title + "\n" + n.text);
  const vectors = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
    const result = await embedBatch(batch);
    for (const v of result) vectors.push(v);
  }
  return vectors;
}

// ---------- Load the notes when the page opens ----------
function initKnowledge() {
  if (!KNOWLEDGE_ON) {
    knowledge.state = "off";
    setStatus("");
    return Promise.resolve();
  }

  const run = ++loadRun;
  knowledge.state = "loading";
  setStatus("📚 Loading notes...");

  knowledgeLoading = (async () => {
    let markdown = "";
    try {
      const res = await fetch(BOT_CONFIG.knowledgeFile || "knowledge.md", { cache: "no-cache" });
      if (!res.ok) throw new Error("not found");
      markdown = await res.text();
    } catch (e) {
      if (run !== loadRun) return;
      knowledge.notes = [];
      knowledge.vectors = null;
      knowledge.currentMethod = "keywords";
      knowledge.state = "missing";
      setStatus("📚 Couldn't find knowledge.md (is it in the same folder as index.html?)");
      return;
    }
    if (run !== loadRun) return;

    const notes = parseNotes(markdown);
    knowledge.notes = notes;
    knowledge.vectors = null;
    knowledge.currentMethod = "keywords";

    if (notes.length === 0) {
      knowledge.state = "empty";
      setStatus("📚 No notes found (each note should start with ## Note title)");
      return;
    }

    knowledge.state = "ready";
    updateStatus();

    // Meaning search needs an API key
    if (WANTS_MEANING && getKey()) {
      const fingerprint = hashText(markdown + "|" + EMBEDDING_MODEL);
      let vectors = loadCachedVectors(fingerprint, notes.length);
      if (!vectors) {
        setStatus("📚 " + notes.length + " notes loaded · preparing meaning search...");
        try {
          vectors = await embedAll(notes);
          saveCachedVectors(fingerprint, vectors);
        } catch (e) {
          vectors = null; // fall back to keyword search
        }
      }
      if (run !== loadRun) return;
      if (vectors) {
        knowledge.vectors = vectors;
        knowledge.currentMethod = "meaning";
      }
      updateStatus();
    }
  })();

  return knowledgeLoading;
}

// ---------- Step 3: pick the best notes for a question ----------
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are",
  "was", "were", "be", "it", "this", "that", "with", "at", "by", "from", "as",
  "i", "me", "my", "we", "you", "your", "do", "does", "can", "what", "whats",
  "which", "who", "how", "any", "have", "has", "there", "about", "some", "want",
  "like", "get", "im", "ive", "please", "tell"
]);

function tokenize(text) {
  return (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter(
    (w) => w.length > 1 && !STOP_WORDS.has(w)
  );
}

function keywordSearch(question) {
  const words = Array.from(new Set(tokenize(question)));
  if (words.length === 0) return [];

  const scored = knowledge.notes.map((note) => {
    const titleWords = new Set(tokenize(note.title));
    const bodyWords = tokenize(note.text);
    let score = 0;
    for (const w of words) {
      if (titleWords.has(w)) score += 3;
      for (const b of bodyWords) {
        if (b === w) score += 1;
      }
    }
    return { note: note, score: score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K)
    .map((s) => s.note);
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function meaningSearch(question) {
  const result = await embedBatch([question]);
  const queryVector = result[0];
  const scored = knowledge.notes.map((note, i) => ({
    note: note,
    score: cosine(queryVector, knowledge.vectors[i])
  }));
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K)
    .map((s) => s.note);
}

async function findNotes(question) {
  await knowledgeLoading;
  if (!KNOWLEDGE_ON || knowledge.notes.length === 0) return [];

  if (knowledge.currentMethod === "meaning" && knowledge.vectors) {
    try {
      return await meaningSearch(question);
    } catch (e) {
      return keywordSearch(question); // fall back if meaning search fails
    }
  }
  return keywordSearch(question);
}

// =====================================================================
//  TALKING TO GEMINI
// =====================================================================

// Finds the bot's personality in config.js, whatever it is called there.
function getPersonality() {
  const names = ["systemInstruction", "systemPrompt", "personality", "instructions", "prompt", "system"];
  let text = "";
  for (const name of names) {
    const value = BOT_CONFIG[name];
    if (typeof value === "string" && value.trim()) { text = value; break; }
    if (Array.isArray(value) && value.length) { text = value.join("\n"); break; }
  }
  // Extra rules for using your notes (only when notes are turned on)
  if (KNOWLEDGE_ON && typeof BOT_CONFIG.knowledgeRules === "string" && BOT_CONFIG.knowledgeRules.trim()) {
    text += "\n\n" + BOT_CONFIG.knowledgeRules.trim();
  }
  return text;
}

function buildQuestionWithNotes(question, notes) {
  if (!notes.length) return question;
  let text = "NOTES from the knowledge file:\n\n";
  notes.forEach((note, i) => {
    text += "[" + (i + 1) + "] " + note.title + "\n" + note.text + "\n\n";
  });
  text += "Customer question: " + question;
  return text;
}

async function askGemini(contents) {
  const model = BOT_CONFIG.model || "gemini-flash-latest";
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(model) +
    ":generateContent";

  const body = { contents: contents };
  const personality = getPersonality();
  if (personality) {
    body.systemInstruction = { parts: [{ text: personality }] };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": getKey()
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();

  if (!response.ok) {
    const apiMessage = (data.error && data.error.message) || "";
    if (response.status === 400 && /api key/i.test(apiMessage)) {
      throw new Error("That API key doesn't look right. Tap **API key** and paste it again.");
    }
    if (response.status === 403) {
      throw new Error("Google didn't accept that API key. Tap **API key** to try a different one.");
    }
    if (response.status === 429) {
      throw new Error("Too many requests right now. Wait a minute and try again.");
    }
    throw new Error("Something went wrong. " + apiMessage);
  }

  const candidate = data.candidates && data.candidates[0];
  const parts = candidate && candidate.content && candidate.content.parts;
  const reply = parts ? parts.map((p) => p.text || "").join("").trim() : "";
  if (!reply) {
    throw new Error("I couldn't come up with an answer to that. Try asking another way!");
  }
  return reply;
}

// ---------- Send a message ----------
async function sendMessage(text) {
  const question = (text || "").trim();
  if (!question || isWaiting) return;

  if (!getKey()) {
    addBubble("bot", "I need your Gemini API key first. Tap **API key** at the top to add it.");
    openKeyModal();
    return;
  }

  isWaiting = true;
  sendBtn.disabled = true;
  inputEl.value = "";
  showStarters(false);

  addBubble("user", question);
  history.push({ role: "user", parts: [{ text: question }] });
  saveChat();

  const thinking = showThinking();

  try {
    const notes = await findNotes(question);

    // Send the notes along with this one question only.
    // The saved history keeps just the plain question.
    const contents = history.slice(0, -1).concat([
      { role: "user", parts: [{ text: buildQuestionWithNotes(question, notes) }] }
    ]);

    const reply = await askGemini(contents);

    thinking.remove();
    history.push({ role: "model", parts: [{ text: reply }] });
    saveChat();
    const bubble = addBubble("bot", reply);
    addCopyButton(bubble, reply);
    scrollToBottom();
  } catch (err) {
    thinking.remove();
    // Take the failed question out so the conversation stays valid
    history.pop();
    saveChat();
    const message = err && err.message ? err.message : "Something went wrong. Please try again.";
    addBubble("bot", message);
  } finally {
    isWaiting = false;
    sendBtn.disabled = false;
    inputEl.focus();
  }
}

sendBtn.addEventListener("click", () => sendMessage(inputEl.value));
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage(inputEl.value);
  }
});

// =====================================================================
//  START UP
// =====================================================================
applyConfig();
renderStarters();
history = loadSavedChat();
renderChat();
initKnowledge();
