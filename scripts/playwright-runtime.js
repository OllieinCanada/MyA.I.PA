const { initializePlaywright } = require('./playwright-paths');

// Project-owned adapter; do not patch installed Playwright or global settings.
module.exports = initializePlaywright({ load: () => require('playwright') });
