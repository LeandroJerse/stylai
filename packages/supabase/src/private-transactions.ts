import type { Json } from "./database.types.js"
import type { DatabasePurpose } from "./private-config.js"

// bigint inputs/outputs remain decimal text: never silently round money/fences.
type Call<A extends unknown[], R> = { args: A; result: R }
export interface PrivateTransactions {
  api: {
    enqueue_ai_job: Call<[actor: string,key: string,hash: string,photo: string,category: string,policy: string,query: string,product: string|null,variant: string|null],string>
    cancel_ai_job: Call<[actor: string,job: string],boolean>
    request_account_deletion: Call<[actor: string],string>
    save_ai_look: Call<[actor: string,job: string],string>
    set_favorite_product: Call<[actor: string,product: string,saved: boolean],void>
  }
  ai_worker: {
    claim_ai_job: Call<[job: string],string|null>
    finish_ai_job: Call<[job: string,fence: string,status: "succeeded"|"no_results"|"failed",asset: string|null],boolean>
    reserve_ai_attempt: Call<[job: string,fence: string,stage: "search"|"generation",key: string,micros: string],string>
    begin_ai_attempt: Call<[attempt: string,fence: string],boolean>
    settle_ai_attempt: Call<[attempt: string,actualMicros: string],boolean>
    record_ai_selection: Call<[job: string,fence: string,product: string,variant: string,snapshot: Json],boolean>
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

type ResultKind = "uuid"|"boolean"|"fence"|"void"
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
  },
  ai_worker: {
    claim_ai_job: transaction('claim_ai_job',['uuid'],'fence'),
    finish_ai_job: transaction('finish_ai_job',['uuid','bigint','text','uuid'],'boolean'),
    reserve_ai_attempt: transaction('reserve_ai_attempt',['uuid','bigint','text','text','bigint'],'uuid'),
    begin_ai_attempt: transaction('begin_ai_attempt',['uuid','bigint'],'boolean'),
    settle_ai_attempt: transaction('settle_ai_attempt',['uuid','bigint'],'boolean'),
    record_ai_selection: transaction('record_ai_selection',['uuid','bigint','uuid','uuid','jsonb'],'boolean'),
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
  if(kind==='uuid' && typeof value==='string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value)) return value
  if(kind==='fence' && (value===null || typeof value==='string' && /^[1-9][0-9]*$/.test(value))) return value
  throw new Error('Invalid private result')
}
