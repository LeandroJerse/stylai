import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  root: __dirname,
  base: "./",
  plugins: [react(), tailwindcss()],
  define: { "import.meta.env.VITE_API_BASE_URL": JSON.stringify("https://api.stylai.preview/v1"), "import.meta.env.VITE_GOOGLE_CLIENT_ID": JSON.stringify("") },
  build: { outDir: "../dist-demo", emptyOutDir: true, target: "es2022" },
})
