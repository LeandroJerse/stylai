import { readServiceConfig } from "@stylai/config"
import { buildWorkerServer } from "./app.js"

const config = readServiceConfig(process.env)
const server = buildWorkerServer()
server.on("error", () => { console.error("Worker startup failed; check port and configuration."); process.exitCode = 1 })
server.listen(config.workerPort, config.host, () => console.log(`Worker scaffold listening on ${config.host}:${config.workerPort}; queue consumer is not implemented.`))
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { server.closeAllConnections(); server.close() })
