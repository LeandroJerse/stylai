import {expect,test} from 'bun:test'
import {createSegmindOutfitClient} from '../src/segmind-outfit.js'
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=','base64'))
const photo={bytes:png,mime:'image/png',url:'https://photos.example.com/signed'}
const garments=[{...photo,url:'https://ae-pic-a1.aliexpress-media.com/lower.jpg',category:'Lower body',garmentType:'pants',slot:'lower'},{...photo,url:'https://ae-pic-a1.aliexpress-media.com/upper.jpg',category:'Upper body',garmentType:'shirts',slot:'upper'}]
test('Segmind Pro sends the original and two references in one 2K call',async()=>{
 let calls=0
 const client=createSegmindOutfitClient({apiKey:'test',fetch:async(url,init)=>{
  calls++;expect(String(url)).toBe('https://api.segmind.com/v1/nano-banana-pro')
  const body=JSON.parse(String(init?.body));expect(body.image_urls).toEqual([photo.url,...garments.map(g=>g.url)])
  expect(body).toMatchObject({output_resolution:'2K',response_modalities:'IMAGE',web_search:false,aspect_ratio:'3:4'})
  expect(body.prompt).toContain('identity');expect(body.prompt).toContain('full length')
  expect(new Headers(init?.headers).get('x-api-key')).toBe('test')
  return new Response(png,{headers:{'content-type':'image/png'}})
 }})
 const result=await client.generate({person:photo,garments});expect(result.kind).toBe('completed');expect(calls).toBe(1)
 if(result.kind==='completed')expect(result.computedMicros).toBe(152273n)
})
test('Segmind uncertainty never retries and input URLs are required before HTTP',async()=>{
 let calls=0
 const client=createSegmindOutfitClient({apiKey:'test',fetch:async()=>{calls++;throw new Error('network')}})
 expect((await client.generate({person:photo,garments})).kind).toBe('unknown');expect(calls).toBe(1)
 await expect(client.generate({person:{bytes:png,mime:'image/png'},garments})).rejects.toThrow('invalid_outfit_urls')
 expect(calls).toBe(1)
})

for(const [model,thinking,cost] of [['nano-banana-2-lite','high',42000n],['nano-banana-2.1','minimal',45000n]] as const){
 test(`${model} uses its own endpoint, 1K preset and price`,async()=>{
  const client=createSegmindOutfitClient({apiKey:'test',model,fetch:async(url,init)=>{
   expect(String(url)).toBe(`https://api.segmind.com/v1/${model}`)
   expect(JSON.parse(String(init?.body))).toMatchObject({output_resolution:'1K',thinking_level:thinking,image_urls:[photo.url,...garments.map(g=>g.url)]})
   return new Response(png,{headers:{'content-type':'image/png'}})
  }})
  const result=await client.generate({person:photo,garments})
  expect(client.model).toBe(model)
  if(result.kind!=='completed')throw new Error('expected completed')
  expect(result.computedMicros).toBe(cost)
 })
}
