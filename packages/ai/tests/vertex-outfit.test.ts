import {expect,test} from 'bun:test'
import {createGeminiOutfitClient} from '../src/gemini-outfit.js'
const data='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='
const person={bytes:Buffer.from(data,'base64'),mime:'image/png'}
test('Vertex sends inline references to the explicitly billed project and uses its 1K price',async()=>{
 let endpoint='',payload:Record<string,unknown>={}
 const client=createGeminiOutfitClient({apiKey:'test',vertexProject:'stylai-test',fetch:async(url,init)=>{
  endpoint=String(url);payload=JSON.parse(String(init?.body))
  return Response.json({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data}}]}}],usageMetadata:{promptTokenCount:4000,candidatesTokenCount:1120,thoughtsTokenCount:100}})
 }})
 const result=await client.generate({person,garments:[{...person,category:'Upper body'}]})
 expect(endpoint).toBe('https://aiplatform.googleapis.com/v1/projects/stylai-test/locations/global/publishers/google/models/gemini-nano-banana-2.1:generateContent')
 expect(payload.generationConfig).toMatchObject({imageConfig:{imageSize:'1K'},thinkingConfig:{thinkingLevel:'MINIMAL'}})
 expect(client.model).toBe('gemini-nano-banana-2.1')
 if(result.kind!=='completed')throw new Error('expected completed')
 expect(result.computedMicros).toBe(40350n)
})
test('Vertex rejects an invalid project before a credential can be sent',()=>{
 expect(()=>createGeminiOutfitClient({apiKey:'test',vertexProject:'../other?key=x'})).toThrow('invalid_vertex_project')
})
