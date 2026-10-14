const LOCK_ICON="<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" aria-hidden=\"true\"><rect x=\"5\" y=\"10\" width=\"14\" height=\"11\" rx=\"3\"/><path d=\"M8 10V7a4 4 0 018 0v3\"/><path d=\"M12 14v3\"/></svg>";
const TICKET_ICON="<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" aria-hidden=\"true\"><path d=\"M4 5h16v5a2 2 0 000 4v5H4v-5a2 2 0 000-4V5z\"/><path d=\"M15 5v3m0 3v2m0 3v3\"/></svg>";
function foodIcon(title='') {
 const cup='<path d="M17 5h12l-2 24h-8L17 5z" fill="#fffaf0" stroke="#21211f" stroke-width="1.8"/><path d="M15 5h16M23 5V1h6" fill="none" stroke="#21211f" stroke-width="1.8"/><path d="M21 12h6" stroke="#f9b827" stroke-width="4"/>';
 const fries='<path d="M8 16h18l-2 15H11L8 16z" fill="#ec4c32"/><path d="M11 16V7m5 9V3m5 13V6m4 10V9" stroke="#f6c64a" stroke-width="3.4"/>';
 const nuggets='<path d="M5 17c0-6 8-7 11-3s2 10-4 11-7-3-7-8zM17 23c1-6 9-6 12-2s0 10-6 10-7-3-6-8zM19 8c3-5 12-2 12 3s-4 8-9 7-6-6-3-10z" fill="#edb64a" stroke="#c38e2d" stroke-width="1.3"/>';
 return '<svg viewBox="0 0 36 36" aria-hidden="true">'+(/雞塊/.test(title)?nuggets:/薯/.test(title)?fries:/茶|咖啡|飲料/.test(title)?cup:nuggets)+'</svg>';
}
const $ = id => document.getElementById(id);
const enc = new TextEncoder();
const dec = new TextDecoder();
let user = null, vaultKey = null, unsub = null, profile = null, syncTag = '';
let syncing = false;
let coupons = [], mode = 'login', filter = 'unused', activeId = null, name = localStorage.getItem('family_coupon_name') || '';
let lastActivity = Date.now(), cryptoSalt = '', syncGeneration = 0, loading = false;
const weekdays = new Intl.DateTimeFormat('zh-TW', {timeZone:'Asia/Taipei', year:'numeric',month:'2-digit',day:'2-digit'});

function notify(msg,ms=3000) { const n=$('notice'); n.textContent=msg; n.hidden=false; clearTimeout(notify.t); notify.t=setTimeout(()=>n.hidden=true,ms); }
function fail(msg) { notify(msg,4800); }
function errtext(e) { return e?.name==='OperationError'?'保管箱 PIN不正確':e?.message||'操作失敗，請檢查網路後重試'; }
async function api(path,method='GET',body=null,extra={}) {
 const r=await fetch('/api/vault/'+path,{method,cache:'no-store',headers:{'Content-Type':'application/json',...extra},body:body===null?null:typeof body==='string'?body:JSON.stringify(body)});
 if(r.status===304)return null;
 let v;try{v=await r.json();}catch{throw Error('登入狀態失效，請重新開啟網站');}
 if(!r.ok)throw Error(v?.error||'伺服器暫時無法連線');
 return v;
}
async function configureAuth(){
 profile=await api('profile');mode=profile?'login':'register';
 $('confirmWrap').hidden=!!profile;
 $('authSubmit').textContent=profile?'打開我的票券 ↗':'設定 PIN，開始收藏 ↗';
 const legacy=profile&&profile.pinLength!==6;
 $('password').maxLength=legacy?200:6;$('password').minLength=legacy?1:6;$('password').pattern=legacy?'.*':'[0-9]{6}';$('password').inputMode=legacy?'text':'numeric';
 $('password').placeholder=legacy?'輸入原保管箱 PIN':'••••••';
 $('confirm').required=!profile;
 $('password').setAttribute('autocomplete',profile?'current-password':'new-password');
}

