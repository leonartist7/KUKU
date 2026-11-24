export type CallReadiness = {
  calls_enabled:boolean; provider_configured:boolean; secure_transport:boolean;
  configuration_ready:boolean; reason_codes:string[];
  provider_connection_tested:false; end_to_end_encryption:false;
};
export function callReadinessRows(status:CallReadiness|null, clientEnabled:boolean) {
  return [
    {label:"Calling",value:clientEnabled&&status?.calls_enabled?"Enabled for testing":"Not enabled yet"},
    {label:"Audio service",value:status?.provider_configured?"Setup saved":"Setup still needed"},
    {label:"Secure connection",value:status?.secure_transport?"Encrypted transport required":"Waiting for secure setup"},
    {label:"Two-phone audio check",value:"Not verified"},
  ];
}
export async function checkMicrophoneAccess(
  capture:()=>Promise<{getTracks:()=>{stop:()=>void}[]}>, current:()=>boolean,
) {
  if(!current())return false;
  const stream=await capture();
  try{return current();}
  finally{for(const track of stream.getTracks()){try{track.stop();}catch{/* Stop every acquired track. */}}}
}
