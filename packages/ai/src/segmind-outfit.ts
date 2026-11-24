import {buildOutfitPrompt,createGeminiOutfitClient,validateGeminiOutfitInput,type OutfitInput,type OutfitResult} from './gemini-outfit.js'
import {createSegmindClient,parseResult,type FetchLike} from './segmind.js'
import {validateOutputImage} from './image.js'
export const SEGMIND_OUTFIT_MODEL='nano-banana-pro'
export const SEGMIND_OUTFIT_RESERVE=200_000n
export const SEGMIND_OUTFIT_PRICE_VERSION='segmind-nano-banana-pro-2k-2026-11-23'
// Published $0.15227224 per 2K image without web search; round up to a micro-dollar.
const priceMicros=152273n
export function createSegmindOutfitClient(config:{apiKey:string;fetch?:FetchLike}) {
 const http=config.fetch??fetch
 const downloader=createGeminiOutfitClient({apiKey:'unused',fetch:http})
 const output=createSegmindClient({apiKey:config.apiKey,fetch:http})
 return {
  model:SEGMIND_OUTFIT_MODEL,
  async garment(url:string){return {...await downloader.garment(url),url}},
  async generate(input:OutfitInput):Promise<OutfitResult>{
   validateGeminiOutfitInput(input)
   const images=[input.person,...input.garments]
   if(images.some(i=>{try{const u=new URL(i.url??'');return u.protocol!=='https:'||Boolean(u.username||u.password)||['localhost','127.0.0.1','::1'].includes(u.hostname)}catch{return true}}))throw new Error('invalid_outfit_urls')
   try{
    const response=await http('https://api.segmind.com/v1/nano-banana-pro',{
     method:'POST',headers:{'x-api-key':config.apiKey,'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(100000),
     body:JSON.stringify({prompt:buildOutfitPrompt(input),image_urls:images.map(i=>i.url),aspect_ratio:'3:4',output_resolution:'2K',output_format:'png',response_modalities:'IMAGE',web_search:false})
    })
    if(!response.ok)return {kind:[400,401,403,404,406,429].includes(response.status)?'rejected':'unknown',code:`segmind_http_${response.status}`}
    let bytes:Uint8Array
    if(response.headers.get('content-type')?.startsWith('image/')){
     if(!response.body)return {kind:'unknown',code:'segmind_empty_image'}
     const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0
     try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>12582912)throw new Error('output_too_large');chunks.push(part.value)}}finally{await reader.cancel().catch(()=>undefined)}
     bytes=Buffer.concat(chunks)
    }else{
     const parsed=parseResult(await response.json());if(!parsed)return {kind:'unknown',code:'segmind_bad_response'}
     bytes=parsed.image.kind==='url'?await output.download(parsed.image.url,12582912):Buffer.from(parsed.image.data,'base64')
    }
    validateOutputImage(bytes)
    return {kind:'completed',bytes,requestId:response.headers.get('x-request-id'),computedMicros:priceMicros,usage:{images:1}}
   }catch{return {kind:'unknown',code:'segmind_transport_or_response_unknown'}}
  },
 }
}
export type SegmindOutfitClient=ReturnType<typeof createSegmindOutfitClient>