function bytesToB64(bytes){let s='';for(let i=0;i<bytes.length;i+=8192){s+=String.fromCharCode(...bytes.subarray(i,i+8192));}return btoa(s);}
function b64ToBytes(s){const raw=atob(s);const a=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)a[i]=raw.charCodeAt(i);return a;}
async function getKey(password, salt) {
 const km=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'PBKDF2',salt:b64ToBytes(salt),iterations:310000,hash:'SHA-256'},km,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
async function encryptObject(obj) {
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},vaultKey,enc.encode(JSON.stringify(obj))));
 return JSON.stringify({v:1,iv:bytesToB64(iv),data:bytesToB64(ct)});
}
async function decryptObject(payload) {
 const pack=JSON.parse(payload);
 if(pack.v!==1)throw Error('unsupported vault format');
 const buf=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64ToBytes(pack.iv)},vaultKey,b64ToBytes(pack.data));
 return JSON.parse(dec.decode(buf));
}
function showAuth(){
 user=null;vaultKey=null;cryptoSalt='';coupons=[];activeId=null;syncTag='';syncGeneration++;$('cards').replaceChildren();
 if(unsub){unsub();unsub=null;}
 $('main').hidden=true;$('auth').hidden=false;$('password').value='';$('confirm').value='';
}
function showAuthErr(message){const p=$('authError');p.hidden=false;p.textContent=message;}
async function submitAuth(ev){
 ev.preventDefault();if(loading)return;
 const password=$('password').value;
 if((mode==='register'||profile?.pinLength===6)&&!/^\d{6}$/.test(password)){showAuthErr('請輸入 6 位數字');return;}
 if(mode==='register'&&password!==$('confirm').value){showAuthErr('兩次輸入的數字不一致');return;}
 loading=true;$('authSubmit').disabled=true;$('authError').hidden=true;
 try{
  if(!profile){
   cryptoSalt=bytesToB64(crypto.getRandomValues(new Uint8Array(24)));
   vaultKey=await getKey(password,cryptoSalt);
   const candidate={salt:cryptoSalt,pinLength:6,check:await encryptObject({ok:'private-vault-v1'})};
   await api('profile','POST',candidate);profile=candidate;
  }else{
   cryptoSalt=profile.salt;vaultKey=await getKey(password,cryptoSalt);
   const check=await decryptObject(profile.check);if(check.ok!=='private-vault-v1')throw Error('保管箱 PIN不正確');
  }
  user=true;lastActivity=Date.now();
  $('password').value='';$('confirm').value='';$('auth').hidden=true;$('main').hidden=false;$('identityPrompt').hidden=true;
  name='我';await refresh();subscribe();
  await importInbox();
 }catch(e){if(!user){vaultKey=null;await configureAuth().catch(()=>{});}showAuthErr(errtext(e));if(user)fail(errtext(e));}
 finally{loading=false;$('authSubmit').disabled=false;}
}
async function refresh(){
 if(!user||syncing)return;syncing=true;
 const gen=syncGeneration, key=vaultKey;
 try{
  const records=await api('coupons','GET',null,syncTag?{'If-None-Match':syncTag}:{});
  if(records===null)return;
  const got=[];for(const d of records.items){const c=await decryptObject(d.payload);got.push({...c,id:d.id,revision:d.revision});}
  if(gen!==syncGeneration||key!==vaultKey||!user)return;
  coupons=got;syncTag=records.tag;
  $('listSubtitle').textContent=`共 ${coupons.length} 張兌換券 · 私密同步`;
  $('syncState').textContent='● 已同步';$('syncState').className='sync-chip';render();
 }finally{syncing=false;}
}
function subscribe(){
 if(unsub)unsub();
 const timer=setInterval(()=>{if(user&&!document.hidden&&navigator.onLine)refresh().catch(e=>{fail(errtext(e));$('syncState').textContent='● 同步失敗';});},15000);
 unsub=()=>clearInterval(timer);
}
async function importInbox(){
 const pending=await api('inbox');if(!pending)return;
 const id=pending.id;
 if(!coupons.some(c=>c.id===id)){
  const data={title:pending.title,expiry:pending.expiry,image:pending.image,fingerprint:await fingerprint(pending.image),notes:'上傳的票券；使用狀態待確認',used:false,usedAt:null,usedBy:'',createdAt:Date.now(),updatedAt:Date.now()};
  const payload=await encryptObject(data);await api('coupons/'+id,'PUT',payload);syncTag='';await refresh();
 }
 await api('inbox','DELETE');notify('已加入你上傳的雞塊＋綠茶兌換券；請確認是否已使用',6000);
}

