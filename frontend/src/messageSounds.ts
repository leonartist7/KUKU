import AsyncStorage from "@react-native-async-storage/async-storage";

export const SOUND_CHOICES = [
  {id:"bell", label:"Soft bell", description:"A warm, rounded note."},
  {id:"wood", label:"Woodland tap", description:"A short, mellow knock."},
  {id:"chime", label:"Little chime", description:"Two light notes, a little brighter."},
  {id:"drop", label:"Raindrop", description:"A tiny, falling water tone."},
  {id:"silent", label:"Silent", description:"Keep things quiet."},
] as const;
export type SoundId = typeof SOUND_CHOICES[number]["id"];
export type SoundSettings = {sound:SoundId;volume:number};
export const DEFAULT_SOUND:SoundSettings = {sound:"bell",volume:0.5};
export function normalizeSound(value:unknown):SoundSettings {
  const input=value as Partial<SoundSettings>|null;
  return {sound:SOUND_CHOICES.some(item=>item.id===input?.sound)?input!.sound!:"bell",
    volume:typeof input?.volume==="number" && Number.isFinite(input.volume)?Math.max(0,Math.min(1,input.volume)):0.5};
}
const key=(uid:string)=>"kuku_message_sound_v1_"+uid;
const cached=new Map<string,SoundSettings>();let writes:Promise<void>=Promise.resolve();
export async function readSound(uid:string):Promise<SoundSettings> {
  if(cached.has(uid))return cached.get(uid)!;
  const raw=await AsyncStorage.getItem(key(uid));let parsed;
  try{parsed=raw?JSON.parse(raw):null;}catch{parsed=null;}
  const value=normalizeSound(parsed);if(!cached.has(uid))cached.set(uid,value);
  return cached.get(uid)!;
}
export function saveSound(uid:string,value:SoundSettings) {
  const previous=cached.get(uid),next=normalizeSound(value);cached.set(uid,next);
  writes=writes.catch(()=>{}).then(()=>AsyncStorage.setItem(key(uid),JSON.stringify(next))).catch(error=>{
    if(cached.get(uid)===next){if(previous)cached.set(uid,previous);else cached.delete(uid);}
    throw error;
  });
  return writes;
}

type SoundMessage={id:string;sender_id:string};
export function incomingSoundTracker(uid:string) {
  let ready=false;const seen=new Set<string>();
  return (messages:SoundMessage[])=>{
    let incoming:string|undefined;
    for(const message of messages){
      if(!message?.id)continue;
      if(ready && !seen.has(message.id) && message.sender_id!==uid && !incoming)incoming=message.id;
      seen.add(message.id);
    }
    ready=true;
    if(seen.size>5000){const recent=Array.from(seen).slice(-2500);seen.clear();recent.forEach(id=>seen.add(id));}
    return incoming;
  };
}

// Tiny synthesized tones: no audio downloads, tracking requests or large sound library.
let context:AudioContext|null=null;let nodes:OscillatorNode[]=[];
export function stopMessageSound(){for(const node of nodes){try{node.stop();}catch{}}nodes=[];}
export function armMessageSounds() {
  if(typeof window==="undefined")return;
  const Constructor=window.AudioContext || (window as any).webkitAudioContext;
  if(!Constructor)return;
  context=context || new Constructor();
  if(context?.state==="suspended")return context.resume().catch(()=>{});
}
export async function playMessageSound(settings:SoundSettings,preview=false) {
  const value=normalizeSound(settings);
  stopMessageSound();
  if(value.sound==="silent" || value.volume===0)return;
  if(preview)await armMessageSounds();
  if(!context || context.state!=="running") {
    if(preview)throw new Error("Tap Preview again to allow sound in your browser.");
    return;
  }
  const audio=context;const now=audio.currentTime;
  const tone=(frequency:number,offset:number,duration:number,level:number,type:OscillatorType="sine",end?:number)=>{
    const oscillator=audio.createOscillator(),gain=audio.createGain();
    oscillator.type=type;oscillator.frequency.setValueAtTime(frequency,now+offset);
    if(end)oscillator.frequency.exponentialRampToValueAtTime(end,now+offset+duration);
    gain.gain.setValueAtTime(0.0001,now+offset);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001,value.volume*level),now+offset+0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001,now+offset+duration);
    oscillator.connect(gain);gain.connect(audio.destination);nodes.push(oscillator);
    oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();nodes=nodes.filter(node=>node!==oscillator);};
    oscillator.start(now+offset);oscillator.stop(now+offset+duration+0.02);
  };
  if(value.sound==="bell"){tone(523.25,0,0.55,0.22);tone(1046.5,0,0.35,0.055);}
  if(value.sound==="wood"){tone(245,0,0.12,0.16,"triangle");tone(390,0.025,0.085,0.06);}
  if(value.sound==="chime"){tone(659.25,0,0.35,0.16);tone(987.77,0.15,0.5,0.12);}
  if(value.sound==="drop")tone(1100,0,0.18,0.2,"sine",480);
}
