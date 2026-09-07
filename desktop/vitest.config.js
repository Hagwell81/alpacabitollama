const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    name: 'desktop',
    globals: true,
    environment: 'node',
    setupFiles: ['tests/setup.js'],
    include: ['tests/**/*.{test,spec}.js'],
    exclude: [
      'tests/helpers/**/*.test.js',
      'tests/fixtures/**',
      'tests/compatibility-inventory.test.js'
    ],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
      include: ['**/*.js'],
      exclude: ['tests/**', 'scripts/**', 'resources/**']
    }
  }
});
