import type { Json } from "./database.types.js"
import type { DatabasePurpose } from "./private-config.js"

/** Must match private.server_boundary_version() of the latest boundary migration. */
export const privateBoundaryVersion = "20261121000400"

// bigint inputs/outputs remain decimal text: never silently round money/fences.
type Call<A extends unknown[], R> = { args: A; result: R }
export interface PrivateTransactions {
  api: {
    enqueue_ai_job: Call<[actor: string,key: string,hash: string,photo: string,category: string,policy: string,query: string,product: string|null,variant: string|null],string>
    cancel_ai_job: Call<[actor: string,job: string],boolean>
    request_account_deletion: Call<[actor: string],string>
    save_ai_look: Call<[actor: string,job: string],string>
    set_favorite_product: Call<[actor: string,product: string,saved: boolean],void>
    enqueue_look_job: Call<[actor: string,key: string,hash: string,policy: string,product: string,variant: string|null,parentVersion: string|null],string>
    read_ai_job: Call<[actor: string,job: string],Json|null>
    read_look: Call<[actor: string,look: string],Json|null>
    read_look_version: Call<[actor: string,version: string],Json|null>
    list_looks: Call<[actor: string,limit: number],Json|null>
    read_version_asset: Call<[actor: string,version: string],Json|null>
    list_catalog_products: Call<[limit: number,offset: number,category: string|null],Json|null>
    read_catalog_product: Call<[product: string],Json|null>
    catalog_facets: Call<[],Json|null>
    create_app_session: Call<[actor: string,providerSession: string,cookieHash: string,ciphertext: string,keyVersion: string,tokenTtlSeconds: number,sessionTtlSeconds: number],string>
    begin_session_refresh: Call<[cookieHash: string],Json|null>
    complete_session_refresh: Call<[session: string,version: string,ciphertext: string,keyVersion: string,tokenTtlSeconds: number],boolean>
    release_session_refresh: Call<[session: string,version: string],boolean>
    revoke_app_session: Call<[cookieHash: string],Json|null>
    check_app_session: Call<[actor: string,providerSession: string],boolean>
    read_profile: Call<[actor: string],Json|null>
    record_photo_consent: Call<[actor: string,policy: string],string>
    read_photo_consent: Call<[actor: string],Json|null>
    begin_body_photo: Call<[actor: string,policy: string,objectKey: string,bytes: number,mime: string,width: number,height: number],string>
    finish_body_photo: Call<[actor: string,asset: string,ok: boolean],boolean>
    list_body_photos: Call<[actor: string],Json|null>
    read_body_photo_asset: Call<[actor: string,asset: string],Json|null>
    read_active_ai_job: Call<[actor: string],Json|null>
    read_ai_allowance: Call<[actor: string],Json|null>
    remove_body_photo: Call<[actor: string],number>
    begin_body_photo_at: Call<[actor: string,angle: "front"|"side"|"profile",policy: string,objectKey: string,bytes: number,mime: string,width: number,height: number],string>
    remove_body_photo_at: Call<[actor: string,angle: "front"|"side"|"profile"],number>
    set_body_photo_hash: Call<[actor: string,asset: string,sha256: string],boolean>
    settle_body_photo_validation: Call<[actor: string,asset: string,sha256: string,status: "approved"|"needs_adjustment"|"inconclusive"|"error",validatorVersion: string,result: Json],boolean>
    read_cached_photo_validation: Call<[actor: string,sha256: string,validatorVersion: string,angle: "front"|"side"|"profile"],Json|null>
  }
  ai_worker: {
    claim_asset_purges: Call<[limit: number],Json|null>
    finish_asset_purge: Call<[asset: string,ok: boolean,error: string|null],boolean>
    claim_ai_job: Call<[job: string],string|null>
    finish_ai_job: Call<[job: string,fence: string,status: "succeeded"|"no_results"|"failed",asset: string|null],boolean>
    reserve_ai_attempt: Call<[job: string,fence: string,stage: "search"|"generation",key: string,micros: string],string>
    begin_ai_attempt: Call<[attempt: string,fence: string],boolean>
    settle_ai_attempt: Call<[attempt: string,actualMicros: string],boolean>
    record_ai_selection: Call<[job: string,fence: string,product: string,variant: string,snapshot: Json],boolean>
    next_ai_job: Call<[],string|null>
    renew_ai_job_lease: Call<[job: string,fence: string],boolean>
    load_ai_job: Call<[job: string,fence: string],Json|null>
    register_generated_asset: Call<[job: string,fence: string,objectKey: string,bytes: number,mime: string,width: number,height: number],string>
    complete_look_job: Call<[job: string,fence: string,asset: string],string|null>
    fail_look_job: Call<[job: string,fence: string,code: string],boolean>
    reserve_provider_call: Call<[job: string,fence: string,provider: string,model: string,priceVersion: string,operation: string,key: string,reserveMicros: string,userRef: string,environment: string],string>
    begin_provider_call: Call<[call: string,fence: string],boolean>
    settle_provider_call: Call<[call: string,status: string,requestId: string|null,units: Json,report: Json,estimated: string|null,computed: string|null,confirmed: string|null,source: string,latencyMs: number|null,error: string|null],boolean>
    reconcile_provider_call: Call<[call: string,status: string,confirmed: string,source: string,report: Json],boolean>
    list_unreconciled_calls: Call<[limit: number],Json|null>
    enqueue_telemetry_event: Call<[key: string,job: string|null,payload: Json],boolean>
    claim_telemetry_events: Call<[limit: number],Json|null>
    mark_telemetry_event: Call<[id: string,outcome: "sent"|"retry"|"unknown"|"dead"],boolean>
  }
  payments: {
    start_order_payment: Call<[actor: string,quote: string,method: "pix"|"card"|"boleto",environment: "sandbox"|"production",merchant: string],string>
    begin_payment_submission: Call<[attempt: string],boolean>
    record_payment_event: Call<[environment: string,merchant: string,event: string,resource: string,kind: string,hash: string],boolean>
    bind_payment_resource: Call<[attempt: string,kind: string,resource: string,payableUntil: string],boolean>
    confirm_order_payment: Call<[attempt: string,environment: string,merchant: string,kind: string,resource: string,amountMinor: string,currency: string,paidAt: string],boolean>
    close_unpayable_attempt: Call<[attempt: string,kind: string|null,resource: string|null],boolean>
  }
  procurement: { record_supplier_purchase: Call<[attempt: string,actualMinor: string],boolean> }
}
export type Operation<P extends DatabasePurpose> = keyof PrivateTransactions[P] & string
export type Arguments<P extends DatabasePurpose,N extends Operation<P>> = PrivateTransactions[P][N] extends Call<infer A,unknown> ? A : never
export type Result<P extends DatabasePurpose,N extends Operation<P>> = PrivateTransactions[P][N] extends Call<unknown[],infer R> ? R : never

