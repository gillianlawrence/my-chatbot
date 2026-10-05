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

// The conversation so far, in the format Gemini expects
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

// ---------- Talking to Gemini ----------
function friendlyError(status) {
  if (status === 400 || status === 403) {
    return "Hmm, Google didn't accept that key. 🔑 Click the \"API key\" button and double-check that you pasted it correctly.";
  }
  if (status === 404) {
    return "I can't find that AI model. Check the model name in config.js (the default is \"gemini-flash-latest\").";
  }
  if (status === 429) {
    return "Whoa, too many requests too fast! ⏳ Wait a minute and try again.";
  }
  if (status >= 500) {
    return "Google's servers are having a moment. Please try again in a little while.";
  }
  return "Something went wrong (error " + status + "). Please try again.";
}

async function askGemini() {
  const key = getKey();
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(BOT_CONFIG.model) +
    ":generateContent";

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": key
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: BOT_CONFIG.systemInstruction }] },
      contents: history
    })
  });

  if (!response.ok) {
    const error = new Error("HTTP error");
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  const parts =
    data.candidates &&
    data.candidates[0] &&
    data.candidates[0].content &&
    data.candidates[0].content.parts;

  if (!parts) return "";

  // Join the text parts, skipping any "thought" parts
  return parts
    .filter((part) => !part.thought && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

function setWaiting(waiting) {
  isWaiting = waiting;
  sendBtn.disabled = waiting;
}

async function sendMessage(text) {
  text = text.trim();
  if (!text || isWaiting) return;

  if (!getKey()) {
    addBubble("error", "I need your API key first! Click the \"API key\" button at the top and paste it in. 🔑");
    openKeyModal();
    return;
  }

  startersEl.innerHTML = "";
  addBubble("user", text);
  history.push({ role: "user", parts: [{ text: text }] });
  inputEl.value = "";
  resizeInput();
  setWaiting(true);

  const thinkingBubble = showThinking();

  try {
    const reply = await askGemini();
    thinkingBubble.remove();

    if (!reply) {
      history.pop();
      addBubble("error", "I didn't get an answer that time. Try rephrasing your message.");
    } else {
      history.push({ role: "model", parts: [{ text: reply }] });
      addBubble("bot", reply);
    }
  } catch (err) {
    thinkingBubble.remove();
    history.pop(); // so you can safely try again
    inputEl.value = text;
    resizeInput();

    if (err && err.status) {
      addBubble("error", friendlyError(err.status));
    } else {
      addBubble("error", "I can't reach the internet right now. 📶 Check your connection and try again.");
    }
  }

  setWaiting(false);
  inputEl.focus();
}

// ---------- Input box ----------
function resizeInput() {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + "px";
}

inputEl.addEventListener("input", resizeInput);

// Enter = send, Shift+Enter = new line
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendMessage(inputEl.value);
  }
});

sendBtn.addEventListener("click", () => sendMessage(inputEl.value));

// ---------- New chat ----------
function startNewChat() {
  history = [];
  messagesEl.innerHTML = "";
  addBubble("bot", BOT_CONFIG.welcomeMessage);
  renderStarters();
  inputEl.value = "";
  resizeInput();
  setWaiting(false);
}

newChatBtn.addEventListener("click", startNewChat);

// ---------- Start! ----------
applyConfig();
startNewChat();
