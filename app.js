const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const previous=d=>new Date(Date.parse(d+'T12:00:00Z')-86400000).toISOString().slice(0,10);
const roles={1:{name:'姐姐',goal:'写书',icon:'✎',heading:'姐姐，今天写下了什么？',subject:'比如：完成第一章 / 修改人物小传',note:'今天写了哪段故事？人物或情节有什么新想法？'},2:{name:'鼠鼠',goal:'做游戏',icon:'🐭',heading:'鼠鼠，今天做出了什么？',subject:'比如：实现移动系统 / 完成关卡原型',note:'今天实现了什么？遇到了什么问题？下一步做什么？'}};
const roleOf=p=>roles[p?.slot]||roles[1];
const nameOf=p=>roleOf(p).name;
const setupParams=new URLSearchParams(location.hash.slice(1));
let invitation=setupParams.get('setup')||'';
const setupRole=setupParams.get('role');
const setupMode=Boolean(invitation)&&['1','2'].includes(setupRole);
const accountEmail=slot=>slot==='2'?'shushu@tongzhuo.invalid':'jiejie@tongzhuo.invalid';
if(invitation)history.replaceState(null,'',location.pathname+location.search);
if(setupMode){$('role').value=setupRole;$('role').disabled=true;$('auth-heading').textContent=roles[setupRole].name+'，设置你的密码';$('password').autocomplete='new-password';$('password').placeholder='设置至少 8 位密码';$('confirm-label').hidden=false;$('confirm-password').required=true;$('login-button').textContent='设置密码并进入';$('auth-help').textContent='这是专属的一次性设置链接。设置后，选择角色并输入密码即可登录。';$('demo-btn').hidden=true;}
let client,user,profiles=[],entries=[],demo=false,month=today().slice(0,7),timer;
function notice(s=''){$('notice').textContent=s}
function streak(id){const dates=new Set(entries.filter(e=>e.user_id===id).map(e=>e.study_date));let d=today(),n=0;if(!dates.has(d))d=previous(d);while(dates.has(d)){n++;d=previous(d)}return n}
function currentEntry(){return entries.find(e=>e.user_id===user.id&&e.study_date===$('entry-date').value)}
function fillForm(){const e=currentEntry();$('subject').value=e?.subject??'';$('minutes').value=e?.minutes??30;$('mood').value=e?.mood??'很专注';$('note').value=e?.note??'';$('edit-tag').textContent=e?'已打卡 · 可更新':'每日一记'}
function render(){
 $('login-view').hidden=true;$('app-view').hidden=false;
 const me=profiles.find(p=>p.id===user.id),role=roleOf(me);
 $('entry-heading').textContent=role.heading;$('subject').placeholder=role.subject;$('note').placeholder=role.note;
 $('account').innerHTML=`<span>${demo?'演示 · ':''}${role.name}</span>${demo?'<button id="switch-role">切换角色</button>':''}<button id="logout">退出</button>`;
 if(demo)$('switch-role').onclick=()=>{user={id:user.id==='demo-a'?'demo-b':'demo-a'};render();fillForm()};
 $('logout').onclick=async()=>{clearInterval(timer);if(client&&!demo)await client.auth.signOut();location.reload()};
 $('people').innerHTML=profiles.map((p,i)=>{const own=entries.filter(e=>e.user_id===p.id);return `<article class="person"><div class="person-top"><div class="person-name"><span class="avatar">${roleOf(p).icon}</span>${nameOf(p)}${p.id===user.id?' · 我':''}</div><span class="tag">${own.some(e=>e.study_date===today())?'✓ 今日已打卡':'等待今日的小进步'}</span></div><div class="role-goal"><span>创作目标</span><strong>${roleOf(p).goal}</strong><p>${p.slot===1?"一页一页，把心里的故事写成一本书。":"一点一点，把脑海里的世界做成游戏。"}</p></div><div class="stats"><div><b>${streak(p.id)}<small> 天</small></b><small>连续坚持</small></div><div><b>${own.length}<small> 天</small></b><small>累计打卡</small></div><div><b>${(own.reduce((n,e)=>n+e.minutes,0)/60).toFixed(1)}<small> h</small></b><small>累计创作</small></div></div></article>`}).join('');
 $('month-label').textContent=month.replace('-',' 年 ')+' 月';
 const [y,m]=month.split('-').map(Number),count=new Date(y,m,0).getDate(),offset=(new Date(y,m-1,1).getDay()+6)%7;
 $('calendar').innerHTML='<div></div>'.repeat(offset)+Array.from({length:count},(_,i)=>{const d=month+'-'+String(i+1).padStart(2,'0');return `<div class="day ${d===today()?'today':''}" aria-label="${d}"><span>${i+1}</span><span class="dots">${profiles.map((p,j)=>entries.some(e=>e.user_id===p.id&&e.study_date===d)?`<i title="${nameOf(p)}已打卡" class="dot ${j?'partner':''}"></i>`:'').join('')}</span></div>`}).join('');
 $('legend').innerHTML=profiles.map((p,i)=>`<span><i class="dot ${i?'partner':''}"></i>${nameOf(p)}</span>`).join('');
 const filtered=entries.filter(e=>$('filter').value==='all'||e.user_id===user.id).sort((a,b)=>b.study_date.localeCompare(a.study_date));
 $('entries').innerHTML=filtered.map(e=>`<article class="entry"><div class="entry-date">${esc(e.study_date)}<br>${nameOf(profiles.find(p=>p.id===e.user_id))}</div><div class="entry-body"><h3>${esc(e.subject)}</h3><div class="entry-meta"><span>${e.minutes} 分钟</span><span>${esc(e.mood)}</span></div>${e.note?`<p>${esc(e.note)}</p>`:''}${e.user_id===user.id?`<div class="entry-actions"><button data-edit="${e.study_date}">编辑</button><button data-delete="${e.id}">删除</button></div>`:''}</div></article>`).join('')||'<p class="empty">还没有创作足迹。写下第一条，从今天开始。</p>';
 document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{$('entry-date').value=b.dataset.edit;fillForm();$('checkin-form').scrollIntoView({behavior:'smooth',block:'center'})});
 document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=async()=>{if(!confirm('确定删除这条创作记录吗？'))return;b.disabled=true;try{if(demo)entries=entries.filter(e=>e.id!==b.dataset.delete);else{const {error}=await client.from('checkins').delete().eq('id',b.dataset.delete).eq('user_id',user.id);if(error)throw error;await load()}render();fillForm();notice(demo?'演示记录已删除；未影响云端数据。':'记录已删除。')}catch(e){notice('删除失败：'+e.message);b.disabled=false}});
}
async function load(){const p=await client.from('members').select('*').order('slot');if(p.error)throw p.error;if(!p.data.some(x=>x.id===user.id))throw new Error('此账户不属于这间双人创作室。');const records=[];for(let offset=0;;offset+=500){const e=await client.from('checkins').select('*').order('study_date',{ascending:false}).order('id').range(offset,offset+499);if(e.error)throw e.error;records.push(...e.data);if(e.data.length<500)break}profiles=p.data;entries=records}
async function enter(session){if(!session)return;user=session.user;await load();render();fillForm();clearInterval(timer);timer=setInterval(async()=>{if(document.hidden)return;try{await load();render()}catch{notice('同步暂时中断。请检查网络；未保存的内容仍在输入框中。')}},15000)}
function shiftMonth(n){const [y,m]=month.split('-').map(Number),d=new Date(y,m-1+n,1);month=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');render()}
function download(){const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),timezone:'Asia/Shanghai',members:profiles,checkins:entries},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='同桌-创作记录-'+today()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function startDemo(){demo=true;user={id:'demo-a'};profiles=[{id:'demo-a',slot:1,nickname:'姐姐'},{id:'demo-b',slot:2,nickname:'鼠鼠'}];entries=[];let d=today();for(let i=0;i<6;i++){for(const p of profiles){if(i===0&&p.slot===1||i===3&&p.slot===2)continue;entries.push({id:p.id+i,user_id:p.id,study_date:d,subject:p.slot===1?'写书 · 第一章的故事终于开始了':'做游戏 · 跑通角色移动与跳跃',minutes:p.slot===1?45:60,mood:'小有收获',note:p.slot===1?'整理了主角的动机，写完开场的第一段对话。明天继续往下写。':'完成了移动和跳跃的基础手感，明天试着搭一个小关卡。'})}d=previous(d)}notice('这是演示：数据只在当前页面内存中，刷新后重置。正式登录后才会保存到云端。');render();fillForm()}
 $('today-label').textContent=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'full'}).format(new Date());$('entry-date').value=today();$('entry-date').max=today();$('entry-date').onchange=fillForm;
 $('prev-month').onclick=()=>shiftMonth(-1);$('next-month').onclick=()=>shiftMonth(1);$('filter').onchange=render;$('export-btn').onclick=download;$('demo-btn').onclick=startDemo;
 $('login-form').onsubmit=async event=>{
 event.preventDefault();if(!client){notice('暂时无法连接云端，请稍后重试。');return}
 const button=$('login-button');button.disabled=true;notice();
 try{
  const password=$('password').value;
  if(setupMode&&password!==$('confirm-password').value)throw new Error('两次密码不一致，请重新确认。');
  if(new TextEncoder().encode(password).length>72)throw new Error('密码过长，请使用不超过 72 个英文字符，或更短的中文密码。');
  const result=setupMode?await client.auth.signUp({email:accountEmail(setupRole),password,options:{data:{invitation}}}):await client.auth.signInWithPassword({email:accountEmail($('role').value),password});
  if(result.error)throw result.error;
  if(!result.data.session)throw new Error('尚未完成设置。链接可能已使用；如果你已设置过密码，请重新打开首页登录。');
  invitation='';await enter(result.data.session);$('password').value='';$('confirm-password').value='';notice(setupMode?'密码已设置。以后选择你的角色、输入密码即可。':'');
 }catch(e){const message=e.message.includes('Invalid login credentials')?'角色或密码不正确。':e.message;notice((setupMode?'设置失败：':'登录失败：')+message)}finally{button.disabled=false}
 };
 $('checkin-form').onsubmit=async event=>{event.preventDefault();const button=$('save-btn');button.disabled=true;const record={user_id:user.id,study_date:$('entry-date').value,subject:$('subject').value.trim(),minutes:Number($('minutes').value),mood:$('mood').value,note:$('note').value.trim()};try{if(!record.subject||record.study_date>today()||record.minutes<1||record.minutes>1440||!Number.isInteger(record.minutes))throw new Error('请检查创作内容、日期和时长。');if(demo){const old=currentEntry();if(old)Object.assign(old,record);else entries.push({...record,id:crypto.randomUUID()})}else{const {error}=await client.from('checkins').upsert(record,{onConflict:'user_id,study_date'});if(error)throw error;await load()}render();fillForm();notice(demo?'演示打卡已更新；刷新后重置，不会写入云端。':'已保存到云端。对方页面会在 15 秒内同步。')}catch(e){notice('保存失败，内容仍保留在表单中：'+e.message)}finally{button.disabled=false}};
const config=window.STUDY_CONFIG;
if(config?.supabaseUrl&&config?.supabaseAnonKey){try{const {createClient}=await import('https://esm.sh/@supabase/supabase-js@2');client=createClient(config.supabaseUrl,config.supabaseAnonKey);const {data,error}=await client.auth.getSession();if(error)throw error;if(!setupMode)await enter(data.session)}catch(e){notice('无法连接云端：'+e.message)}}else notice('预览版：云端数据库尚未配置。你可以先体验演示，演示数据不会保存。');