function getExpired(c){return !!(c.expiry && c.expiry < new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));}
function formatDate(s){return s ? s.replaceAll('-','/'):'未設定效期';}
function render(){
 const unused=coupons.filter(c=>!c.used&&!getExpired(c)).length;
 const used=coupons.filter(c=>c.used).length;
 const expired=coupons.filter(c=>!c.used&&getExpired(c)).length;
 $('countUnused').textContent=unused;$('countUsed').textContent=used;$('countExpired').textContent=expired;
 const key=$('search').value.trim().toLocaleLowerCase();
 const filtered=coupons.filter(c => (filter==='all'||(filter==='used'?c.used:filter==='expired'?!c.used&&getExpired(c):!c.used&&!getExpired(c))) &&
   ((c.title||'').toLocaleLowerCase().includes(key)||(c.notes||'').toLocaleLowerCase().includes(key)));
 const order=$('sort').value;
 filtered.sort((a,b)=>order==='name'?(a.title||'').localeCompare(b.title||'','zh-Hant'):
  order==='recent'?(b.updatedAt||0)-(a.updatedAt||0):
   (a.used===b.used?0:a.used?1:-1) || (a.expiry||'9999-12-31').localeCompare(b.expiry||'9999-12-31'));
 const host=$('cards');host.replaceChildren();
 if(!filtered.length){
   const el=document.createElement('div');el.className='empty';
   el.innerHTML='<div class="empty-icon">'+TICKET_ICON+'</div><b>口袋還有空位</b><span>匯入相簿裡的票券，把美味收好。</span>';
   host.append(el);return;
 }
 for(const c of filtered){
  const card=document.createElement('article');card.className='card';
  card.innerHTML='<div class="card-label"><span>McDonald’s</span><span class="pill"></span></div><div class="card-top"><span class="food-emoji">'+foodIcon(c.title)+'</span><div class="card-head"><strong></strong><div class="meta"></div><div class="used-by"></div></div></div><div class="card-bottom"><button class="btn primary view" type="button">出示票券 ↗</button><button class="btn outline state" type="button"></button></div>';
  card.querySelector('strong').textContent=c.title||'未命名兌換券';
  card.querySelector('.meta').textContent=`有效至 ${formatDate(c.expiry)}`;
  const badge=card.querySelector('.pill');const expired=getExpired(c);
  badge.className='pill '+(c.used?'used':expired?'expired':'unused');
  badge.textContent=(c.pending?'同步中 · ':'')+(c.used?'已使用':expired?'已過期':'未使用');
  if(c.used){card.querySelector('.used-by').textContent=`${c.usedBy||'我'} · ${c.usedAt ? new Date(c.usedAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}):'已兌換'}`;}
  card.querySelector('.view').addEventListener('click',()=>showDetail(c.id));
  const s=card.querySelector('.state');s.className='btn outline state';s.textContent=c.used?'恢復未用':'標記已用';
  s.disabled=Boolean(c.pending);s.addEventListener('click',()=>toggleUsed(c.id));
  host.append(card);
 }
}
function updateConnectivity(){
 const online=navigator.onLine;
 $('offlineMessage').hidden=online;
 $('syncState').textContent=online?'● 已連接雲端':'● 網路離線';
 $('syncState').className='sync-chip'+(online?'':' offline');
}
function closeModal(){const m=$('modal');m.hidden=true;document.body.classList.remove('modal-open');$('modalBody').replaceChildren();activeId=null;}
function openModal(title,eyebrow='私密同步'){$('modalTitle').textContent=title;$('modalEyebrow').textContent=eyebrow;$('modalBody').replaceChildren();$('modal').hidden=false;document.body.classList.add('modal-open');}
async function readDataUrl(file){
 if(!file) return '';
 if(!file.type.startsWith('image/')||file.type==='image/svg+xml'||file.type==='image/gif')throw new Error('請選擇 JPG、PNG 或 WebP 圖片');
 let data=await new Promise((ok,fail)=>{const f=new FileReader();f.onload=()=>ok(String(f.result));f.onerror=fail;f.readAsDataURL(file);});
 if(data.length<560000)return data;
 // 拍照檔案過大時保留足夠像素，再做高品質壓縮，避免超出 Firestore 1MB 限制。
 const img=new Image();img.src=data;await img.decode();
 const maxSide=1900,scale=Math.min(1,maxSide/Math.max(img.naturalWidth,img.naturalHeight));
 const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
 canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
 for(const quality of [.94,.87,.78,.68]){
   data=canvas.toDataURL('image/jpeg',quality);if(data.length<560000)return data;
 }
 throw new Error('圖片檔案太大，請先在手機裁切圖片後重新匯入');
}
function validateOnline(){if(!navigator.onLine){fail('網路離線，請連線後再更新資料');return false;}return true;}
async function saveCoupon(data,id=null,createId=null){
 if(!user||!vaultKey)throw Error('請先解鎖保管箱');
 const gen=syncGeneration,payload=await encryptObject(data);
 if(gen!==syncGeneration||!user)throw Error('保管箱已鎖定，請重新解鎖');
 if(payload.length>=1500000)throw Error('照片太大，請先裁切圖片再新增');
 const current=id?coupons.find(c=>c.id===id):null;
 const rid=id||createId||crypto.randomUUID();
 if(id&&!current)throw Error('找不到票券，請重新整理');
 const saved=await api('coupons/'+rid,'PUT',payload,current?{'If-Match':current.revision}:{});
 if(gen!==syncGeneration||!user)return rid;
 coupons=coupons.filter(c=>c.id!==rid);coupons.push({...data,id:rid,revision:saved.revision});syncTag='';
 $('listSubtitle').textContent=`共 ${coupons.length} 張兌換券 · 私密同步`;render();return rid;
}

