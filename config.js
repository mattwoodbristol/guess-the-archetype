// Transform-ER "Guess the Archetype" — configuration
// Edit these two constants after deploying the Apps Script backend.

window.APP_CONFIG = {
  // Paste the "Web app URL" you get after deploying apps-script/Code.gs as a web app.
  // Format: https://script.google.com/macros/s/XXXXXXXXXXXXXXXXXXXX/exec
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbwvP7zRn8k3pqZXUFQh7_LTq2FttYs-qE1PxhGcoKpaChOjri3KCTeI0zyEoTIPIGwb/exec",

  // Password required to access /admin.html. Change this before going live.
  ADMIN_PASSWORD: "transform-er-admin-2026",

  // ===== fallback defaults =====
  // Admin can override these per-game via the Settings panel; values saved into
  // types.json under `settings:` win over anything here at runtime.

  // How many cards per game (must be >= TRADITIONAL_PER_GAME).
  CARDS_PER_GAME: 20,

  // How many of those cards must be traditional-construction (portfolio-data) cards.
  TRADITIONAL_PER_GAME: 4,

  // Easy/hard mode defaults — overridden by data.settings.difficulty when present.
  DIFFICULTY: {
    easy: { mcqOptions: 3, distractorScope: 'sameClass', showHint: true  },
    hard: { mcqOptions: 5, distractorScope: 'mixed',     showHint: false }
  },

  // How many rows of leaderboard to show on the intro + end screen.
  LEADERBOARD_ROWS: 10,

  // How many rows on the standalone full leaderboard page.
  LEADERBOARD_FULL_ROWS: 100,

  // Build number — bump when you deploy a new types.json so the browser refetches.
  DATA_VERSION: "2026-05-06-v2"
};
