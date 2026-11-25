// Disposable PostgreSQL integration. Never reads app env files or hosted URLs.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { createServer, createConnection, type Socket } from "node:net"
import { setTimeout as delay } from "node:timers/promises"
import { createPrivateDatabase, PrivateDatabaseError } from "../packages/supabase/src/private-database.js"
import { readPrivateDatabaseConfig, privateDatabaseRoles, type DatabasePurpose } from "../packages/supabase/src/private-config.js"
import { buildApp } from "../apps/api/src/app.js"
import { verifyAffiliateCatalogFlow } from "./test-affiliate-catalog-flow.js"

const root = process.cwd()
const name = `stylai-boundary-test-${randomUUID().slice(0,8)}`
const secret = randomBytes(24).toString('hex')
const a = '10000000-0000-4000-8000-000000000001'
const b = '10000000-0000-4000-8000-000000000002'
const photo = '20000000-0000-4000-8000-000000000001'
const clients: Array<{ close(): Promise<void> }> = []
let started = false
function docker(args: string[], input?: string) {
  const result = spawnSync('docker',args,{cwd:root,encoding:'utf8',windowsHide:true,timeout:180000,input,maxBuffer:2_000_000,env:{...process.env,POSTGRES_PASSWORD:secret}})
  if (result.status !== 0) throw new Error('Disposable Docker command failed (no hosted database was used)')
  return result.stdout.trim()
}
function admin(sql: string) { return docker(['exec','-i',name,'psql','-XqtA','-U','postgres','-d','stylai_test','-v','ON_ERROR_STOP=1'],sql) }
async function rejected(call: Promise<unknown>, code?: string) {
  try { await call } catch (error) {
    assert(error instanceof PrivateDatabaseError)
    assert.equal(error.message,'Private database operation failed')
    assert(!String(error).includes(secret))
    if(code) assert.equal(error.sqlState,code)
    return error
  }
  throw new Error('Expected private database rejection')
}
try {
  docker(['run','--rm','--detach','--name',name,'--label','dev.stylai.test=private-boundary','--publish','127.0.0.1::5432','-e','POSTGRES_PASSWORD','-e','POSTGRES_DB=stylai_test','postgres:17-alpine'])
  started=true
  let ready=false
  for(let i=0;i<60;i++) {
    const check=spawnSync('docker',['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres'],{windowsHide:true,stdio:'ignore',timeout:5000})
    if(check.status===0){ready=true;break}
    await delay(500)
  }
  assert(ready,'Disposable PostgreSQL failed to start')
  const migrations=readdirSync(resolve(root,'supabase/migrations')).filter(f=>/^\d{14}_.+\.sql$/.test(f)).sort()
  admin(['supabase/tests/bootstrap-postgres.sql',...migrations.map(f=>`supabase/migrations/${f}`),'supabase/tests/server-boundary.sql','supabase/tests/concurrency-fixtures.sql'].map(f=>readFileSync(resolve(root,f),'utf8')).join('\n'))
  const port=docker(['port',name,'5432/tcp']).split(':').at(-1)!
  for(const role of Object.values(privateDatabaseRoles)) admin(`alter role ${role} login password '${secret}';`)
  function config<P extends DatabasePurpose>(purpose:P) {
    return readPrivateDatabaseConfig({[`STYLAI_${purpose.toUpperCase()}_DATABASE_URL`]:`postgres://${privateDatabaseRoles[purpose]}:${secret}@127.0.0.1:${port}/stylai_test`},purpose)!
  }
  const api=createPrivateDatabase(config('api')); clients.push(api)
  const worker=createPrivateDatabase(config('ai_worker')); clients.push(worker)
  const catalogWorker=createPrivateDatabase(config('catalog_worker')); clients.push(catalogWorker)
  const payments=createPrivateDatabase(config('payments')); clients.push(payments)
  const procurement=createPrivateDatabase(config('procurement')); clients.push(procurement)
  for(const client of [api,worker,catalogWorker,payments,procurement]) assert.equal(await client.probe(),'ready')
  const catalogClaim=await catalogWorker.call('claim_affiliate_collection','driver-fixture',600)
  assert.match(catalogClaim?.token ?? '',/^[0-9a-f-]{36}$/)
  assert.equal(await catalogWorker.call('claim_affiliate_collection','driver-fixture',600),null)
  assert.equal(await catalogWorker.call('retry_affiliate_collection','driver-fixture',catalogClaim!.token,new Date(Date.now()+300_000).toISOString()),true)
  assert.deepEqual(await api.call('list_affiliate_offers',{limit:1}),{items:[],nextCursor:null,total:0})
  const untypedCatalogWorker=catalogWorker as unknown as {call(name:string,...values:unknown[]):Promise<unknown>}
  assert.equal((await rejected(untypedCatalogWorker.call('read_affiliate_offer','aliexpress:100'))).outcome,'not_dispatched')
  await verifyAffiliateCatalogFlow(api, catalogWorker)
  assert.equal(await worker.call('claim_ai_job',randomUUID()),null)
  const args=[a,"quote'; select pg_sleep(30); --",'a'.repeat(64),photo,'test-tops','test-v1','blusa',null,null] as const
  const job=await api.call('enqueue_ai_job',...args)
  assert.equal(await api.call('enqueue_ai_job',...args),job,'replay created a second job')
  assert.equal(admin(`select count(*) from private.ai_jobs where id='${job}'`),'1')
  assert.equal(await api.call('cancel_ai_job',b,job),false)
  await rejected(api.call('enqueue_ai_job',b,'foreign-photo','a'.repeat(64),photo,'test-tops','test-v1','',null,null),'42501')
  await rejected(api.call('enqueue_ai_job',a,args[1],'b'.repeat(64),photo,'test-tops','test-v1','blusa',null,null),'23505')
  // JavaScript callers cannot bypass the TypeScript purpose restriction.
  const untyped=api as unknown as {call(name:string,...values:unknown[]):Promise<unknown>}
  assert.equal((await rejected(untyped.call('claim_ai_job',job))).outcome,'not_dispatched')
  assert.equal((await rejected(untyped.call('constructor'))).outcome,'not_dispatched')
  assert.equal(await worker.call('claim_ai_job',job),'1','bigint fence must be lossless text')
  assert.equal(await worker.call('finish_ai_job',job,'2','no_results',null),false)
  assert.equal(await worker.call('finish_ai_job',job,'1','no_results',null),true)
  assert.equal(await worker.call('finish_ai_job',job,'1','no_results',null),false)
  assert.equal(await api.call('set_favorite_product',a,randomUUID(),false),undefined)
  const request=await api.call('request_account_deletion',b)
  assert.match(request,/^[0-9a-f-]{36}$/)
  assert.equal(await payments.call('record_payment_event','sandbox','fixture','evt-1','res-1','fixture','b'.repeat(64)),true)
  assert.equal(await payments.call('record_payment_event','sandbox','fixture','evt-1','res-1','fixture','b'.repeat(64)),false)
  await rejected(procurement.call('record_supplier_purchase',randomUUID(),'1'),'23514')

  // Readiness must include current privileges, not merely a successful connection.
  const app=await buildApp({appOrigin:'http://localhost:5190',probeSupabase:async()=>({status:'ready'}),probePrivateDatabase:()=>api.probe()})
  try {
    assert.equal((await app.inject('/health/ready')).statusCode,200)
    admin('grant select on private.app_sessions to stylai_api;')
    assert.equal(await api.probe(),'unavailable')
    assert.equal((await app.inject('/health/ready')).statusCode,503)
    assert.equal((await rejected(api.call('request_account_deletion',a))).outcome,'not_dispatched')
    admin('revoke select on private.app_sessions from stylai_api;')
    admin('grant select (user_id) on private.app_sessions to stylai_api;')
    assert.equal(await api.probe(),'unavailable','column-level grants bypassed privilege preflight')
    admin('revoke select (user_id) on private.app_sessions from stylai_api;')
    admin('grant stylai_payments to stylai_api;')
    assert.equal(await api.probe(),'unavailable')
    admin('revoke stylai_payments from stylai_api;')
    admin('grant execute on function private.claim_ai_job(uuid) to stylai_api;')
    assert.equal(await api.probe(),'unavailable')
    admin('revoke execute on function private.claim_ai_job(uuid) from stylai_api;')
    assert.equal(await api.probe(),'ready')
    admin('alter role stylai_api nologin;')
    assert.equal(await api.probe(),'unavailable','disabled login retained application dispatch authority')
    admin('alter role stylai_api login;')
    assert.equal(await api.probe(),'ready')
  } finally {await app.close()}

  // A dropped connection after dispatch is ambiguous. Never replay automatically.
  admin("create function private.fixture_pause() returns trigger language plpgsql as $$ begin perform pg_sleep(10); return new; end $$; create trigger fixture_pause after insert on private.ai_jobs for each row execute function private.fixture_pause();")
  const pending=api.call('enqueue_ai_job',a,'response-loss','c'.repeat(64),photo,'test-tops','test-v1','',null,null)
  // Attach a rejection handler immediately; keep the error for assertions below.
  const result=pending.then(()=>null,error=>error)
  let pid=''
  for(let i=0;i<50;i++) {
    pid=admin("select pid from pg_stat_activity where usename='stylai_api' and state='active' and query like 'select private.enqueue_ai_job%'")
    if(pid)break
    await delay(20)
  }
  assert(/^\d+$/.test(pid),'mutation was not observed in the backend')
  admin(`select pg_terminate_backend(${pid})`)
  const error=await result
  assert(error instanceof PrivateDatabaseError)
  assert.equal(error.outcome,'unknown')
  assert.equal(admin("select count(*) from private.ai_jobs where request_key='response-loss'"),'0','transport failure was silently retried')
  admin('drop trigger fixture_pause on private.ai_jobs; drop function private.fixture_pause();')

  // Drop the response only after PostgreSQL reports ReadyForQuery: the write
  // committed, but the adapter never receives its result or completion packet.
  const sockets=new Set<Socket>()
  let mutationDispatches=0
  const proxy=createServer(downstream=>{
    const upstream=createConnection({host:'127.0.0.1',port:Number(port)})
    for(const socket of [downstream,upstream]) {
      sockets.add(socket)
      socket.on('close',()=>sockets.delete(socket))
      socket.on('error',()=>{downstream.destroy();upstream.destroy()})
    }
    let inputs=Buffer.alloc(0)
    let withheld=Buffer.alloc(0)
    let dropping=false
    downstream.on('data',data=>{
      const chunk=typeof data==='string'?Buffer.from(data):data
      inputs=Buffer.concat([inputs,chunk]).subarray(-4096)
      if(!dropping && inputs.includes(Buffer.from('select private.enqueue_ai_job('))){dropping=true;mutationDispatches++}
      upstream.write(data)
    })
    upstream.on('data',data=>{
      if(!dropping){downstream.write(data);return}
      const chunk=typeof data==='string'?Buffer.from(data):data
      withheld=Buffer.concat([withheld,chunk])
      while(withheld.length>=5) {
        const length=withheld.readInt32BE(1)+1
        if(length<5 || length>1_048_576){downstream.destroy();upstream.destroy();return}
        if(withheld.length<length)return
        if(withheld[0]===90){downstream.destroy();upstream.destroy();return} // Z
        withheld=withheld.subarray(length)
      }
    })
    downstream.on('close',()=>upstream.destroy())
    upstream.on('close',()=>downstream.destroy())
  })
  await new Promise<void>((done,fail)=>{proxy.once('error',fail);proxy.listen(0,'127.0.0.1',done)})
  const address=proxy.address()
  assert(address && typeof address!=='string')
  const proxyConfig=config('api');proxyConfig.connection.port=address.port
  const lossy=createPrivateDatabase(proxyConfig)
  try {
    const loss=await rejected(lossy.call('enqueue_ai_job',a,'committed-response-loss','d'.repeat(64),photo,'test-tops','test-v1','',null,null))
    assert.equal(loss.outcome,'unknown')
    assert.equal(mutationDispatches,1,'ambiguous mutation was automatically dispatched again')
    assert.equal(admin("select count(*) from private.ai_jobs where request_key='committed-response-loss'"),'1','committed mutation was lost or repeated')
    assert.equal(await api.call('enqueue_ai_job',a,'committed-response-loss','d'.repeat(64),photo,'test-tops','test-v1','',null,null),admin("select id from private.ai_jobs where request_key='committed-response-loss'"),'explicit same-key reconciliation did not reuse the committed job')
  } finally {
    await lossy.close()
    for(const socket of sockets)socket.destroy()
    await new Promise<void>((done,fail)=>proxy.close(error=>error?fail(error):done()))
  }
  console.log('Real Node/PostgreSQL boundary passed: five role logins, restricted affiliate catalog calls, owned/replayed calls, foreign denial, fencing, financial separation, readiness, role/ACL revocation, backend termination and committed-write response loss without automatic retries.')
} catch(error) {
  // Tests can include secret-bearing connection errors; never print their raw form.
  console.error(error instanceof assert.AssertionError ? `Boundary assertion failed: ${error.message}` : 'Private boundary integration failed; no hosted database was touched.')
  process.exitCode=1
} finally {
  await Promise.all(clients.map(c=>c.close()))
  if(started && /^stylai-boundary-test-[0-9a-f]{8}$/.test(name)) docker(['rm','--force',name])
}
