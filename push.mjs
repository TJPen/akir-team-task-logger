// RFC 8291 (aes128gcm) and RFC 8292 (VAPID), using the Workers Web Crypto API.
const enc = new TextEncoder();
export const bytes = s => enc.encode(s);
export function b64(a) { return btoa(String.fromCharCode(...new Uint8Array(a))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,''); }
export function unb64(s) { return Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')), c=>c.charCodeAt(0)); }
export function concat(...xs) { const a=new Uint8Array(xs.reduce((n,x)=>n+x.length,0)); let i=0; for(const x of xs){a.set(x,i);i+=x.length;} return a; }
async function hkdf(ikm,salt,info,length) {
 const key=await crypto.subtle.importKey('raw',ikm,'HKDF',false,['deriveBits']);
 return new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info},key,length*8));
}
export function validEndpoint(endpoint) {
 try { const u=new URL(endpoint); return u.protocol==='https:' && !u.username && !u.password && !u.port && !u.hash && (
 u.hostname==='fcm.googleapis.com' || u.hostname==='updates.push.services.mozilla.com' || u.hostname.endsWith('.push.services.mozilla.com') ||
 u.hostname==='web.push.apple.com' || u.hostname.endsWith('.push.apple.com') || u.hostname.endsWith('.notify.windows.com'));
 } catch { return false; }
}
export async function encryptPayload(subscription,payload) {
 const ua=unb64(subscription.p256dh), auth=unb64(subscription.auth);
 const pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
 const pub=new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey));
 const peer=await crypto.subtle.importKey('raw',ua,{name:'ECDH',namedCurve:'P-256'},false,[]);
 const shared=await crypto.subtle.deriveBits({name:'ECDH',public:peer},pair.privateKey,256);
 const ikm=await hkdf(shared,auth,concat(bytes('WebPush: info\0'),ua,pub),32);
 const salt=crypto.getRandomValues(new Uint8Array(16));
 const cek=await hkdf(ikm,salt,bytes('Content-Encoding: aes128gcm\0'),16);
 const nonce=await hkdf(ikm,salt,bytes('Content-Encoding: nonce\0'),12);
 const key=await crypto.subtle.importKey('raw',cek,'AES-GCM',false,['encrypt']);
 const plaintext=bytes(JSON.stringify(payload));
 if(plaintext.length>3000) throw new Error('Push payload exceeds limit');
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce},key,concat(plaintext,new Uint8Array([2])));
 const header=new Uint8Array(21);header.set(salt);new DataView(header.buffer).setUint32(16,4096);header[20]=65;
 return concat(header,pub,new Uint8Array(encrypted));
}
export async function pushRequest(subscription,payload,env) {
 if(!validEndpoint(subscription.endpoint)) throw new Error('Invalid push endpoint');
 const data=b64(bytes(JSON.stringify({typ:'JWT',alg:'ES256'})))+'.'+b64(bytes(JSON.stringify({aud:new URL(subscription.endpoint).origin,exp:Math.floor(Date.now()/1000)+3600,sub:env.APP_ORIGIN})));
 const key=await crypto.subtle.importKey('jwk',JSON.parse(env.VAPID_PRIVATE),{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
 const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,bytes(data));
 return {method:'POST',redirect:'error',headers:{Authorization:`vapid t=${data}.${b64(signature)}, k=${env.VAPID_PUBLIC}`,'Content-Encoding':'aes128gcm','Content-Type':'application/octet-stream',TTL:'3600',Urgency:'normal'},body:await encryptPayload(subscription,payload),signal:AbortSignal.timeout(8000)};
}
export async function sendPush(subscription,payload,env) { return fetch(subscription.endpoint,await pushRequest(subscription,payload,env)); }
