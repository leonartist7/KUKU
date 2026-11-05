import AsyncStorage from "@react-native-async-storage/async-storage";
import { api, ApiError, Message } from "./api";
export type PendingMessage = {id:string; chat_id:string; payload:Record<string,unknown>; created_at:string; state:"queued"|"failed"; error?:string};
const listeners = new Set<()=>void>();
let chain:Promise<unknown> = Promise.resolve();
let flushing=false;
function key(uid:string){return "kuku_outbox_"+uid;}
async function read(uid:string):Promise<PendingMessage[]>{const s=await AsyncStorage.getItem(key(uid));return s?JSON.parse(s):[];}
function serial<T>(fn:()=>Promise<T>):Promise<T>{const next=chain.then(fn,fn);chain=next.catch(()=>{});return next;}
async function write(uid:string,items:PendingMessage[]){await AsyncStorage.setItem(key(uid),JSON.stringify(items));listeners.forEach(fn=>fn());}
export function subscribeOutbox(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};}
export function getOutbox(uid:string){return serial(()=>read(uid));}
export function queueMessage(uid:string,payload:Record<string,unknown>){
  return serial(async()=>{
    const items=await read(uid);if(items.length>=100)throw new Error("Send or remove queued messages before adding more.");
    const id=Date.now().toString(36)+"-"+Math.random().toString(36).slice(2);
    const item:PendingMessage={id,chat_id:String(payload.chat_id),payload:{...payload,client_message_id:id},created_at:new Date().toISOString(),state:"queued"};
    await write(uid,[...items,item]);return item;
  });
}
export function retryMessage(uid:string,id:string){return serial(async()=>write(uid,(await read(uid)).map(item=>item.id===id?{...item,state:"queued",error:undefined}:item)));}
export function removePending(uid:string,id:string){return serial(async()=>write(uid,(await read(uid)).filter(item=>item.id!==id)));}
export function clearOutbox(uid:string){return serial(async()=>{await AsyncStorage.removeItem(key(uid));listeners.forEach(fn=>fn());});}
export async function flushOutbox(uid:string,isCurrent:()=>boolean){
  if(flushing)return;flushing=true;
  try{
    for(const item of await getOutbox(uid)){
      if(!isCurrent())break;
      if(item.state!=="queued")continue;
      try{
        await api.postAs<Message>(uid,"/chats/"+item.chat_id+"/messages",item.payload);
        await removePending(uid,item.id);
      }catch(e){
        if(e instanceof ApiError && [400,403,404,409,413,422].includes(e.status)){
          await serial(async()=>write(uid,(await read(uid)).map(m=>m.id===item.id?{...m,state:"failed",error:e.message}:m)));
        }else break; // Keep the same ID and payload on transient failure, including lost acknowledgements.
      }
    }
  }finally{flushing=false;}
}
