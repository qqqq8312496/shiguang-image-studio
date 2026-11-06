const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const b=await chromium.launch({channel:'msedge',headless:true});
 const p=await b.newPage({viewport:{width:390,height:844}});const errors=[];
 p.on('pageerror',e=>errors.push(e.message));
 await p.goto(process.env.TEST_URL||'http://127.0.0.1:8765/');
 await p.waitForFunction(()=>!document.querySelector('#composerFields').disabled);
 const fixture=await p.screenshot({clip:{x:0,y:0,width:64,height:64}});
 let mode='task',ready=false,transientFailures=0,polls=0;const posts=[];
 await p.route('https://www.kuaiaiapi.com/**',async route=>{
  const r=route.request();
  const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
  if(r.method()==='OPTIONS')return route.fulfill({status:204,headers});
  if(r.method()==='POST'){
   posts.push(new URL(r.url()).pathname);
   if(mode==='lost')return route.abort();
   if(mode==='denied')return route.fulfill({status:401,headers,contentType:'application/json',body:JSON.stringify({error:{message:'invalid test credential'}})});
   if(mode==='failed')return route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify({data:{task_id:'server-failed-task'}})});
   return route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify({data:{id:123,task_id:'test-async-task',status:'QUEUED'}})});
  }
  polls++;
  if(transientFailures>0){transientFailures--;return route.abort();}
  const failed=r.url().includes('server-failed-task');
  return route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify({data:{task_id:'test-async-task',status:failed?'FAILED':ready?'SUCCESS':'IN_PROGRESS',fail_reason:failed?'test provider task failure':'',...(ready&&!failed?{data:[{b64_json:fixture.toString('base64')}]}:{})}})});
 });
 // Old saved settings with no new fields must migrate to auto task mode.
 await p.evaluate(()=>localStorage.setItem('shiguang.config',JSON.stringify({baseUrl:'https://www.kuaiaiapi.com',model:'gpt-image-2.5',pollSeconds:1})));
 await p.reload();await p.waitForFunction(()=>!document.querySelector('#composerFields').disabled);
 await p.locator('#settingsOpen').click();await p.locator('#apiKey').fill('test-async-only');await p.locator('#rememberKey').check();await p.locator('#settingsForm button[type=submit]').click();
 await p.locator('#prompt').fill('async test');await p.locator('#count').fill('2');await p.locator('#generate').click();
 // Poll asynchronous database reads explicitly; waitForFunction treats a Promise as truthy in some versions.
 let checkpointSaved=false;
 const checkpointDeadline=Date.now()+10000;
 while(Date.now()<checkpointDeadline){
  checkpointSaved=await p.evaluate(async()=>{const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('shiguang-studio');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});try{const rows=await new Promise((resolve,reject)=>{const q=db.transaction('batches').objectStore('batches').getAll();q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});return rows.some(b=>b.items[0].recovery?.taskId==='test-async-task');}finally{db.close();}});
  if(checkpointSaved)break;
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 assert.ok(checkpointSaved,'Task ID must be committed before reloading');
 assert.deepEqual(posts,['/v1/images/generations/async']);
 p.once('dialog',d=>d.accept());await p.reload();transientFailures=2;ready=true;
 await p.waitForFunction(()=>document.querySelector('.image-card img')?.naturalWidth===64);
 await p.waitForFunction(()=>!document.querySelector('#generate').disabled);
 assert.equal(posts.length,1);assert.ok(polls>=3);assert.ok((await p.locator('.image-card').nth(1).innerText()).includes('已停止'));
 // Unknown submission must not switch to synchronous POST or auto retry.
 mode='lost';await p.locator('#count').fill('1');await p.locator('#generate').click();await p.getByRole('button',{name:'重新生成（可能扣费）'}).waitFor();
 assert.equal(posts.length,2);assert.ok((await p.locator('.pending-content').innerText()).includes('结果待确认'));assert.equal(await p.getByRole('button',{name:'恢复后台结果'}).count(),1);
 await p.reload();await p.getByRole('button',{name:'恢复后台结果'}).last().waitFor();assert.equal(posts.length,2);
 // Recover a previous unknown record using a provider task ID, without a POST.
 await p.getByRole('button',{name:'恢复后台结果'}).last().click();await p.locator('#recoveryInput').fill('test-async-task');await p.locator('#recoverForm button[type=submit]').click();
 await p.waitForFunction(()=>document.querySelectorAll('.image-card img').length===2);await p.waitForFunction(()=>!document.querySelector('#generate').disabled);assert.equal(posts.length,2);
 // Explicit server failures remain distinguishable from transport uncertainty.
 mode='failed';await p.locator('#generate').click();await p.waitForFunction(()=>document.querySelector('.pending-content')?.textContent.includes('test provider task failure'));assert.ok((await p.locator('.pending-content').innerText()).includes('生成失败'));assert.equal(posts.length,3);
 mode='denied';await p.locator('#generate').click();await p.waitForFunction(()=>document.querySelector('.pending-content')?.textContent.includes('invalid test credential'));assert.ok((await p.locator('.pending-content').innerText()).includes('生成失败'));assert.equal(posts.length,4);
 const paths=await p.evaluate(async()=>{const {submissionPath,defaults}=await import('./api.js?v=20261106-edit-prompts');return [submissionPath(defaults,false),submissionPath(defaults,true),submissionPath({...defaults,baseUrl:'https://other.invalid'},false),submissionPath({...defaults,requestMode:'direct'},false)];});
 assert.deepEqual(paths,['/v1/images/generations/async','/v1/images/edits/async','/v1/images/generations','/v1/images/generations']);
 assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
 await p.screenshot({path:'test-results/async-mobile.png',fullPage:true});
 console.log('PASS: old-settings migration, task ID persisted immediately, refresh GET-only auto resume, transient GET retries, queued images never auto-submit, lost POST never falls back/repeats, manual provider-result recovery, server vs transport failure states, async edit routing, custom-provider paths unchanged.');
 await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
