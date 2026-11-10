import { describe, expect, test } from "bun:test"
import { readServiceConfig } from "../src/index"

describe("service configuration", () => {
  test("runs scaffold locally without integration credentials", () => {
    const config = readServiceConfig({})
    expect(config.host).toBe("127.0.0.1")
    expect(config.apiPort).toBe(3000)
    expect(config.workerPort).toBe(3001)
    expect(config.appOrigin).toBe("http://localhost:5190")
  })
  test("rejects invalid ports and URLs containing credentials or paths", () => {
    for (const env of [{ API_PORT: "0" }, { API_PORT: "abc" }, { APP_ORIGIN: "https://user:password@example.com" }, { APP_ORIGIN: "https://example.com/path" }]) {
      expect(() => readServiceConfig(env)).toThrow()
    }
  })
  test("requires an HTTPS application origin in production", () => {
    expect(() => readServiceConfig({ NODE_ENV: "production" })).toThrow()
    expect(readServiceConfig({ NODE_ENV: "production", APP_ORIGIN: "https://stylai.example" }).appOrigin).toBe("https://stylai.example")
  })
})
