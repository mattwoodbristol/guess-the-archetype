// Transform-ER "Guess the Archetype" — configuration
// Edit these two constants after deploying the Apps Script backend.

window.APP_CONFIG = {
  // Paste the "Web app URL" you get after deploying apps-script/Code.gs as a web app.
  // Format: https://script.google.com/macros/s/XXXXXXXXXXXXXXXXXXXX/exec
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbwvP7zRn8k3pqZXUFQh7_LTq2FttYs-qE1PxhGcoKpaChOjri3KCTeI0zyEoTIPIGwb/exec",

  // Password required to access /admin.html. Change this before going live.
  ADMIN_PASSWORD: "transform-er-admin-2026",

  // ===== fallback defaults =====
  // Admin can override these via /admin.html → Game settings (saved to the Sheet
  // via Apps Script). Settings precedence at runtime:
  //   1. Live settings fetched from Apps Script (?action=settings)
  //   2. data.settings inside types.json
  //   3. These DIFFICULTY defaults

  // Per-difficulty defaults. Each profile carries its own card counts so Hard
  // can be longer than Easy.
  DIFFICULTY: {
    easy: {
      totalCards:        15,
      traditionalCount:   3,
      mcqOptions:         3,
      distractorScope: 'sameClass',
      showHint:        true
    },
    hard: {
      totalCards:        25,
      traditionalCount:   4,
      mcqOptions:         5,
      distractorScope: 'mixed',
      showHint:        false
    }
  },

  // Default values used when an admin runs a test play. Overridable in admin → Game settings.
  TEST_PLAYER: {
    name:        'Test User',
    org:         'Test Org',
    role:        'Tester',
    orgLocation: 'Test',
    email:       'test@example.com',
    phone:       ''
  },

  // How many rows of leaderboard to show on the intro + end screen.
  LEADERBOARD_ROWS: 10,

  // How many rows on the standalone full leaderboard page.
  LEADERBOARD_FULL_ROWS: 100,

  // Build number — bump when you deploy a new types.json so the browser refetches.
  DATA_VERSION: "2026-05-06-v2"
};
