export const defaults = {baseUrl:'https://www.kuaiaiapi.com',model:'gpt-image-2.5',generationPath:'/v1/images/generations',editPath:'/v1/images/edits',taskPath:'/v1/images/tasks/{id}',imageField:'image[]',timeout:240,pollSeconds:4,extra:{}};
export function endpoint(config,path) {
  const base = new URL(config.baseUrl);
  if (base.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(base.hostname)) throw new Error('API 地址需要使用 HTTPS。');
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) throw new Error('接口路径应为 /v1/... 形式的相对路径。');
  const url = new URL(base.href.replace(/\/$/,'') + path);
  if (url.origin !== base.origin) throw new Error('接口路径不能指向其他站点。');
  return url.href;
}
export function findValue(obj,keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const key of keys) if (typeof obj[key] === 'string' && obj[key]) return obj[key];
  for (const [key,value] of Object.entries(obj)) {
    if (['request','input','metadata'].includes(key)) continue;
    const result = findValue(value,keys); if (result) return result;
  }
  return null;
}
export function imageRef(payload) {
  return findValue(payload,['b64_json','image_base64','b64']) || findValue(payload,['result_url','image_url','output_url','url']);
}
function wait(ms,signal) {return new Promise((resolve,reject)=>{
  signal.throwIfAborted();
  const cancel=()=>{clearTimeout(timer);reject(new DOMException('已停止','AbortError'));};
  const timer=setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve();},ms);
  signal.addEventListener('abort',cancel,{once:true});
});}
export async function timedFetch(url,options,seconds,signal) {
  const ctrl = new AbortController();
  const stop = () => ctrl.abort(signal?.reason);
  if (signal?.aborted) stop(); else signal?.addEventListener('abort',stop,{once:true});
  const timer=setTimeout(()=>ctrl.abort(new DOMException('请求超时','TimeoutError')),seconds*1000);
  try {
    const response=await fetch(url,{...options,credentials:'omit',referrerPolicy:'no-referrer',signal:ctrl.signal});
    // Read the body before clearing the timeout, including long streamed responses.
    const buffer=await response.arrayBuffer();
    return new Response(buffer,{status:response.status,statusText:response.statusText,headers:response.headers});
  } catch(e) {
    if (signal?.aborted) throw new DOMException('已停止','AbortError');
    if (ctrl.signal.aborted) throw new Error('请求超时。服务端可能仍在生成；请先在服务商后台确认，再重试。');
    throw new Error('无法读取接口响应：请检查网络、API 地址及服务商的跨域设置。');
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',stop);}
}
async function readPayload(response) {
  const raw=await response.text(); let data;
  try {data=JSON.parse(raw);} catch {throw new Error(`HTTP ${response.status}：接口未返回 JSON。`);}
  if (!response.ok || data.error) {
    const msg=typeof data.error==='string'?data.error:(data.error?.message || data.message || response.statusText);
    throw new Error(`HTTP ${response.status}：${String(msg).slice(0,400)}`);
  }
  return data;
}
export async function generateImage({config,key,prompt,refs,size,quality,signal,onStatus}) {
  const headers={Authorization:`Bearer ${key}`};
  const reserved=['model','prompt','size','quality','n','image','images','image[]'];
  const extras=Object.fromEntries(Object.entries(config.extra||{}).filter(([k])=>!reserved.includes(k)));
  const values={...extras,model:config.model,prompt,size,quality,n:1};
  let body;
  if(refs.length){body=new FormData();for(const [k,v] of Object.entries(values))body.append(k,typeof v==='object'?JSON.stringify(v):String(v));for(const ref of refs)body.append(config.imageField,ref.blob,ref.name);}
  else{headers['Content-Type']='application/json';body=JSON.stringify(values);}
  onStatus('正在生成');
  let payload=await readPayload(await timedFetch(endpoint(config,refs.length?config.editPath:config.generationPath),{method:'POST',headers,body},config.timeout,signal));
  let ref=imageRef(payload);
  if(!ref){
    const taskId=findValue(payload,['task_id','id']);
    if(!taskId)throw new Error('返回中没有图片或任务 ID。');
    const deadline=Date.now()+15*60*1000;
    while(Date.now()<deadline){
      onStatus('服务端生成中');await wait(config.pollSeconds*1000,signal);
      payload=await readPayload(await timedFetch(endpoint(config,config.taskPath.replace('{id}',encodeURIComponent(taskId))),{headers:{Authorization:`Bearer ${key}`}},config.timeout,signal));
      const status=(findValue(payload,['status','state'])||'').toUpperCase();
      if(['FAILURE','FAILED','ERROR','CANCELED','CANCELLED'].includes(status))throw new Error(findValue(payload,['message','error'])||'服务端任务失败。');
      ref=imageRef(payload);if(ref)break;
      if(['SUCCESS','SUCCEEDED','COMPLETED','COMPLETE','DONE'].includes(status))throw new Error('任务已结束，但没有返回图片。');
    }
    if(!ref)throw new Error('等待任务超过 15 分钟。请在服务商后台确认结果，避免重复提交。');
  }
  onStatus('正在保存');
  let blob;
  if(ref.startsWith('data:') || (!ref.startsWith('http') && !ref.startsWith('/') && /^[A-Za-z0-9+/=\r\n]+$/.test(ref) && ref.length>256)){
    const raw=ref.startsWith('data:')?ref.slice(ref.indexOf(',')+1):ref;
    const binary=atob(raw.replace(/\s/g,''));const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
    const type=bytes[0]===255?'image/jpeg':bytes[0]===82?'image/webp':'image/png';blob=new Blob([bytes],{type});
  }else{
    const url=new URL(ref,config.baseUrl);
    if(!['https:','http:'].includes(url.protocol))throw new Error('图片地址格式不支持。');
    // Never forward a key to a third-party image host.
    const imageHeaders=url.origin===new URL(config.baseUrl).origin?{Authorization:`Bearer ${key}`}:{ };
    const response=await timedFetch(url.href,{headers:imageHeaders},180,signal);
    if(!response.ok)throw new Error(`图片下载失败 HTTP ${response.status}`);
    blob=await response.blob();
  }
  const signature=new Uint8Array(await blob.slice(0,12).arrayBuffer());
  const mime=signature[0]===137&&signature[1]===80?'image/png':signature[0]===255&&signature[1]===216?'image/jpeg':signature[0]===82&&signature[8]===87?'image/webp':null;
  if(!mime)throw new Error('接口未返回支持的 PNG、JPG 或 WebP 图片。');
  if(blob.type!==mime)blob=new Blob([blob],{type:mime});
  const decoded=await createImageBitmap(blob).catch(()=>{throw new Error('接口返回的内容不是有效图片。');});
  const dimensions={width:decoded.width,height:decoded.height};decoded.close();
  return {blob,...dimensions};
}