type ResultKind = "uuid"|"nullable_uuid"|"boolean"|"fence"|"void"|"json"|"count"
function transaction(name: string, types: string[], result: ResultKind) {
  return {
    signature: `${name}(${types.join(', ')})`, result, arity: types.length,
    sql: `select private.${name}(${types.map((type,i)=>`$${i+1}::${type}`).join(',')})::text as value`,
  }
}
// SQL identifiers and casts are entirely server-authored, never caller supplied.
export const privateOperations = {
  api: {
    enqueue_ai_job: transaction('enqueue_ai_job',['uuid','text','text','uuid','text','text','text','uuid','uuid'],'uuid'),
    cancel_ai_job: transaction('cancel_ai_job',['uuid','uuid'],'boolean'),
    request_account_deletion: transaction('request_account_deletion',['uuid'],'uuid'),
    save_ai_look: transaction('save_ai_look',['uuid','uuid'],'uuid'),
    set_favorite_product: transaction('set_favorite_product',['uuid','uuid','boolean'],'void'),
    enqueue_look_job: transaction('enqueue_look_job',['uuid','text','text','text','uuid','uuid','uuid'],'uuid'),
    read_ai_job: transaction('read_ai_job',['uuid','uuid'],'json'),
    read_look: transaction('read_look',['uuid','uuid'],'json'),
    read_look_version: transaction('read_look_version',['uuid','uuid'],'json'),
    list_looks: transaction('list_looks',['uuid','integer'],'json'),
    read_version_asset: transaction('read_version_asset',['uuid','uuid'],'json'),
    list_catalog_products: transaction('list_catalog_products',['integer','integer','text'],'json'),
    read_catalog_product: transaction('read_catalog_product',['uuid'],'json'),
    catalog_facets: transaction('catalog_facets',[],'json'),
    create_app_session: transaction('create_app_session',['uuid','uuid','text','text','text','integer','integer'],'uuid'),
    begin_session_refresh: transaction('begin_session_refresh',['text'],'json'),
    complete_session_refresh: transaction('complete_session_refresh',['uuid','bigint','text','text','integer'],'boolean'),
    release_session_refresh: transaction('release_session_refresh',['uuid','bigint'],'boolean'),
    revoke_app_session: transaction('revoke_app_session',['text'],'json'),
    check_app_session: transaction('check_app_session',['uuid','uuid'],'boolean'),
    read_profile: transaction('read_profile',['uuid'],'json'),
    record_photo_consent: transaction('record_photo_consent',['uuid','text'],'uuid'),
    read_photo_consent: transaction('read_photo_consent',['uuid'],'json'),
    begin_body_photo: transaction('begin_body_photo',['uuid','text','text','integer','text','integer','integer'],'uuid'),
    finish_body_photo: transaction('finish_body_photo',['uuid','uuid','boolean'],'boolean'),
    list_body_photos: transaction('list_body_photos',['uuid'],'json'),
    read_body_photo_asset: transaction('read_body_photo_asset',['uuid','uuid'],'json'),
    read_active_ai_job: transaction('read_active_ai_job',['uuid'],'json'),
    read_ai_allowance: transaction('read_ai_allowance',['uuid'],'json'),
    remove_body_photo: transaction('remove_body_photo',['uuid'],'count'),
    begin_body_photo_at: transaction('begin_body_photo_at',['uuid','text','text','text','integer','text','integer','integer'],'uuid'),
    remove_body_photo_at: transaction('remove_body_photo_at',['uuid','text'],'count'),
    set_body_photo_hash: transaction('set_body_photo_hash',['uuid','uuid','text'],'boolean'),
    settle_body_photo_validation: transaction('settle_body_photo_validation',['uuid','uuid','text','text','text','jsonb'],'boolean'),
    read_cached_photo_validation: transaction('read_cached_photo_validation',['uuid','text','text','text'],'json'),
  },
  ai_worker: {
    claim_asset_purges: transaction('claim_asset_purges',['integer'],'json'),
    finish_asset_purge: transaction('finish_asset_purge',['uuid','boolean','text'],'boolean'),
    claim_ai_job: transaction('claim_ai_job',['uuid'],'fence'),
    finish_ai_job: transaction('finish_ai_job',['uuid','bigint','text','uuid'],'boolean'),
    reserve_ai_attempt: transaction('reserve_ai_attempt',['uuid','bigint','text','text','bigint'],'uuid'),
    begin_ai_attempt: transaction('begin_ai_attempt',['uuid','bigint'],'boolean'),
    settle_ai_attempt: transaction('settle_ai_attempt',['uuid','bigint'],'boolean'),
    record_ai_selection: transaction('record_ai_selection',['uuid','bigint','uuid','uuid','jsonb'],'boolean'),
    next_ai_job: transaction('next_ai_job',[],'nullable_uuid'),
    renew_ai_job_lease: transaction('renew_ai_job_lease',['uuid','bigint'],'boolean'),
    load_ai_job: transaction('load_ai_job',['uuid','bigint'],'json'),
    register_generated_asset: transaction('register_generated_asset',['uuid','bigint','text','integer','text','integer','integer'],'uuid'),
    complete_look_job: transaction('complete_look_job',['uuid','bigint','uuid'],'nullable_uuid'),
    fail_look_job: transaction('fail_look_job',['uuid','bigint','text'],'boolean'),
    reserve_provider_call: transaction('reserve_provider_call',['uuid','bigint','text','text','text','text','text','bigint','text','text'],'uuid'),
    begin_provider_call: transaction('begin_provider_call',['uuid','bigint'],'boolean'),
    settle_provider_call: transaction('settle_provider_call',['uuid','text','text','jsonb','jsonb','bigint','bigint','bigint','text','integer','text'],'boolean'),
    reconcile_provider_call: transaction('reconcile_provider_call',['uuid','text','bigint','text','jsonb'],'boolean'),
    list_unreconciled_calls: transaction('list_unreconciled_calls',['integer'],'json'),
    enqueue_telemetry_event: transaction('enqueue_telemetry_event',['text','uuid','jsonb'],'boolean'),
    claim_telemetry_events: transaction('claim_telemetry_events',['integer'],'json'),
    mark_telemetry_event: transaction('mark_telemetry_event',['uuid','text'],'boolean'),
  },
  payments: {
    start_order_payment: transaction('start_order_payment',['uuid','uuid','text','text','text'],'uuid'),
    begin_payment_submission: transaction('begin_payment_submission',['uuid'],'boolean'),
    record_payment_event: transaction('record_payment_event',['text','text','text','text','text','text'],'boolean'),
    bind_payment_resource: transaction('bind_payment_resource',['uuid','text','text','timestamp with time zone'],'boolean'),
    confirm_order_payment: transaction('confirm_order_payment',['uuid','text','text','text','text','bigint','text','timestamp with time zone'],'boolean'),
    close_unpayable_attempt: transaction('close_unpayable_attempt',['uuid','text','text'],'boolean'),
  },
  procurement: { record_supplier_purchase: transaction('record_supplier_purchase',['uuid','bigint'],'boolean') },
} satisfies { [P in DatabasePurpose]: Record<Operation<P>,ReturnType<typeof transaction>> }

export function decodePrivateResult(kind: ResultKind, value: unknown): unknown {
  if(kind==='void' && (value==='' || value===null)) return undefined
  if(kind==='boolean' && (value==='true' || value==='false')) return value==='true'
  const uuid=(v: unknown)=>typeof v==='string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v)
  if(kind==='uuid' && uuid(value)) return value
  if(kind==='nullable_uuid' && (value===null || uuid(value))) return value
  if(kind==='count' && typeof value==='string' && /^(0|[1-9][0-9]{0,8})$/.test(value)) return Number(value)
  if(kind==='json' && value===null) return null
  if(kind==='json' && typeof value==='string') { try { return JSON.parse(value) as unknown } catch { /* fall through */ } }
  if(kind==='fence' && (value===null || typeof value==='string' && /^[1-9][0-9]*$/.test(value))) return value
  throw new Error('Invalid private result')
}