function showEdit(id=null){
 if(!validateOnline())return;
 const c=id?coupons.find(v=>v.id===id):null;
 openModal(c?'編輯兌換券':'新增兌換券',c?'修改商品品項與到期日':'照片只會以加密形式上傳');
 const div=document.createElement('div');div.className='edit-form';
 div.innerHTML=`<form id="editForm"><label>商品品項 *<input id="editTitle" required maxlength="100" placeholder="例如：辣味雞腿＋小薯" /></label><label>兌換期限<input id="editExpiry" type="date" /></label><label>兌換券照片／QR Code<input id="editFile" type="file" accept="image/*" /></label><p id="imageInfo" class="form-note">照片只會在解鎖後顯示；允許保留原圖。</p><label>備註（選填）<textarea id="editNotes" maxlength="300" placeholder="例如：兌換時不適用自助點餐機"></textarea></label><div class="row-actions"><button class="btn outline" type="button" id="cancelEdit">取消</button><button class="btn primary" type="submit" id="saveEdit">儲存並同步</button></div></form>`;
 $('modalBody').append(div);
 $('editTitle').value=c?.title||'';$('editExpiry').value=c?.expiry||'';$('editNotes').value=c?.notes||'';
 $('imageInfo').textContent=c?.image?'目前有保存圖片；若沒有重新選擇，將保留原圖。':'請選擇兌換券截圖，QR Code 不會公開顯示。';
 $('cancelEdit').onclick=closeModal;
 $('editForm').onsubmit=async event=>{
   event.preventDefault();if(!validateOnline())return;
   const btn=$('saveEdit');btn.disabled=true;btn.textContent='加密同步中...';
   try{
      const file=$('editFile').files[0];let image=c?.image||'';
      if(file)image=await readDataUrl(file);const fp=image?await fingerprint(image):'';
      const data={fingerprint:fp,title:$('editTitle').value.trim(),expiry:$('editExpiry').value,notes:$('editNotes').value.trim(),image,
        used:!!c?.used,usedAt:c?.usedAt||null,usedBy:c?.usedBy||'',createdAt:c?.createdAt||Date.now(),updatedAt:Date.now()};
      if(!data.title)throw new Error('請輸入品項名稱');
      await saveCoupon(data,c?.id||null);
      closeModal();notify('✓ 已安全儲存並同步');
   }catch(e){fail(e?.message?.startsWith('照片')||e?.message?.startsWith('請')?e.message:errtext(e));}
   finally{btn.disabled=false;btn.textContent='儲存並同步';}
 };
}
function showDetail(id){
 const c=coupons.find(v=>v.id===id);if(!c)return;
 activeId=id;openModal(c.title,'兌換券詳細資料');
 const body=$('modalBody');
 const info=document.createElement('div');info.className='details';info.textContent=`到期日：${formatDate(c.expiry)} · 狀態：${c.used?'已使用':getExpired(c)?'已過期':'未使用'}`;body.append(info);
 if(c.used){const used=document.createElement('p');used.className='used-by';used.textContent=`最後使用者：${c.usedBy||'我'} ${c.usedAt?new Date(c.usedAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}):''}`;body.append(used);}
 if(c.notes){const notes=document.createElement('p');notes.className='details';notes.textContent=`備註：${c.notes}`;body.append(notes);}
 if(c.image){
   const cover=document.createElement('div');cover.className='preview-cover';
   cover.innerHTML='<div class="preview-lock">'+LOCK_ICON+'</div><strong>準備兌換了嗎？</strong><p class="muted">兌換碼平常收好，需要時再出示。</p><button type="button" class="btn primary">顯示兌換碼 ↗</button>';
   body.append(cover);
   cover.querySelector('button').onclick=()=>{
     cover.replaceChildren();const div=document.createElement('div');div.className='photo-scroll';
     const img=document.createElement('img');img.className='voucher-image';img.alt='兌換券原始圖片（含兌換碼）';img.referrerPolicy='no-referrer';img.src=c.image;div.append(img);cover.append(div);
     const zoom=document.createElement('button');zoom.className='btn outline';zoom.style.marginTop='12px';zoom.textContent='放大原圖';
     zoom.onclick=()=>{div.classList.toggle('zoom');zoom.textContent=div.classList.contains('zoom')?'縮回適合畫面':'放大原圖';};cover.append(zoom);
   };
 }else{const hint=document.createElement('p');hint.className='warning';hint.textContent='此票券尚未加入兌換碼圖片，可透過編輯補上。';body.append(hint);}
 const actions=document.createElement('div');actions.className='row-actions';
 const editBtn=document.createElement('button');editBtn.className='btn outline';editBtn.textContent='編輯品項';editBtn.onclick=()=>showEdit(c.id);actions.append(editBtn);
 const usedBtn=document.createElement('button');usedBtn.className='btn '+(c.used?'outline':'green');usedBtn.textContent=c.used?'恢復未使用':'✓ 標記已使用';usedBtn.onclick=async()=>{closeModal();await toggleUsed(c.id);};actions.append(usedBtn);
 body.append(actions);
 const remove=document.createElement('button');remove.type='button';remove.className='btn danger';remove.style.marginTop='13px';remove.style.width='100%';remove.textContent='刪除這張兌換券';
 remove.onclick=async()=>{
  if(!validateOnline()||!confirm(`確定永久刪除「${c.title}」嗎？刪除後無法恢復。`))return;
  try{await api('coupons/'+c.id,'DELETE',null,{'If-Match':c.revision});coupons=coupons.filter(x=>x.id!==c.id);syncTag='';render();closeModal();notify('已刪除兌換券');}catch(e){fail(errtext(e));}
 };
 body.append(remove);
}
async function toggleUsed(id){
 if(!validateOnline())return;
 const c=coupons.find(v=>v.id===id);if(!c)return;
 const message=c.used?'確定恢復成「未使用」？這會同步更新你的其他裝置。':`確定「${c.title}」已完成兌換？這是手動紀錄，不會向麥當勞查詢核銷狀態。`;
 if(!confirm(message))return;
 try{
   const fresh={fingerprint:c.fingerprint||'',title:c.title,expiry:c.expiry||'',notes:c.notes||'',image:c.image||'',
      used:!c.used,usedAt:c.used?null:Date.now(),usedBy:c.used?'':name||'我',createdAt:c.createdAt||Date.now(),updatedAt:Date.now()};
   await saveCoupon(fresh,c.id);
   notify(c.used?'已恢復為未使用':'✓ 已標記使用並同步');
 }catch(e){fail(errtext(e));}
}
async function fingerprint(image){return bytesToB64(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(image))));}
function batchImport(files){
 if(!validateOnline()||!files.length)return;
 const valid=[...files].filter(f=>/^image\/(jpeg|png|webp)$/.test(f.type));
 if(!valid.length){fail('請選擇 JPG、PNG 或 WebP 圖片');return;}
 openModal('批次匯入 '+valid.length+' 張','一次整理手機相簿裡的票券');
 const form=document.createElement('form');form.className='edit-form';
 form.innerHTML='<label>共同品項（可留空，匯入後逐張編輯）<input id="batchTitle" maxlength="100" placeholder="例如：麥克雞塊 6 塊＋無糖綠茶（小）"></label><label>共同兌換期限（選填）<input id="batchExpiry" type="date"></label><p class="muted">每張照片會分別保存為一張券。已用／未用由你手動標記。</p><button type="submit" class="btn primary wide">加密匯入</button>';
 $('modalBody').append(form);
 form.onsubmit=async e=>{
  e.preventDefault();const title=$('batchTitle').value.trim(),expiry=$('batchExpiry').value;const gen=syncGeneration;
  closeModal();loading=true;$('batchAdd').disabled=true;$('addBtn').disabled=true;$('pendingMessage').hidden=false;
  let ok=0,bad=0,duplicates=0;
  try{
   for(let i=0;i<valid.length;i++){
    if(!user||gen!==syncGeneration)break;
    lastActivity=Date.now();notify(`正在加密匯入 ${i+1}/${valid.length} 張…`,5000);
    try{
     const photo=await readDataUrl(valid[i]),fp=await fingerprint(photo);
     if(coupons.some(c=>c.fingerprint===fp)){duplicates++;continue;}
     const data={title:title||`待填品項 ${String(coupons.length+1).padStart(2,'0')}`,expiry,notes:'',image:photo,fingerprint:fp,used:false,usedAt:null,usedBy:'',createdAt:Date.now(),updatedAt:Date.now()};
     await saveCoupon(data);ok++;
    }catch{bad++;}
   }
   notify(`已匯入 ${ok} 張${duplicates?`，略過 ${duplicates} 張重複照片`:''}${bad?`，${bad} 張失敗，請重新匯入`:''}`,6000);
  }finally{loading=false;$('batchAdd').disabled=false;$('addBtn').disabled=false;$('pendingMessage').hidden=true;$('batchFiles').value='';}
 };
}

