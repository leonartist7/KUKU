import AsyncStorage from "@react-native-async-storage/async-storage";
import {MAX_WAV_BYTES, normalizedWav, soundName, validateWav} from "./notificationWav";

export const SOUND_CHOICES = [
  {id:"bell", label:"Soft bell", description:"A warm, rounded note."},
  {id:"wood", label:"Woodland tap", description:"A short, mellow knock."},
  {id:"chime", label:"Little chime", description:"Two light notes, a little brighter."},
  {id:"drop", label:"Raindrop", description:"A tiny, falling water tone."},
  {id:"bright", label:"Bright bell", description:"A clear, fuller bell that carries."},
  {id:"double", label:"Double knock", description:"Two crisp taps, easy to notice."},
  {id:"signal", label:"Clear signal", description:"Three bright notes with a little lift."},
  {id:"silent", label:"Silent", description:"Keep things quiet."},
] as const;
export type SoundId = typeof SOUND_CHOICES[number]["id"] | "custom";
export type SoundSettings = {sound:SoundId;volume:number};
export const DEFAULT_SOUND:SoundSettings = {sound:"bell",volume:0.5};
export function normalizeSound(value:unknown):SoundSettings {
  const input=value as Partial<SoundSettings>|null;
  return {sound:input?.sound==="custom" || SOUND_CHOICES.some(item=>item.id===input?.sound)?input!.sound!:"bell",
    volume:typeof input?.volume==="number" && Number.isFinite(input.volume)?Math.max(0,Math.min(1,input.volume)):0.5};
}

export type CustomSound = {name:string; data:string; duration:number};
const customKey=(uid:string)=>"kuku_message_wav_v1_"+uid;
export async function readCustomSound(uid:string):Promise<CustomSound|null> {
  const raw=await AsyncStorage.getItem(customKey(uid));
  if(!raw || raw.length>MAX_WAV_BYTES)return null;
  try {
    const value=JSON.parse(raw);
    if(typeof value.name!=="string" || typeof value.data!=="string" ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value.data) || value.data.length>640100 ||
      !Number.isFinite(value.duration) || value.duration<=0 || value.duration>5)return null;
    return {name:soundName(value.name),data:value.data,duration:value.duration};
  } catch {return null;}
}
function decodeBase64(data:string) {
  const raw=atob(data), bytes=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
  return bytes;
}
export async function prepareCustomSound(file:File):Promise<CustomSound> {
  if(!/\.wav$/i.test(file.name) || file.size>MAX_WAV_BYTES)throw new Error("Choose a WAV file smaller than 1 MB, up to 5 seconds.");
  const bytes=await file.arrayBuffer();validateWav(bytes);
  await armMessageSounds();
  if(!context)throw new Error("This browser can't play notification sounds.");
  let decoded:AudioBuffer;
  try {decoded=await context.decodeAudioData(bytes);}catch {throw new Error("This WAV couldn't be opened. Export it as PCM WAV and try again.");}
  const clean=normalizedWav(decoded);
  let binary="";
  for(let offset=0;offset<clean.length;offset+=8192)binary+=String.fromCharCode(...clean.subarray(offset,offset+8192));
  return {name:soundName(file.name),data:btoa(binary),duration:decoded.duration};
}
export async function saveCustomSound(uid:string,value:CustomSound) {
  await AsyncStorage.setItem(customKey(uid),JSON.stringify(value));
}
export async function removeCustomSound(uid:string) {
  await AsyncStorage.removeItem(customKey(uid));
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
let context:AudioContext|null=null;let nodes:(OscillatorNode|AudioBufferSourceNode)[]=[];
let playback=0;
export function stopMessageSound(){playback++;for(const node of nodes){try{node.stop();node.disconnect();}catch{}}nodes=[];}
export function armMessageSounds() {
  if(typeof window==="undefined")return;
  const Constructor=window.AudioContext || (window as any).webkitAudioContext;
  if(!Constructor)return;
  context=context || new Constructor();
  if(context?.state==="suspended")return context.resume().catch(()=>{});
}
export async function playMessageSound(settings:SoundSettings,preview=false,uid?:string) {
  const value=normalizeSound(settings);
  stopMessageSound();
  const intent=playback;
  if(value.sound==="silent" || value.volume===0)return;
  if(preview)await armMessageSounds();
  if(intent!==playback)return;
  if(!context || context.state!=="running") {
    if(preview)throw new Error("Tap Preview again to allow sound in your browser.");
    return;
  }
  const audio=context;const now=audio.currentTime;
  if(value.sound==="custom") {
    const custom=uid?await readCustomSound(uid):null;
    if(intent!==playback)return;
    if(!custom){if(preview)throw new Error("Import a WAV file to use your own sound.");return;}
    const bytes=decodeBase64(custom.data);validateWav(bytes.buffer);
    const buffer=await audio.decodeAudioData(bytes.buffer);
    if(intent!==playback)return;
    if(buffer.duration>5 || buffer.numberOfChannels>2)throw new Error("Import this short WAV again.");
    const source=audio.createBufferSource(),gain=audio.createGain();
    source.buffer=buffer;gain.gain.setValueAtTime(value.volume,audio.currentTime);
    source.connect(gain);gain.connect(audio.destination);nodes.push(source);
    source.onended=()=>{source.disconnect();gain.disconnect();nodes=nodes.filter(node=>node!==source);};
    source.start();return;
  }
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
  if(value.sound==="bell"){tone(523.25,0,0.55,0.4);tone(1046.5,0,0.35,0.1);}
  if(value.sound==="wood"){tone(245,0,0.12,0.32,"triangle");tone(390,0.025,0.085,0.12);}
  if(value.sound==="chime"){tone(659.25,0,0.35,0.32);tone(987.77,0.15,0.5,0.25);}
  if(value.sound==="drop")tone(1100,0,0.18,0.4,"sine",480);
  if(value.sound==="bright"){tone(783.99,0,0.65,0.5);tone(1567.98,0,0.4,0.16);tone(1174.66,0.08,0.45,0.12);}
  if(value.sound==="double"){tone(700,0,0.14,0.5,"triangle");tone(880,0.2,0.18,0.5,"triangle");}
  if(value.sound==="signal"){tone(659.25,0,0.22,0.48);tone(783.99,0.19,0.22,0.48);tone(1046.5,0.38,0.4,0.5);}
}
