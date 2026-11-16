import { expect, test } from 'bun:test'
import { decodePrivateResult } from '../src/private-transactions'

test('private result decoding preserves large fences and rejects malformed success payloads',()=>{
  expect(decodePrivateResult('fence','9007199254740993')).toBe('9007199254740993')
  expect(decodePrivateResult('fence',null)).toBeNull()
  expect(decodePrivateResult('boolean','false')).toBe(false)
  expect(decodePrivateResult('void','')).toBeUndefined()
  for(const [kind,value] of [['fence',9007199254740992],['boolean','1'],['uuid','not-a-uuid'],['void','unvalidated response']] as const) {
    expect(()=>decodePrivateResult(kind,value)).toThrow('Invalid private result')
  }
})
