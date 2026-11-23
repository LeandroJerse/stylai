// Restart the local pilot without fixtures, budget changes or paid provider credentials.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const source = readFileSync(new URL('./dev-review.mjs', import.meta.url), 'utf8')
if (process.argv.includes('--real')) throw Error('This launcher only supports simulation')
const begin = source.indexOf('const seed = spawnSync(')
const end = source.indexOf('\nconst clean =', begin)
if (begin < 0 || end < 0) throw Error('Review launcher structure changed')
const rolesOnly = `const roles = spawnSync('docker', ['exec','-i','supabase_db_stylai-local','psql','-XqtA','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'], {encoding:'utf8',windowsHide:true,input: \`begin; alter role stylai_api login password '\${password}'; alter role stylai_ai_worker login password '\${password}'; commit;\`});
if(roles.status!==0) throw Error('Local role initialization failed');\n`
let launch = (source.slice(0, begin) + rolesOnly + source.slice(end))
  .replaceAll('54391', '41091')
  .replaceAll('54395', '41095')
  .replace('node_modules/.bin/supabase"', 'node_modules/.bin/supabase.exe"')
  .replace('STYLAI_|SUPABASE_', 'FAL_|TIKTOK_|OPENAI_|STYLAI_|SUPABASE_')
  .replace('STYLAI_GENERATION_MODE: real ?', 'STYLAI_CATALOG_MODE: "curated_pilot", STYLAI_GENERATION_MODE: real ?')
  .replace('STYLAI_ENVIRONMENT: "test" }', 'STYLAI_ENVIRONMENT: "test", STYLAI_PAID_CALLS_ENABLED: "false" }')
if (process.argv.includes('--oauth')) {
  launch = `import { loadOAuthEnvironment } from './oauth-runtime.mjs'\nconst oauthRuntime = loadOAuthEnvironment()\n` + launch
  launch = launch.replace('STYLAI_SESSION_KEY: randomBytes(32).toString("base64"),', '...oauthRuntime,')
}
// Generated code has no credentials; credentials exist only in the running processes.
const target = resolve('scripts/.resume-private-review.generated.mjs')
writeFileSync(target, launch)
mkdirSync('test-results', {recursive:true})
await import(pathToFileURL(target).href)
