import { env } from 'cloudflare:workers';
export const dynamic = 'force-dynamic';
const headers = {'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const bucket = () => (env as unknown as {BUCKET:R2Bucket}).BUCKET;
const result = (v:unknown, status=200) => Response.json(v,{status,headers});
// Sites' owner-private access boundary protects all URLs, assets and APIs.
// Do not change this project's audience to public.
async function handle(req:Request) {
 try {
  const p=new URL(req.url).pathname.replace(/^\/api\/vault\/?/,'').split('/').filter(Boolean);
  const method=req.method;
  const origin=req.headers.get('origin');
  if(!['GET','HEAD'].includes(method) && origin && origin!==new URL(req.url).origin) return result({error:'不允許跨站更新'},403);
  if(p[0]==='profile' && p.length===1){
   if(method==='GET'){
    const o=await bucket().get('profile');
    return result(o?JSON.parse(await o.text()):null);
   }
   if(method==='POST'){
    const body=await req.text();
    if(body.length>4096)return result({error:'資料過大'},413);
    const v=JSON.parse(body);
    if(typeof v.salt!=='string'||v.salt.length>128||typeof v.check!=='string'||v.check.length>2048) return result({error:'格式錯誤'},400);
    const o=await bucket().put('profile',body,{onlyIf:{etagDoesNotMatch:'*'}});
    return o?result({ok:true},201):result({error:'保管箱已建立，請重新開啟並解鎖'},409);
   }
  }
  if(p[0]==='coupons'){
   if(p.length===1 && method==='GET'){
    const list=await bucket().list({prefix:'coupons/',limit:1000});
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(list.objects.map(o=>o.key+o.etag).join('|')));
    const tag=Array.from(new Uint8Array(bytes)).map(n=>n.toString(16).padStart(2,'0')).join('');
    if(req.headers.get('if-none-match')===tag)return new Response(null,{status:304,headers});
    const records=await Promise.all(list.objects.map(async o=>{
     const r=await bucket().get(o.key);
     return r?{id:o.key.slice(8),payload:await r.text(),revision:r.etag}:null;
    }));
    return result({items:records.filter(Boolean),tag});
   }
   if(p.length===2 && /^[a-zA-Z0-9-]{1,80}$/.test(p[1])){
    const key='coupons/'+p[1];
    if(method==='PUT'){
     const body=await req.text();
     if(body.length>1500000)return result({error:'圖片太大，請裁切後再匯入'},413);
     const v=JSON.parse(body);
     if(v.v!==1||typeof v.iv!=='string'||v.iv.length>128||typeof v.data!=='string'||v.data.length<4) return result({error:'必須上傳加密資料'},400);
     const revision=req.headers.get('if-match');
     const o=await bucket().put(key,body,{onlyIf:revision?{etagMatches:revision}:{etagDoesNotMatch:'*'}});
     return o?result({id:p[1],revision:o.etag}):result({error:'這張券已在另一個頁面更新，請重新整理後再試'},409);
    }
    if(method==='DELETE'){
     const revision=req.headers.get('if-match');
     const current=await bucket().head(key);
     if(!current)return result({ok:true});
     if(!revision||current.etag!==revision)return result({error:'票券已更新，請重新整理後再刪除'},409);
     await bucket().delete(key);
     return result({ok:true});
    }
   }
  }
  // User-supplied screenshot staging is protected by the same private boundary.
  // On first unlock the client encrypts this screenshot and removes the staging.
  if(p[0]==='inbox' && p.length===1){
   if(method==='GET'){
    const o=await bucket().get('inbox');
    return result(o?JSON.parse(await o.text()):null);
   }
   if(method==='PUT'){
    const body=await req.text();
    if(body.length>3000000)return result({error:'圖片太大'},413);
    const v=JSON.parse(body);
    if(typeof v.title!=='string'||typeof v.image!=='string'||!/^data:image\/(jpeg|png|webp);base64,/.test(v.image))return result({error:'格式錯誤'},400);
    const o=await bucket().put('inbox',body,{onlyIf:{etagDoesNotMatch:'*'}});
    return o?result({ok:true},201):result({error:'已有待匯入圖片'},409);
   }
   if(method==='DELETE'){await bucket().delete('inbox');return result({ok:true});}
  }
  return result({error:'找不到操作'},404);
 }catch {return result({error:'操作失敗，請檢查網路後重試'},500);}
}
export const GET=handle;
export const POST=handle;
export const PUT=handle;
export const DELETE=handle;
