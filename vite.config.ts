import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

/** Libraries that change rarely get their own chunks, so an app deploy does not bust their cache. */
function vendorChunk(id: string): string | undefined {
  const path = id.replace(/\\/g, "/")
  if (!path.includes("/node_modules/")) return undefined
  if (/\/node_modules\/(react|react-dom|scheduler)\//.test(path)) return "react"
  if (path.includes("/node_modules/@tanstack/")) return "query"
  // Icons are left to Rollup: each one lands in the chunk of the screen that uses it.
  return undefined
}

// Regular multi-file build: images come from the API at runtime and are never bundled.
// Only the brand files (monogram, wordmark) ship with the app. Screens are split in src/app/lazy.tsx.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: vendorChunk,
        // Merge tiny shared chunks (single icons, small helpers) instead of one request each.
        experimentalMinChunkSize: 8_000,
      },
    },
  },
})
