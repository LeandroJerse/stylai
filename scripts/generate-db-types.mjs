import { spawnSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const ref = process.env.SUPABASE_PROJECT_REF
if (!ref || !/^[a-z0-9]{20}$/.test(ref)) {
  console.error("Set the intended hosted SUPABASE_PROJECT_REF in the ignored API env file, then sign in to the CLI. No types were generated.")
  process.exitCode = 1
} else {
  // CLI v3 uses --remote=<ref>; do not fall back to an implicitly linked project.
  const run = spawnSync(process.platform === "win32" ? "bun.exe" : "bun", ["run", "supabase", "gen", "types", "--lang=typescript", "--schema=public", `--remote=${ref}`], { cwd: root, encoding: "utf8", timeout: 60000, maxBuffer: 4_000_000, windowsHide: true })
  if (run.status !== 0 || !/export (?:type|interface) Database/.test(run.stdout ?? "")) {
    console.error("Supabase type generation failed or returned no valid schema. Check CLI login and project permissions. Existing type files were not overwritten; no credential-bearing output was printed.")
    process.exitCode = 1
  } else {
    writeFileSync(resolve(root, "packages/supabase/src/database.types.ts"), "// Generated from the actual hosted public schema by bun run db:types. Do not edit manually.\n" + run.stdout)
    console.log("Generated packages/supabase/src/database.types.ts from the selected hosted schema.")
  }
}