function settings(){
 openModal('保管箱設定','僅限本人存取');
 const el=document.createElement('div');
 el.innerHTML='<div class="privacy-tag">🔒 ChatGPT 帳號存取限制＋保管箱 PIN加密</div><p class="details">品項、照片和使用紀錄會先在裝置上加密，再同步至雲端。同一個 ChatGPT 帳號及保管箱 PIN可在你的其他裝置使用。</p><p class="muted">忘記保管箱 PIN將無法解密票券，請保存在你的密碼管理工具。閒置 5 分鐘自動鎖定，切到背景時隱藏兌換碼。</p><p class="muted">使用狀態是手動標記，與麥當勞核銷系統無連動。</p><button type="button" id="exportBackup" class="btn outline wide">下載加密備份</button><p class="muted">備份需使用原密碼解鎖。</p><label class="muted">還原此保管箱的加密備份<input type="file" id="restoreBackup" accept="application/json,.json"></label><a href="/signout-with-chatgpt?return_to=%2F" target="_top" class="text-btn">登出 ChatGPT 網站登入</a>';
 $('modalBody').append(el);
 $('exportBackup').onclick=async()=>{
  try{
   const records=await api('coupons');const blob=new Blob([JSON.stringify({version:1,profile,records:records.items})],{type:'application/json'});
   const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download='private-voucher-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);notify('已下載加密備份');
  }catch(e){fail(errtext(e));}
 };
 $('restoreBackup').onchange=async e=>{
  try{
   const f=e.target.files[0];if(!f)return;if(f.size>50000000)throw Error('備份檔太大');
   const b=JSON.parse(await f.text());if(b.version!==1||b.profile?.salt!==profile.salt||!Array.isArray(b.records)||b.records.length>200)throw Error('這不是目前保管箱的有效備份');
   const known=new Set(coupons.map(c=>c.id));let count=0;
   for(const r of b.records){if(known.has(r.id))continue;const c=await decryptObject(r.payload);await saveCoupon(c,null,r.id);known.add(r.id);count++;}
   closeModal();notify(`已還原 ${count} 張券，已有的紀錄保持不變`);
  }catch(e){fail(errtext(e));}
 };
}

