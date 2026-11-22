import { randomBytes } from "node:crypto"
import { createOtlpExporter, readLangfuseConfig } from "../packages/ai/src/telemetry.js"

async function main() {
  const config = readLangfuseConfig(process.env)
  if (!config) throw new Error("missing_configuration")
  if (config.baseUrl !== "https://cloud.langfuse.com") throw new Error("unexpected_host")
  const headers = { Authorization: `Basic ${Buffer.from(`${config.publicKey}:${config.secretKey}`).toString("base64")}` }
  const projectsResponse = await fetch(`${config.baseUrl}/api/public/projects`, { headers, redirect: "error", signal: AbortSignal.timeout(15000) })
  console.log(JSON.stringify({ step: "authentication", status: projectsResponse.status }))
  if (!projectsResponse.ok) return
  const projects = await projectsResponse.json() as { data?: Array<{ id: string }> }
  const projectId = "cmwpaucmw00jfad0d028xwkog"
  if (!projects.data?.some(p => p.id === projectId)) throw new Error("unexpected_project")
  const existingTraceId = process.argv[2]
  if (existingTraceId && !/^[a-f0-9]{32}$/.test(existingTraceId)) throw new Error("invalid_trace_id")
  const traceId = existingTraceId ?? randomBytes(16).toString("hex")
  const now = Date.now()
  const outcome = existingTraceId ? "sent" : await createOtlpExporter(config)([{
    traceId, spanId: randomBytes(8).toString("hex"), name: "langfuse-connection-check",
    startMs: now, endMs: now + 1,
    attributes: {
      "langfuse.trace.name": "stylai.connection-check",
      "langfuse.environment": "integration-test",
      "langfuse.observation.type": "generation",
      "langfuse.observation.model.name": "synthetic-no-provider",
      "langfuse.observation.cost_details": JSON.stringify({ total: 0 }),
      "langfuse.trace.metadata.synthetic": true,
      "langfuse.observation.metadata.synthetic": true,
    },
  }])
  console.log(JSON.stringify({ step: "export", outcome, traceId }))
  if (outcome !== "sent") return
  for (let attempt = 0; attempt < 12; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 5000))
    const response = await fetch(`${config.baseUrl}/api/public/v2/observations?traceId=${traceId}&fields=core,basic,usage&limit=10`, { headers, redirect: "error", signal: AbortSignal.timeout(15000) })
    if (response.ok) {
      const body = await response.json() as { data?: Array<{ traceId?: string; name?: string; environment?: string; totalCost?: number; costDetails?: Record<string, number> }> }
      const trace = body.data?.find(row => row.traceId === traceId)
      if (!trace) continue
      console.log(JSON.stringify({ step: "ingestion_verified", traceId: trace.traceId, name: trace.name, environment: trace.environment, totalCost: trace.totalCost, costDetails: trace.costDetails, url: `${config.baseUrl}/project/${projectId}/traces/${traceId}` }))
      return
    }
    if (response.status !== 404) { console.log(JSON.stringify({ step: "readback", status: response.status })); return }
  }
  console.log(JSON.stringify({ step: "ingestion_pending", traceId }))
}
main().catch((error: unknown) => {
  const known = ["missing_configuration", "unexpected_host", "unexpected_project"]
  const reason = error instanceof Error && known.includes(error.message) ? error.message : "network_or_runtime_error"
  const code = error instanceof Error && error.cause && typeof error.cause === "object" && "code" in error.cause ? String(error.cause.code).replace(/[^A-Z0-9_]/g, "").slice(0, 50) : undefined
  console.error(JSON.stringify({ failed: true, reason, code }))
  process.exitCode = 1
})
