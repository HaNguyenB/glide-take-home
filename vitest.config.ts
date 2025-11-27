import { defineConfig } from 'vitest/config';
import path from 'path';
import type { Plugin } from 'vite';

// Plugin to prevent PostCSS config from being loaded
const ignorePostCSSPlugin = (): Plugin => ({
  name: 'ignore-postcss-config',
  configResolved(config) {
    // Disable PostCSS processing
    if (config.css?.postcss) {
      // @ts-ignore - We want to disable PostCSS
      config.css.postcss = undefined;
    }
  },
});

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    threads: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        '*.config.*',
        '**/*.test.ts',
        '**/*.spec.ts',
        'scripts/',
        'node-portable/',
        'app/',
        'components/',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
  esbuild: {
    target: 'node18',
  },
  // Exclude PostCSS from optimization
  optimizeDeps: {
    exclude: ['@tailwindcss/postcss'],
  },
  plugins: [ignorePostCSSPlugin()],
});

