// Transform-ER "Guess the Archetype" — configuration
// Edit these two constants after deploying the Apps Script backend.

window.APP_CONFIG = {
  // Paste the "Web app URL" you get after deploying apps-script/Code.gs as a web app.
  // Format: https://script.google.com/macros/s/XXXXXXXXXXXXXXXXXXXX/exec
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbwvP7zRn8k3pqZXUFQh7_LTq2FttYs-qE1PxhGcoKpaChOjri3KCTeI0zyEoTIPIGwb/exec",

  // Password required to access /admin.html. Change this before going live.
  ADMIN_PASSWORD: "transform-er-admin-2026",

  // How many cards per game (must be >= TRADITIONAL_PER_GAME).
  CARDS_PER_GAME: 20,

  // How many of those cards must be traditional-construction (portfolio-data) cards.
  TRADITIONAL_PER_GAME: 4,

  // How many multiple-choice options to show for non-standard cards (including the correct one).
  MCQ_OPTIONS: 4,

  // How many rows of leaderboard to show on the end screen.
  LEADERBOARD_ROWS: 10,

  // Build number — bump when you deploy a new types.json so the browser refetches.
  DATA_VERSION: "2026-04-22-v1"
};
