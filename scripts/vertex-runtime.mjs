import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'

// The plaintext is only returned through a private process pipe to the launcher.
export function loadVertexEnvironment(){
 const reader=fileURLToPath(new URL('./read-vertex-runtime.ps1',import.meta.url))
 const result=spawnSync('pwsh.exe',['-NoProfile','-File',reader],{encoding:'utf8',windowsHide:true})
 try {
  if(result.status!==0)throw new Error('Protected Vertex credential unavailable')
  const key=result.stdout.trim()
  if(!/^[A-Za-z0-9._-]{30,4096}$/.test(key))throw new Error('Invalid protected Vertex credential')
  return {VERTEX_API_KEY:key}
 } finally {result.stdout='';result.stderr=''}
}
