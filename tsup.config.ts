import { defineConfig } from "tsup"

const shared = { format: ["esm"] as Array<"esm">, platform: "node" as const, target: "node26", clean: true, sourcemap: false, external: ["@supabase/supabase-js"], noExternal: [/^@stylai\//], esbuildOptions(options: { conditions?: string[] }) { options.conditions = ["development"] } }
export default defineConfig([
  { ...shared, entry: ["apps/api/src/server.ts"], outDir: "apps/api/dist", external: ["fastify", "@fastify/cors", "@fastify/helmet", "@fastify/rate-limit", "@supabase/supabase-js"] },
  { ...shared, entry: ["apps/worker/src/server.ts"], outDir: "apps/worker/dist" },
  ...["contracts", "config", "supabase", "ai", "commerce"].map((name) => ({ ...shared, entry: [`packages/${name}/src/index.ts`], outDir: `packages/${name}/dist` })),
])
