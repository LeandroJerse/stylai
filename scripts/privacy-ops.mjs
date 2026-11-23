import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { prepareRecovery } from './privacy-recovery.mjs'
const [operation, ...args] = process.argv.slice(2)
const container = 'supabase_db_stylai-local'
function sql(input) {
 const r=spawnSync('docker',['exec','-i',container,'psql','-XqtA','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',windowsHide:true,timeout:30000})
 if(r.status!==0) throw Error(r.stderr || 'Local privacy operation failed')
 return r.stdout.trim()
}
if(operation==='export-journal') {
 const base=resolve(process.env.LOCALAPPDATA ?? '', 'StylAI-Security','privacy-journals')
 if(!process.env.LOCALAPPDATA) throw Error('LOCALAPPDATA required')
 mkdirSync(base,{recursive:true})
 const journal=JSON.parse(sql('select private.export_privacy_recovery_journal();'))
 const bytes=Buffer.from(JSON.stringify(journal,null,2)+'\n')
 const output=resolve(base,`journal-${Date.now()}.json`)
 writeFileSync(output,bytes,{flag:'wx',mode:0o600})
 console.log(JSON.stringify({path:output,sha256:createHash('sha256').update(bytes).digest('hex'),accountCount:journal.accountIds.length,encrypted:false,instruction:'Encrypt and independently back up this recovery journal before completing erasures. Do not upload plaintext.'}))
} else if(operation==='block-tiktok' && args[0]==='--apply') {
 sql('select private.block_tiktok_access();')
 console.log(JSON.stringify({localBlocked:sql('select not private.tiktok_access_allowed();')==='t',providerRevocationVerified:false}))
} else if(operation==='complete') {
 const [requestId,journalPath,expectedSha256,apply]=args
 if(!/^[a-f0-9-]{36}$/i.test(requestId??'') || apply!=='--apply') throw Error('Usage: complete REQUEST_UUID VERIFIED_JOURNAL SHA256 --apply')
 const bytes=readFileSync(journalPath)
 const journal=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''))
 prepareRecovery({bytes,expectedSha256,snapshotCreatedAt:'1970-01-01T00:00:00Z'})
 const row=JSON.parse(sql(`select coalesce((select json_build_object('userId',user_id,'state',state) from private.deletion_requests where id='${requestId}'::uuid),'null'::json);`))
 if(!row) throw Error('Deletion request missing')
 if(row.state==='done') { console.log(JSON.stringify({status:'done',replayed:true})); process.exit(0) }
 if(!journal.accountIds.includes(row.userId)) throw Error('Verified external journal does not contain this deletion')
 const done=sql(`select private.complete_pilot_account_deletion('${requestId}'::uuid,'${expectedSha256.toLowerCase()}');`)==='t'
 console.log(JSON.stringify({status:done?'done':'pending'}))
} else throw Error('Commands: export-journal | block-tiktok --apply | complete REQUEST_UUID VERIFIED_JOURNAL SHA256 --apply')
