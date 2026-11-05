export const EMOTES = [
  {id:"fluent:heart",slug:"heart",label:"Heart",emoji:"💗"},
  {id:"fluent:hug",slug:"hug",label:"Hug",emoji:"🤗"},
  {id:"fluent:laugh",slug:"laugh",label:"Laugh",emoji:"😂"},
  {id:"fluent:love",slug:"love",label:"Love",emoji:"🥰"},
  {id:"fluent:kiss",slug:"kiss",label:"Kiss",emoji:"😘"},
  {id:"fluent:think",slug:"think",label:"Thinking",emoji:"🤔"},
  {id:"fluent:party",slug:"party",label:"Celebrate",emoji:"🥳"},
  {id:"fluent:smile",slug:"smile",label:"Smile",emoji:"😁"},
  {id:"fluent:sleep",slug:"sleep",label:"Sleepy",emoji:"😴"},
  {id:"fluent:wow",slug:"wow",label:"Wow",emoji:"🤩"},
  {id:"fluent:fire",slug:"fire",label:"Fire",emoji:"🔥"},
  {id:"fluent:confetti",slug:"confetti",label:"Confetti",emoji:"🎉"},
] as const;
export type Emote = typeof EMOTES[number];
export function getEmote(id?:string|null):Emote|undefined{return EMOTES.find(item=>item.id===id);}
export function emoteAsset(slug:string,animated=false){
  if(!EMOTES.some(item=>item.slug===slug))return "";
  return "/emotes/"+slug+(animated?".webp":".png");
}
