import { defineConfig } from 'vite';

// Tauri serves the build from disk and the dev server on a fixed port.
// The targets are the oldest webviews the app runs on: WebView2 (Chromium) on
// Windows, WKWebView on macOS 10.15 with Safari 15 (its last update there) or
// later, and WebKitGTK 2.36+ on Linux.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 5174,
    strictPort: true,
  },
  build: {
    target: ['es2021', 'chrome105', 'safari15'],
    // Fonts stay separate files: the content security policy allows no data: fonts.
    assetsInlineLimit: 0,
  },
});
