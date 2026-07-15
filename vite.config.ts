import { defineConfig } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { powerApps } from "@microsoft/power-apps-vite/plugin"
import { fileURLToPath, URL } from 'node:url'

const validateEnvPlugin = (): Plugin => ({
  name: 'validate-env',
  buildStart() {
    const required: string[] = [
      'VITE_APPINSIGHTS_CS',
      'VITE_TENANT_ID',
      'VITE_TEAMS_CONTENT_URL',
      'VITE_ORG_URL',
    ];
    const missing = required.filter(k => !process.env[k]);
    if (missing.length > 0) {
      this.warn(`Missing environment variables: ${missing.join(', ')}`);
    }
  },
});

export default defineConfig(({ mode }) => ({
  plugins: [react(), powerApps(), validateEnvPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
  },
  resolve: {
    alias: {
      '@utils': fileURLToPath(new URL('./src/utils', import.meta.url)),
      '@components': fileURLToPath(new URL('./src/components', import.meta.url)),
      '@generated': fileURLToPath(new URL('./src/generated', import.meta.url)),
      '@hooks': fileURLToPath(new URL('./src/hooks', import.meta.url)),
      '@context': fileURLToPath(new URL('./src/context', import.meta.url)),
    },
  },
  build: {
    chunkSizeWarningLimit: 600,
    sourcemap: mode === 'production' ? 'hidden' : true,
    // Hidden sourcemaps are generated but not served — upload to App Insights for error correlation
    minify: mode === 'production' ? 'esbuild' : false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) return 'vendor';
          if (id.includes('@microsoft/teams-js') || id.includes('@microsoft/power-apps')) return 'sdk';
          if (id.includes('@microsoft/applicationinsights')) return 'ai';
        },
      },
    },
  },
}));
