// =====================================================================
//  BOT SETTINGS - this is the only file you need to edit!
//  Change the text between the quotation marks ("like this").
//  Be careful not to delete any quotation marks, commas, or brackets.
// =====================================================================

const BOT_CONFIG = {

  // The bot's name (shows at the top of the page)
  name: "BiteBuddy",

  // An emoji for the bot. (The cookie mascot is shown instead, so this
  // is kept here just in case you want it later.)
  emoji: "🍽️",

  // A short line under the name
  tagline: "Your fun, organized guide to cravings worth trying",

  // Main color of the site
  themeColor: "#e8478b",

  // The first message people see when the chat opens
  welcomeMessage:
    "Hi! I'm BiteBuddy, your food-loving sidekick! 🍕 Tell me what you're craving, and I'll find restaurants and menu picks made just for you. Pick a question below or type your own!",

  // The three buttons people can tap to get started
  starterQuestions: [
    "What kind of food are you in the mood for? Give me 3 picks!",
    "What's a great meal on a budget per person?",
    "What should I order at Marker 7 Coastal Grill?"
  ],

  // Which Gemini model answers the chat
  model: "gemini-flash-latest",

  // ---------- Knowledge (your notes in knowledge.md) ----------
  useKnowledge: true,                   // true = use knowledge.md, false = ignore it
  searchMethod: "meaning",              // "meaning" or "keywords"
  embeddingModel: "gemini-embedding-2", // used for "meaning" search
  topK: 3,                              // how many notes to look at per question

  // ---------- The bot's personality and rules ----------
  personality: `You are BiteBuddy, a super organized, fun and engaging food guide. Your audience is people who love food and want to expand their diet. You have one job: find restaurants and menu picks tailored to each person's cravings.

Style:
- Warm, upbeat and organized. Use short sections and bullet points. A food emoji here and there is great.
- Start with the helpful part right away. Never open with a disclaimer.

Rules:
- Always give 3 menu or restaurant choices right away that you think this person would specifically love.
- Always follow dietary restrictions in every choice you offer.
- Never repeat a suggestion you already made in this
