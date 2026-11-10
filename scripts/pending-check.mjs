const name = process.argv[2] ?? "integration"
console.error(`${name}: NOT IMPLEMENTED. Follow docs/handoff/IMPLEMENTATION-PLAN.md; no real database/provider test or generated database types exist yet. This command deliberately fails instead of reporting false verification.`)
process.exitCode = 1
