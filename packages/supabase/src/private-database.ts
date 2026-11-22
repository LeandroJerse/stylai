import { Pool, type PoolClient } from "pg"
import { privateDatabaseRoles, type DatabasePurpose, type PrivateDatabaseConfig } from "./private-config.js"
import { decodePrivateResult, privateBoundaryVersion, privateOperations, type Arguments, type Operation, type Result } from "./private-transactions.js"

export type PrivateDatabaseStatus = "ready"|"unavailable"
export class PrivateDatabaseError extends Error {
  constructor(readonly outcome: "not_dispatched"|"rejected"|"unknown", readonly sqlState?: string) {
    super('Private database operation failed')
    this.name='PrivateDatabaseError'
  }
}
export interface PrivateDatabase<P extends DatabasePurpose> {
  call<N extends Operation<P>>(operation: N, ...args: Arguments<P,N>): Promise<Result<P,N>>
  probe(): Promise<PrivateDatabaseStatus>
  close(): Promise<void>
}

const identitySql = `select current_user as role, session_user as login,
  private.server_boundary_version() as version,
  (not r.rolcanlogin or r.rolsuper or r.rolbypassrls or r.rolcreaterole or r.rolcreatedb or r.rolreplication or r.rolinherit
    or exists(select 1 from pg_catalog.pg_auth_members m where m.member=r.oid)
    or exists(select 1 from pg_catalog.pg_namespace n where n.nspname in ('public','private','auth','storage') and pg_catalog.has_schema_privilege(r.oid,n.oid,'CREATE'))
    or exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','private','auth','storage') and c.relkind in ('r','p','v','m','f')
      and (pg_catalog.has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or pg_catalog.has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')))
  ) as unsafe,
  array(select p.proname || '(' || pg_catalog.oidvectortypes(p.proargtypes) || ')'
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and pg_catalog.has_function_privilege(r.oid,p.oid,'EXECUTE')
    order by 1) as functions
  from pg_catalog.pg_roles r where r.rolname=current_user`

/** Owns a restricted pool. No SQL text, credential or raw driver error escapes. */
export function createPrivateDatabase<P extends DatabasePurpose>(config: PrivateDatabaseConfig<P>): PrivateDatabase<P> {
  const pool=new Pool(config.connection)
  // pg-pool removes its idle error listener while a client is checked out.
  // Fatal socket errors also emit on that client after rejecting its query.
  pool.on('connect',client=>client.on('error',()=>{}))
  pool.on('error',()=>{})
  const operations: Record<string,{sql:string;arity:number;signature:string;result:Parameters<typeof decodePrivateResult>[0]}>=privateOperations[config.purpose]
  const expectedFunctions=['server_boundary_version()',...Object.values(operations).map(op=>op.signature)].sort()
  async function authorize(client: PoolClient) {
    const {rows}=await client.query(identitySql)
    const row=rows[0]
    if(!row || row.role!==privateDatabaseRoles[config.purpose] || row.login!==row.role || row.version!==privateBoundaryVersion || row.unsafe!==false
      || !Array.isArray(row.functions) || JSON.stringify(row.functions)!==JSON.stringify(expectedFunctions)) throw new PrivateDatabaseError('not_dispatched')
  }
  return {
    async call<N extends Operation<P>>(operation: N,...args: Arguments<P,N>): Promise<Result<P,N>> {
      if(!Object.hasOwn(operations,operation)) throw new PrivateDatabaseError('not_dispatched')
      const descriptor=operations[operation]!
      if(args.length!==descriptor.arity || args.some(arg=>arg===undefined || typeof arg==='number' && !Number.isSafeInteger(arg))) throw new PrivateDatabaseError('not_dispatched')
      let client: PoolClient|undefined
      let dispatched=false
      let discard=false
      try {
        client=await pool.connect()
        await authorize(client)
        dispatched=true
        const response=await client.query<{value:unknown}>(descriptor.sql,[...args])
        if(response.rows.length!==1) throw new Error('Invalid private result')
        return decodePrivateResult(descriptor.result,response.rows[0]?.value) as Result<P,N>
      } catch(error) {
        discard=true
        if(error instanceof PrivateDatabaseError) throw error
        const state=error && typeof error==='object' && 'code' in error && typeof error.code==='string' && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : undefined
        const rejected=state && !state.startsWith('08') && !state.startsWith('57')
        throw new PrivateDatabaseError(!dispatched?'not_dispatched':rejected?'rejected':'unknown',state)
      } finally {client?.release(discard)}
    },
    async probe() {
      let client: PoolClient|undefined
      let discard=false
      try {client=await pool.connect();await authorize(client);return 'ready'}
      catch {discard=true;return 'unavailable'}
      finally {client?.release(discard)}
    },
    async close() {await pool.end()},
  }
}
