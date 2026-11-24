import {expect,test} from 'bun:test'
import {createEngine,defaultEngineConfig} from '../src/engine.js'
import type {SegmindClient} from '@stylai/ai'
import type {PrivateDatabase,PrivateObjectStore} from '@stylai/supabase'
test('switching to joint Segmind preserves legacy reconciliation and never prices unknown models as try-on',async()=>{
 const polled:string[]=[],settled:string[]=[]
 const legacy={model:'try-on-diffusion',poll:async(id:string)=>{polled.push(id);return {kind:'completed',result:{image:{kind:'url',url:'https://example.com/x'},metrics:{inferenceTime:10}}}}} as unknown as SegmindClient
 const db={call:async(op:string,...args:unknown[])=>{
  if(op==='list_unreconciled_calls')return [
   {id:'10000000-0000-4000-8000-000000000001',provider:'segmind',model:'try-on-diffusion',provider_request_id:'old'},
   {id:'10000000-0000-4000-8000-000000000002',provider:'segmind',model:'nano-banana-pro',provider_request_id:'new'}]
  if(op==='reconcile_provider_call'){settled.push(String(args[0]));return true}
  return null
 }} as unknown as PrivateDatabase<'ai_worker'>
 const engine=createEngine({db,store:{} as PrivateObjectStore,segmind:null,segmindReconcilers:{'try-on-diffusion':legacy},config:{...defaultEngineConfig,provider:'segmind',environment:'test',pseudonymKey:'k'.repeat(32)}})
 expect(await engine.reconcileOnce()).toBe(1);expect(polled).toEqual(['old']);expect(settled).toHaveLength(1)
})
