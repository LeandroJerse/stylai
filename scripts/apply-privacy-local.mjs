import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
const container = 'supabase_db_stylai-local'
const files = ['20261122163645_account_deletion_asset_purge.sql','20261122164614_privacy_completion_guard.sql','20261122164748_tiktok_revocation_gate.sql']
function sql(input) {
 const r = spawnSync('docker',['exec','-i',container,'psql','-XqtA','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',windowsHide:true,timeout:60000})
 if(r.status!==0) throw Error(r.stderr || 'Local privacy migration failed')
 return r.stdout.trim()
}
const versions = new Set(sql('select version from supabase_migrations.schema_migrations;').split(/\r?\n/))
const pending = files.filter(f=>!versions.has(f.slice(0,14)))
const countsSql = 'select json_build_object(\'users\',(select count(*) from auth.users),\'assets\',(select count(*) from private.assets),\'jobs\',(select count(*) from private.ai_jobs));'
const before = JSON.parse(sql(countsSql))
if(!process.argv.includes('--apply')) { console.log(JSON.stringify({target:container,pending,before})); process.exit(0) }
const hashes = {}
let batch = "begin; set local lock_timeout='5s'; set local statement_timeout='30s'; select pg_advisory_xact_lock(hashtext('stylai-privacy-migrations'));\n"
for(const file of pending) {
 const body = readFileSync(`supabase/migrations/${file}`,'utf8').replace(/^\uFEFF/,'')
 hashes[file] = createHash('sha256').update(body).digest('hex')
 batch += body.replace(/^begin;\s*$/mi,'').replace(/^commit;\s*$/mi,'') + '\n'
 const quoted = body.replaceAll("'","''")
 batch += `insert into supabase_migrations.schema_migrations(version,name,statements) values ('${file.slice(0,14)}','${file.slice(15,-4)}',array['${quoted}']);\n`
}
batch += `do $$ begin assert (select count(*) from auth.users)=${before.users}, 'identity count changed'; assert (select count(*) from private.assets)=${before.assets}, 'asset count changed'; assert (select count(*) from private.ai_jobs)=${before.jobs}, 'job count changed'; end $$; commit;`
sql(batch)
const after = JSON.parse(sql(countsSql))
const report = {timestamp:new Date().toISOString(),target:container,applied:pending,hashes,before,after,realDeletionExecuted:false}
writeFileSync('docs/security/adequacao/PRIVACY-LOCAL-APPLY.json',JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report))
