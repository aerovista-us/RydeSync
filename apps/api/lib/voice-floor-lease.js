import {randomUUID} from 'node:crypto';
export const FLOOR_LEASE_MS=5000, MAX_TX_MS=60000;
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(x);
// One instance per room. Actor is derived from authenticated WebSocket, never message fields.
export function createVoiceFloor({now=()=>Date.now(),makeId=randomUUID}={}){
 let held=null;
 const copy=()=>held?{...held}:null;
 const expire=()=>{if(held&&now()>=held.expiresAt){const prior=copy();held=null;return prior}return null};
 const matches=(actor,floorId,requestId)=>held&&actor?.memberId===held.memberId&&actor?.connectionId===held.connectionId&&floorId===held.floorId&&requestId===held.requestId;
 const allowed=actor=>actor?.authorized===true&&validId(actor.memberId)&&validId(actor.connectionId)&&Number.isFinite(actor.expiresAt)&&actor.expiresAt>now();
 function request(actor,requestId){
  const expired=expire();
  if(!allowed(actor)||!validId(requestId))return {ok:false,reason:'forbidden',expired};
  if(held){if(matches(actor,held.floorId,requestId))return {ok:true,duplicate:true,floor:copy(),expired};return {ok:false,reason:'busy',memberId:held.memberId,expired}}
  const t=now();held={memberId:actor.memberId,connectionId:actor.connectionId,requestId,floorId:makeId(),startedAt:t,expiresAt:Math.min(t+FLOOR_LEASE_MS,actor.expiresAt)};
  return {ok:true,floor:copy(),expired};
 }
 function renew(actor,floorId,requestId){
  const expired=expire();if(!allowed(actor)||!matches(actor,floorId,requestId))return {ok:false,reason:'stale_or_forbidden',expired};
  held.expiresAt=Math.min(now()+FLOOR_LEASE_MS,held.startedAt+MAX_TX_MS,actor.expiresAt);return {ok:true,floor:copy(),expired};
 }
 function release(actor,floorId,requestId){
  const expired=expire();if(!matches(actor,floorId,requestId))return {ok:false,expired};const prior=copy();held=null;return {ok:true,released:prior,expired};
 }
 function revoke(actor){if(held&&actor?.memberId===held.memberId&&actor?.connectionId===held.connectionId){const prior=copy();held=null;return prior}return null}
 return Object.freeze({request,renew,release,revoke,expire,current:copy});
}
