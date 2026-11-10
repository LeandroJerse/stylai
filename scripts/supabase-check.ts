import { readSupabaseConfig, probeFoundation } from "@stylai/supabase"

try {
  const config = readSupabaseConfig(process.env)
  const result = await probeFoundation(config)
  console.log(`Supabase foundation: ${result.status}`)
  if (config) console.log(`Project host: ${new URL(config.url).hostname}`)
  if (result.status !== "ready") {
    console.error("See docs/SUPABASE-SETUP.md. No credential values were printed.")
    process.exitCode = 1
  }
} catch {
  console.error("Invalid Supabase environment configuration; check URL/key roles in the ignored API environment file. No credential values were printed.")
  process.exitCode = 1
}
