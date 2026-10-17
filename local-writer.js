import {readCount,updateBaseline,dayInShanghai,syncError} from './local-counter.js';

export function browserStore(){
 const opening=new Promise((resolve,reject)=>{const r=indexedDB.open('tongzhuo-web-writer',1);r.onupgradeneeded=()=>r.result.createObjectStore('baselines',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});opening.catch(()=>{});
 async function run(mode,action){const db=await opening;return new Promise((resolve,reject)=>{const tx=db.transaction('baselines',mode),r=action(tx.objectStore('baselines'));let result;r.onsuccess=()=>result=r.result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('本机基线保存失败'))})}
 return {all:()=>run('readonly',s=>s.getAll()),put:row=>run('readwrite',s=>s.put(row))};
}

// Network functions take only an integer count and date. File handles stay local.
export function countTransport(client,userId){
 let key;
 return {
  async previous(day){const r=await client.from('writing_counts').select('delta').eq('writer_id',userId).eq('day',day).maybeSingle();if(r.error)throw r.error;return Number(r.data?.delta||0)},
  async send(day,delta){
   if(!Number.isInteger(delta)||Math.abs(delta)>10000000)throw Error('当日字数超出支持范围');
   if(!key){const r=await client.rpc('issue_writer_key');if(r.error)throw r.error;key=r.data.key}
   const r=await client.rpc('writer_sync',{p_key:key,p_day:day,p_delta:delta});
   if(r.error){key=undefined;throw r.error}
  },
  clear(){key=undefined}
 };
}

export function createLocalWriter({userId,transport,storage,onStatus,onCount,readFile=readCount,clock=Date.now}){
 let handle,entry,active=false,busy=false,generation=0,firstCount,firstSeen;
 return {
  get active(){return active},
  stop(){active=false;generation++;handle=null;transport.clear?.()},
  async select(selected){
   active=false;const version=++generation;transport.clear?.();
   const total=await readFile(selected);if(version!==generation)return;
   const rows=await storage.all();let found;
   for(const row of rows){if(row.userId!==userId)continue;try{if(await selected.isSameEntry(row.handle)){found=row;break}}catch{}}
   if(version!==generation)return;
   handle=selected;entry=found||{id:crypto.randomUUID(),userId,handle:selected,record:null};
   firstCount=total;firstSeen=clock();active=true;
   onStatus('已在本机读取 TXT，正在同步字数…');
   await this.tick();
  },
  async tick(){
   if(!active||busy)return;busy=true;const version=generation;let stage='read';
   try{
    const total=await readFile(handle);if(!active||version!==generation)return;
    const now=clock();
    // Carry today's existing cloud count when switching from the old helper.
    if(!entry.record){stage='network';const day=dayInShanghai(now),carry=await transport.previous(day);if(!active||version!==generation)return;const baseline=day===dayInShanghai(firstSeen)?firstCount-carry:total-carry;entry.record={day,baseline,lastCount:total,lastSeen:now}}
    const updated=updateBaseline(entry.record,total,now);entry.record=updated.record;
    onCount(updated.delta);stage='save';await storage.put(entry);
    if(!active||version!==generation)return;
    stage='network';await transport.send(entry.record.day,updated.delta);
    if(!active||version!==generation)return;
    onStatus('已同步 · '+new Date(now).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai'})+' · 正文留在本机，只发送日期和净增字数。');
   }catch(error){if(active&&version===generation)onStatus(syncError(stage,error))}
   finally{busy=false}
  }
 };
}

export function mountLocalWriter({root,client,userId,demo,onUpdate}){
 const q=id=>root.querySelector('#'+id);
 root.innerHTML=`<h3>选择正在写的 TXT</h3><p>继续用原来的软件写作；保存后，网页每 10 秒统计一次。不用安装插件，也不用填写连接码。</p><button id="txt-select" class="secondary">选择 TXT 并开始</button><button id="txt-stop" class="text-btn" disabled>暂停统计</button><p id="txt-file" class="fine">尚未选择文件</p><p id="txt-local-count" class="fine"></p><p id="txt-status" class="fine" role="status">需要电脑上的 Chrome / Edge，并保持此页打开。</p><p class="writing-private">正文在姐姐浏览器内存中读取和计数，不上传，也不写入浏览器存储。文件名和路径不上传。本机只保存文件授权句柄与字数基线。</p><p class="fine">第一次使用从选择时开始计数；已有的今日进度会续计。同一天重新选择同一文件可续计。刷新后请重新选择 TXT；关闭页面、休眠或浏览器暂停后台页会停止定时统计。未保存到磁盘的文字不计入。</p>`;
 let alive=true,release,lockTask,selecting=false;
 const transport=demo?{previous:async()=>0,send:async()=>{},clear(){}}:countTransport(client,userId);
 const controller=createLocalWriter({userId,transport,storage:demo?{all:async()=>[],put:async()=>{}}:browserStore(),onStatus:text=>{if(alive)q('txt-status').textContent=demo?'本地演示，不上传 · '+text:text},onCount:delta=>{if(!alive)return;q('txt-local-count').textContent='本机今日净增：'+delta.toLocaleString('zh-CN')+' 字';if(demo)onUpdate({delta,updated_at:new Date().toISOString()})}});
 const pause=()=>{controller.stop();release?.();release=null;q('txt-stop').disabled=true;q('txt-select').disabled=false;q('txt-status').textContent='已暂停，字数基线保留在这台电脑的浏览器中。'};
 q('txt-select').onclick=async()=>{
  if(selecting)return;selecting=true;
  try{
   if(!window.showOpenFilePicker)throw Error('此浏览器不能持续读取 TXT，请在电脑上的 Chrome / Edge 打开本网页。');
   const [file]=await showOpenFilePicker({multiple:false,types:[{description:'TXT 纯文本',accept:{'text/plain':['.txt']}}]});
   if(!alive)return;
   const start=async()=>{q('txt-file').textContent=file.name+'（仅姐姐本机显示）';q('txt-select').disabled=true;q('txt-stop').disabled=false;let done=new Promise(resolve=>{release=resolve});try{await controller.select(file);await done}catch(e){pause();if(alive)q('txt-status').textContent='无法开始：'+e.message}};
   if(!navigator.locks)throw Error('浏览器版本过旧，请更新 Chrome / Edge 后重试。');
   lockTask=navigator.locks.request('tongzhuo-txt-'+userId,{ifAvailable:true},async lock=>{if(!alive)return;if(!lock){q('txt-status').textContent='另一个页面正在统计，请先在那个页面点暂停。';return}await start()});
   lockTask.catch(e=>{if(alive)q('txt-status').textContent='无法开始：'+e.message});
  }catch(e){if(e.name!=='AbortError'&&alive)q('txt-status').textContent=e.message}
  finally{selecting=false}
 };
 q('txt-stop').onclick=pause;
 const timer=setInterval(()=>controller.tick(),10000),wake=()=>{if(!document.hidden)controller.tick()};
 document.addEventListener('visibilitychange',wake);window.addEventListener('online',wake);
 return {destroy(){alive=false;clearInterval(timer);controller.stop();release?.();document.removeEventListener('visibilitychange',wake);window.removeEventListener('online',wake)}};
}
