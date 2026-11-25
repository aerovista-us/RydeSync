// Provider-side admission boundary. No HTTP route, public-join override, or broker minting here.
// Only an already verified provider principal may request a token; authority callbacks must be server-side.
const deny=(status,code)=>{throw Object.assign(new Error(code),{status,code})};
const id=x=>typeof x==='string'&&/^[A-Za-z0-9:_-]{1,128}$/.test(x);
const roles=new Set(['host','rider']);
export function createPrivateRoomAdmission({lookupGrant,lookupMember,issueToken,now=()=>Date.now()}={}){
 const enabled=typeof lookupGrant==='function'&&typeof lookupMember==='function'&&typeof issueToken==='function';
 async function admission({principal,experienceId,roomId}){
  if(!enabled)deny(503,'private_admission_unavailable');
  if(principal?.authenticated!==true||principal.authState!=='verified'||!id(principal.identityId))deny(401,'identity_required');
  if(!id(experienceId)||!id(roomId))deny(400,'invalid_room_reference');
  const identityId=principal.identityId;
  const valid=g=>g?.allowed===true&&g.appId==='rydesync'&&g.experienceId===experienceId&&g.roomId===roomId&&g.identityId===identityId&&roles.has(g.role)&&id(g.grantId)&&g.revoked!==true&&Number.isSafeInteger(g.expiresAt)&&g.expiresAt>now();
  const request={identityId,experienceId,roomId,appId:'rydesync'};
  let grant,member,fresh;
  try{grant=await lookupGrant(request);if(!valid(grant))deny(403,'room_grant_required');member=await lookupMember({roomId,identityId,role:grant.role});fresh=await lookupGrant(request)}catch(e){if(e?.code==='room_grant_required')throw e;deny(503,'private_authority_unavailable')}
  if(!valid(fresh)||fresh.grantId!==grant.grantId||fresh.role!==grant.role)deny(403,'room_grant_changed');
  if(member?.roomId!==roomId||member.identityId!==identityId||member.role!==fresh.role||!id(member.id)||!Number.isSafeInteger(member.expiresAt)||member.expiresAt<=now())deny(403,'provider_membership_required');
  const expiresAt=Math.min(fresh.expiresAt,member.expiresAt,now()+60000);
  if(expiresAt-now()<1000)deny(403,'room_grant_expiring');
  // Existing provider issuer, not a new identity token. Caller must enforce revocation during realtime access.
  const token=issueToken({roomId,memberId:member.id,identityId,role:member.role,ttlSeconds:Math.floor((expiresAt-now())/1000)});
  if(typeof token!=='string'||!token)deny(503,'room_token_unavailable');
  return {roomId,memberId:member.id,role:member.role,token,expiresAt};
 }
 return Object.freeze({admit:admission});
}
