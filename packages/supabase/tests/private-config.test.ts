import { expect, test } from "bun:test"
import { readPrivateDatabaseConfig } from "../src/private-config"

test("private database configuration is opt-in and cannot fall back to owner credentials", () => {
  expect(readPrivateDatabaseConfig({ DATABASE_URL: 'postgres://postgres:secret@127.0.0.1/db' }, 'api')).toBeNull()
  for (const user of ['postgres','service_role','stylai_ai_worker']) {
    expect(() => readPrivateDatabaseConfig({ STYLAI_API_DATABASE_URL: `postgres://${user}:secret@127.0.0.1/db` }, 'api')).toThrow('Invalid private database configuration')
  }
  const config = readPrivateDatabaseConfig({ STYLAI_API_DATABASE_URL: 'postgres://stylai_api:secret@127.0.0.1:54322/db' }, 'api')!
  expect(config.purpose).toBe('api')
  expect(config.connection.ssl).toBe(false)
  expect(config.connection.max).toBe(4)
  expect(() => readPrivateDatabaseConfig({ STYLAI_API_DATABASE_CA_CERT: 'orphaned-ca' }, 'api')).toThrow('Invalid private database configuration')
  expect(() => readPrivateDatabaseConfig({ NODE_ENV:'production', STYLAI_API_DATABASE_URL:'postgres://stylai_api:secret@localhost/db' },'api')).toThrow('Invalid private database configuration')
})

test("remote database TLS cannot be weakened by URL options, projects or credentials", () => {
  const url = 'postgres://stylai_api:secret@db.yekhpfwxuiuakxznxaew.supabase.co:5432/postgres'
  const valid = readPrivateDatabaseConfig({ STYLAI_API_DATABASE_URL: url }, 'api')!
  expect(valid.connection.ssl).toEqual({ rejectUnauthorized: true })
  for (const invalid of [url+'?sslmode=disable',url+'?sslmode=require',url+'?options=-c%20role=postgres', url.replace('yekhpfwxuiuakxznxaew','another-project'),url.replace('db.yekhpfwxuiuakxznxaew.supabase.co','external.example'),url.replace(':secret@',':@')]) {
    let failure: unknown
    try { readPrivateDatabaseConfig({ STYLAI_API_DATABASE_URL: invalid }, 'api') } catch (error) { failure=error }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe('Invalid private database configuration')
    expect(String(failure)).not.toContain('secret')
  }
  expect(readPrivateDatabaseConfig({ STYLAI_API_DATABASE_URL: 'postgres://stylai_api.yekhpfwxuiuakxznxaew:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres' },'api')!.connection.ssl).toEqual({ rejectUnauthorized: true })
})
