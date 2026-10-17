export function dayInShanghai(now=Date.now()) {
  const d=new Date(now+8*3600000);
  return d.toISOString().slice(0,10);
}

// Count Unicode code points; keep a high surrogate across streaming chunks.
export function createCounter() {
  let total=0,high=false;
  return {push(text){for(let i=0;i<text.length;i++){const code=text.charCodeAt(i);if(code>=0xDC00&&code<=0xDFFF&&high){high=false;continue}high=code>=0xD800&&code<=0xDBFF;if(!/[\s\u0085]/.test(text[i]))total++}},get total(){return total}};
}

async function decodeCount(file,encoding) {
  const decoder=new TextDecoder(encoding,{fatal:true}),counter=createCounter();
  // Read file-backed Blobs in bounded slices; no dependency on Blob.stream().
  for(let offset=0;offset<file.size;offset+=65536){const bytes=await file.slice(offset,offset+65536).arrayBuffer();counter.push(decoder.decode(bytes,{stream:true}))}
  counter.push(decoder.decode());return counter.total;
}

export async function readCount(handle) {
  const file=await handle.getFile();
  if(file.size>100*1024*1024)throw new Error('TXT 超过 100 MB，请分卷统计。');
  const first=new Uint8Array(await file.slice(0,3).arrayBuffer());
  let total;
  if(first[0]===0xFF&&first[1]===0xFE)total=await decodeCount(file,'utf-16le');
  else if(first[0]===0xFE&&first[1]===0xFF)total=await decodeCount(file,'utf-16be');
  else{try{total=await decodeCount(file,'utf-8')}catch(e){if(!(e instanceof TypeError))throw e;try{total=await decodeCount(file,'gb18030')}catch(fallback){if(!(fallback instanceof TypeError))throw fallback;throw new Error('无法识别 TXT 编码，请在编辑器里另存为 UTF-8 纯文本，再重新选择。')}}}
  const after=await handle.getFile();
  if(after.size!==file.size||after.lastModified!==file.lastModified)throw new Error('TXT 正在保存，下次再统计。');
  return total;
}

export function updateBaseline(previous,current,now=Date.now()) {
  const day=dayInShanghai(now),old=previous||{},elapsed=now-(old.lastSeen||0);
  const baseline=old.day===day?old.baseline:(old.day&&elapsed>=0&&elapsed<=45000?old.lastCount:current);
  return {record:{day,baseline,lastCount:current,lastSeen:now},delta:current-baseline};
}

export function syncError(stage,error){
  if(stage==='read')return error.name==='NotAllowedError'?'文件读取授权失效，请暂停并重新选择 TXT。':'读取 TXT 失败（'+error.name+'）：'+error.message+' 请确认文件在本机、已下载且是纯文本；可另存为 UTF-8 后重新选择。';
  if(stage==='save')return '保存本机字数基线失败（'+error.name+'）：'+error.message+' 请检查浏览器存储权限。尚未上传。';
  if(stage==='prepare')return '准备同步失败：'+error.message+' 尚未发送请求。';
  return '字数已在本机统计，但网络同步失败（'+error.name+'）：'+error.message+'。10 秒后重试；可尝试手机热点。';
}
