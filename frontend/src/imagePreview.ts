import {getSessionEpoch,getSessionUserId,onSessionBoundary} from "./api";

export type ImagePreview = {image:string;width:number;height:number};
export type PrivateImagePreviewSize = "thumb"|"full";
export type PrivateImagePreviewFormat = "jpeg"|"webp";
export type PrivateImagePreviewScope = Readonly<{accountId:string;sessionEpoch:number;screenScope:string}>;
export type PrivateImagePreviewInvalidation = Readonly<{accountId?:string;screenScope?:string;attachmentId?:string}>;

const MAX_CACHE_ENTRIES=64;
const MAX_CACHE_BYTES=4*1024*1024;
const CACHE_TTL_MS=60_000;
type CacheEntry={scope:PrivateImagePreviewScope;attachmentId:string;size:PrivateImagePreviewSize;format:PrivateImagePreviewFormat;data:ImagePreview;estimatedBytes:number;expiresAt:number;touched:number};
type Flight={scope:PrivateImagePreviewScope;attachmentId:string;promise:Promise<ImagePreview>};
const cache=new Map<string,CacheEntry>();
const flights=new Map<string,Flight>();
const invalidationListeners=new Set<(event:PrivateImagePreviewInvalidation)=>void>();
let touch=0,retainedBytes=0;

export function isImageFilename(name?:string|null){return /\.(jpe?g|png|webp|gif|avif|hei[cf]|bmp|tiff?)$/i.test(name||"");}
export function validImagePreview(value:unknown):value is ImagePreview {
  const data=value as ImagePreview|null;
  return !!data && typeof data.image==="string" && /^data:image\/(jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(data.image) &&
    data.image.length<=660000 && Number.isInteger(data.width) && Number.isInteger(data.height) &&
    data.width>0 && data.height>0 && data.width<=1600 && data.height<=1600;
}
export function privateImagePreviewScope(accountId:string|undefined|null,screenScope:string):PrivateImagePreviewScope|null {
  if(!accountId || !screenScope || getSessionUserId()!==accountId)return null;
  return {accountId,sessionEpoch:getSessionEpoch(),screenScope};
}
export function privateImagePreviewKey(scope:PrivateImagePreviewScope,attachmentId:string,size:PrivateImagePreviewSize,format:PrivateImagePreviewFormat){
  return JSON.stringify([scope.sessionEpoch,scope.accountId,scope.screenScope,attachmentId,size,format]);
}
function scopeCurrent(scope:PrivateImagePreviewScope){
  return getSessionUserId()===scope.accountId && getSessionEpoch()===scope.sessionEpoch;
}
function estimatedBytes(data:ImagePreview){return data.image.length*2+64;}
function removeEntry(key:string){const entry=cache.get(key);if(!entry)return;retainedBytes-=entry.estimatedBytes;cache.delete(key);}
function pruneExpired(now=Date.now()){for(const [key,entry] of cache)if(entry.expiresAt<=now)removeEntry(key);}
function pruneBounds(){
  while(cache.size>MAX_CACHE_ENTRIES || retainedBytes>MAX_CACHE_BYTES){
    let oldestKey:string|undefined,oldest=Infinity;
    for(const [key,entry] of cache)if(entry.touched<oldest){oldest=entry.touched;oldestKey=key;}
    if(!oldestKey)break;removeEntry(oldestKey);
  }
}
function matches(value:{scope:PrivateImagePreviewScope;attachmentId:string},event:PrivateImagePreviewInvalidation){
  return (!event.accountId||value.scope.accountId===event.accountId)&&(!event.screenScope||value.scope.screenScope===event.screenScope)&&(!event.attachmentId||value.attachmentId===event.attachmentId);
}
export function subscribePrivateImagePreviewInvalidation(listener:(event:PrivateImagePreviewInvalidation)=>void){
  invalidationListeners.add(listener);return()=>{invalidationListeners.delete(listener);};
}
function clearMatching(event:PrivateImagePreviewInvalidation){
  for(const [key,entry] of cache)if(matches(entry,event))removeEntry(key);
  for(const [key,flight] of flights)if(matches(flight,event))flights.delete(key);
  invalidationListeners.forEach(listener=>{try{listener(event);}catch{}});
}
export function clearPrivateImagePreviewCache(){clearMatching({});}
export function clearPrivateImagePreviewAccount(accountId:string){clearMatching({accountId});}
export function clearPrivateImagePreviewScope(accountId:string,screenScope:string){clearMatching({accountId,screenScope});}
export function invalidatePrivateImagePreview(accountId:string,attachmentId:string){clearMatching({accountId,attachmentId});}
export function privateImagePreviewInvalidationMatches(event:PrivateImagePreviewInvalidation,scope:PrivateImagePreviewScope,attachmentId:string){
  return matches({scope,attachmentId},event);
}
export function getPrivateImagePreviewCacheStats(){
  pruneExpired();return {entries:cache.size,estimated_bytes:retainedBytes,in_flight:flights.size,max_entries:MAX_CACHE_ENTRIES,max_estimated_bytes:MAX_CACHE_BYTES,ttl_ms:CACHE_TTL_MS};
}
export function getCachedPrivateImagePreview(scope:PrivateImagePreviewScope,attachmentId:string,size:PrivateImagePreviewSize,format:PrivateImagePreviewFormat){
  if(size!=="thumb"||!scopeCurrent(scope))return undefined;
  pruneExpired();const key=privateImagePreviewKey(scope,attachmentId,size,format),entry=cache.get(key);
  if(!entry)return undefined;entry.touched=++touch;return entry.data;
}
export function loadPrivateImagePreview(scope:PrivateImagePreviewScope,attachmentId:string,size:PrivateImagePreviewSize,format:PrivateImagePreviewFormat,loader:()=>Promise<unknown>){
  if(!scopeCurrent(scope))return Promise.reject(new Error("Preview session changed."));
  const hit=getCachedPrivateImagePreview(scope,attachmentId,size,format);if(hit)return Promise.resolve(hit);
  const key=privateImagePreviewKey(scope,attachmentId,size,format),existing=flights.get(key);if(existing)return existing.promise;
  let promise!:Promise<ImagePreview>;
  promise=(async()=>{
    const data=await loader();
    if(!validImagePreview(data))throw new Error("Preview unavailable. Download the original instead.");
    if(flights.get(key)?.promise!==promise||!scopeCurrent(scope))throw new Error("Preview session changed.");
    if(size==="thumb"){
      const entry:CacheEntry={scope,attachmentId,size,format,data,estimatedBytes:estimatedBytes(data),expiresAt:Date.now()+CACHE_TTL_MS,touched:++touch};
      removeEntry(key);cache.set(key,entry);retainedBytes+=entry.estimatedBytes;pruneBounds();
    }
    return data;
  })().finally(()=>{if(flights.get(key)?.promise===promise)flights.delete(key);});
  flights.set(key,{scope,attachmentId,promise});return promise;
}
onSessionBoundary(()=>clearPrivateImagePreviewCache());
