import {buildOutfitPrompt,createGeminiOutfitClient,validateGeminiOutfitInput,type OutfitInput,type OutfitResult} from './gemini-outfit.js'
import {createSegmindClient,parseResult,type FetchLike} from './segmind.js'
import {validateOutputImage} from './image.js'
import {neverSent,transportCode} from './transport.js'
export const SEGMIND_OUTFIT_MODEL='nano-banana-pro'
export const SEGMIND_OUTFIT_RESERVE=200_000n
export const SEGMIND_OUTFIT_PRICE_VERSION='segmind-nano-banana-pro-2k-2026-11-23'
// Published $0.15227224 per 2K image without web search; round up to a micro-dollar.
export function segmindOutfitProfile(model:string) {
 const profiles:Record<string,{model:string;resolution:string;inlineInputs?:boolean;thinking?:string;priceMicros:bigint;reserveMicros:bigint;priceVersion:string}>={
  'flux-3-klein-image-edit':{model:'flux-3-klein-image-edit',resolution:'1k',inlineInputs:true,priceMicros:12870n,reserveMicros:20000n,priceVersion:'segmind-flux-3-klein-1k-2026-11-23'},
  'nano-banana-pro':{model:'nano-banana-pro',resolution:'2K',priceMicros:152273n,reserveMicros:200000n,priceVersion:SEGMIND_OUTFIT_PRICE_VERSION},
  'nano-banana-2-lite':{model:'nano-banana-2-lite',resolution:'1K',thinking:'high',priceMicros:42000n,reserveMicros:60000n,priceVersion:'segmind-nano-banana-2-lite-1k-2026-11-23'},
  'nano-banana-2.1':{model:'nano-banana-2.1',resolution:'1K',thinking:'minimal',priceMicros:45000n,reserveMicros:60000n,priceVersion:'segmind-nano-banana-2.1-1k-minimal-2026-11-23'},
 }
 return profiles[model]??null
}
export function createSegmindOutfitClient(config:{apiKey:string;model?:string;fetch?:FetchLike;/** Loopback simulator (development/test): free, never the provider. */simulatorUrl?:string}) {
 const simulator=config.simulatorUrl===undefined?null:new URL(config.simulatorUrl)
 if(simulator&&(simulator.protocol!=='http:'||!['127.0.0.1','localhost'].includes(simulator.hostname)))throw new Error('outfit_simulator_must_be_loopback')
 const origin=simulator?.origin??'https://api.segmind.com'
 const profile=segmindOutfitProfile(config.model??SEGMIND_OUTFIT_MODEL)
 if(!profile)throw new Error("unsupported_outfit_model")
 const http=config.fetch??fetch
 const downloader=createGeminiOutfitClient({apiKey:'unused',fetch:http})
 const output=createSegmindClient({apiKey:config.apiKey,fetch:http})
 return {
  model:profile.model,
  /** Free check with no key and no image: any HTTP answer means the provider can be reached. */
  async reachable():Promise<boolean>{
   try{await http(`${origin}/`,{method:'HEAD',redirect:'manual',signal:AbortSignal.timeout(8000)});return true}catch{return false}
  },
  async garment(url:string){return {...await downloader.garment(url),url}},
  async generate(input:OutfitInput):Promise<OutfitResult>{
   validateGeminiOutfitInput(input)
   const images=[input.person,...input.garments]
   if(!profile.inlineInputs && images.some(i=>{try{const u=new URL(i.url??'');return u.protocol!=='https:'||Boolean(u.username||u.password)||['localhost','127.0.0.1','::1'].includes(u.hostname)}catch{return true}}))throw new Error('invalid_outfit_urls')
   let response:Response
   // Only a request whose connection never existed is a definite failure; the rest waits for reconciliation.
   try{
    response=await http(`${origin}/v1/${profile.model}`,{
     method:'POST',headers:{'x-api-key':config.apiKey,'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(100000),
     body:JSON.stringify(profile.inlineInputs
      ? {prompt:buildOutfitPrompt(input),images:images.map(i=>Buffer.from(i.bytes).toString('base64')),aspect_ratio:'3:4',resolution:profile.resolution,steps:16,safety_tolerance:2,output_format:'png'}
      : {prompt:buildOutfitPrompt(input),image_urls:images.map(i=>i.url),aspect_ratio:'3:4',output_resolution:profile.resolution,...(profile.thinking?{thinking_level:profile.thinking}:{}),output_format:'png',response_modalities:'IMAGE',web_search:false})
    })
   }catch(error){return neverSent(error)?{kind:'rejected',code:'provider_unreachable'}:{kind:'unknown',code:`segmind_transport_${transportCode(error)}`}}
   try{
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
    return {kind:'completed',bytes,requestId:response.headers.get('x-request-id'),computedMicros:simulator?0n:profile.priceMicros,usage:{images:1}}
   }catch{return {kind:'unknown',code:'segmind_response_unreadable'}}
  },
 }
}
export type SegmindOutfitClient=ReturnType<typeof createSegmindOutfitClient>
