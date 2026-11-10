import { test, expect } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join, resolve, sep } from "node:path"
import { checkBrowserBoundaries } from "../check-boundaries.mjs"

test("browser boundary rejects server packages and dynamic imports", () => {
  const directory = mkdtempSync(join(tmpdir(), "stylai-boundary-"))
  try {
    mkdirSync(join(directory, "apps/web/src"), { recursive: true })
    writeFileSync(join(directory, "apps/web/package.json"), JSON.stringify({ dependencies: {} }))
    writeFileSync(join(directory, "apps/web/src/main.ts"), 'import("@stylai/ai")')
    expect(checkBrowserBoundaries(directory).length).toBeGreaterThan(0)
    writeFileSync(join(directory, "apps/web/src/main.ts"), 'import type { ApiErrorBody } from "@stylai/contracts"')
    expect(checkBrowserBoundaries(directory)).toEqual([])
    writeFileSync(join(directory, "apps/web/package.json"), JSON.stringify({ dependencies: { "@stylai/supabase": "workspace:*" } }))
    expect(checkBrowserBoundaries(directory).length).toBeGreaterThan(0)
  } finally {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep) || !basename(directory).startsWith("stylai-boundary-")) throw new Error("Unexpected cleanup path")
    rmSync(directory, { recursive: true, force: true })
  }
})
