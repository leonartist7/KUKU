export type MessageTextPart = {text:string; url?:string};

// Only ordinary web links are actionable. Never execute app/data/script schemes
// or silently reinterpret embedded credentials as a trustworthy destination.
export function safeMessageUrl(value:string):string|null {
  if (!/^(https?:\/\/|www\.)/i.test(value) || /[\s\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(value)) return null;
  try {
    const url = new URL(/^www\./i.test(value) ? "https://"+value : value);
    return ["https:","http:"].includes(url.protocol) && !!url.hostname && !url.username && !url.password ? url.href : null;
  } catch {return null;}
}

function linkEnd(value:string) {
  let end=value.length;
  const pairs:Record<string,string>={")":"(","]":"[","}":"{"};
  const counts:Record<string,number>={};
  for(const character of value)counts[character]=(counts[character]||0)+1;
  while(end){
    const last=value[end-1];
    if(/[.,!?;:'"`]/.test(last) || (pairs[last] && counts[last]> (counts[pairs[last]]||0))){counts[last]--;end--;}
    else break;
  }
  return end;
}

export function messageTextParts(text:string):MessageTextPart[] {
  const parts:MessageTextPart[]=[];
  const pattern=/\b(?:https?:\/\/|www\.)[^\s<>"`]+/gi;
  let previous=0,match:RegExpExecArray|null;
  while((match=pattern.exec(text))){
    const end=linkEnd(match[0]),label=match[0].slice(0,end),url=safeMessageUrl(label);
    if(!url)continue;
    if(match.index>previous)parts.push({text:text.slice(previous,match.index)});
    parts.push({text:label,url});previous=match.index+end;
  }
  if(previous<text.length)parts.push({text:text.slice(previous)});
  return parts.length?parts:[{text}];
}

export function messageLinkTargets(text:string):string[] {
  return [...new Set(messageTextParts(text).flatMap(part=>part.url?[part.url]:[]))].slice(0,5);
}