function saveName(v){name=String(v||'').trim().slice(0,25)||'我';localStorage.setItem('family_coupon_name',name);$('identityPrompt').hidden=true;}
async function logout(){closeModal();showAuth();await configureAuth().catch(e=>showAuthErr(errtext(e)));}
async function init(){
 
 $('authForm').addEventListener('submit',submitAuth);
 $('closeModal').addEventListener('click',closeModal);
 $('modal').addEventListener('click',ev=>{if(ev.target===$('modal'))closeModal();});
 $('addBtn').addEventListener('click',()=>showEdit());
 $('batchAdd').onclick=()=>{if(validateOnline())$('batchFiles').click();};
 $('batchFiles').onchange=ev=>batchImport(ev.target.files);
 $('logoutBtn').onclick=logout;
 $('settingsBtn').onclick=settings;
 $('search').oninput=render;
 $('sort').onchange=render;
 document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>{
   filter=b.dataset.filter;document.querySelectorAll('.tab').forEach(t=>(t.classList.toggle('active',t===b),t.setAttribute('aria-selected',String(t===b))));render();
 }));
 document.querySelectorAll('[data-name]').forEach(b=>b.onclick=()=>saveName(b.dataset.name));
 $('customName').onclick=()=>{const entered=prompt('請輸入在家中的稱呼，例如：爸爸、媽媽');if(entered)saveName(entered);};
 window.addEventListener('online',updateConnectivity);window.addEventListener('offline',updateConnectivity);
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('modal').hidden)closeModal();});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)closeModal();else if(user && Date.now()-lastActivity>300000)logout();});
 for(const e of ['pointerdown','keydown','touchstart'])window.addEventListener(e,()=>lastActivity=Date.now(),{passive:true});
 setInterval(()=>{if(user && Date.now()-lastActivity>300000)logout();},20000);
 try{
  if(!crypto?.subtle)throw Error('請使用 Safari 或 Chrome 開啟 HTTPS 網站');
  $('authSubmit').disabled=true;await configureAuth();$('authSubmit').disabled=false;
 }catch(e){showAuthErr(errtext(e));}

}
init();
