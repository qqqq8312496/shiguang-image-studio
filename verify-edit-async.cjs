const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.TEST_URL||'http://127.0.0.1:8765/');
  const ready=()=>page.waitForFunction(()=>!document.querySelector('#composerFields').disabled);
  await ready();
  const background=await page.screenshot({clip:{x:0,y:0,width:64,height:64}});
  const subject=await page.screenshot({clip:{x:20,y:20,width:48,height:48}});
  const posts=[];let finished=false,polls=0,mode='task';
  await page.route('https://www.kuaiaiapi.com/**',async route=>{
   const req=route.request();
   const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
   if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
   if(req.method()==='POST'){
    const form=await new Response(req.postDataBuffer(),{headers:{'Content-Type':req.headers()['content-type']}}).formData();
    const images=await Promise.all(form.getAll('image[]').map(async f=>({name:f.name,bytes:Buffer.from(await f.arrayBuffer())})));
    posts.push({path:new URL(req.url()).pathname,images,prompt:form.get('prompt'),model:form.get('model'),size:form.get('size'),quality:form.get('quality'),n:form.get('n')});
    if(mode==='lost')return route.abort();
    return route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify({data:{task_id:'multi-image-task',status:'QUEUED'}})});
   }
   polls++;
   return route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify({data:{task_id:'multi-image-task',status:finished?'SUCCESS':'IN_PROGRESS',...(finished?{data:[{b64_json:background.toString('base64')}]}:{})}})});
  });
  // Settings saved before the async edit field existed must migrate automatically.
  await page.evaluate(()=>localStorage.setItem('shiguang.config',JSON.stringify({baseUrl:'https://www.kuaiaiapi.com',model:'gpt-image-2.5',pollSeconds:1})));
  await page.reload();await ready();
  await page.locator('#settingsOpen').click();await page.locator('#apiKey').fill('test-edit-only');await page.locator('#rememberKey').check();await page.locator('#settingsForm button[type=submit]').click();
  await page.locator('#prompt').fill('保留我家狗狗的头部细节，在原来的房间写贺卡。');
  await page.locator('#fileInput').setInputFiles([{name:'room.png',mimeType:'image/png',buffer:background},{name:'dog.png',mimeType:'image/png',buffer:subject}]);
  await page.waitForFunction(()=>document.querySelectorAll('.reference').length===2);
  await page.locator('.reference select').nth(0).selectOption('background');await page.locator('.reference select').nth(1).selectOption('subject');
  await page.locator('#generate').click();
  let saved=false;const deadline=Date.now()+10000;
  while(Date.now()<deadline){
   saved=await page.evaluate(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('shiguang-studio');q.onsuccess=()=>r(q.result);});try{const batches=await new Promise(r=>{const q=db.transaction('batches').objectStore('batches').getAll();q.onsuccess=()=>r(q.result);});return batches.some(b=>b.items[0].recovery?.taskId==='multi-image-task'&&b.refs.length===2);}finally{db.close();}});
   if(saved)break;await new Promise(r=>setTimeout(r,50));
  }
  assert.ok(saved,'Multi-image task ID and references must be saved before reload');
  assert.equal(posts.length,1);const post=posts[0];assert.equal(post.path,'/v1/images/edits/async');
  assert.deepEqual(post.images.map(i=>i.name),['room.png','dog.png']);assert.deepEqual(post.images[0].bytes,background);assert.deepEqual(post.images[1].bytes,subject);
  assert.ok(post.prompt.includes('唯一背景参考'));assert.ok(post.prompt.includes('主体外观'));assert.equal(post.model,'gpt-image-2.5');assert.equal(post.quality,'high');assert.equal(post.n,'1');
  finished=true;page.once('dialog',d=>d.accept());await page.reload();await ready();
  await page.waitForFunction(()=>document.querySelector('.image-card img')?.naturalWidth===64);await page.waitForFunction(()=>!document.querySelector('#generate').disabled);
  assert.equal(posts.length,1);assert.ok(polls>=1);assert.equal(await page.locator('.reference').count(),2);
  assert.equal(await page.locator('.reference select').nth(0).inputValue(),'background');assert.equal(await page.locator('.reference select').nth(1).inputValue(),'subject');
  mode='lost';await page.locator('#generate').click();await page.getByRole('button',{name:'重新生成（可能扣费）'}).waitFor();
  assert.equal(posts.length,2);assert.ok(posts.every(p=>p.path==='/v1/images/edits/async'));
  await page.reload();await ready();assert.equal(posts.length,2);
  const paths=await page.evaluate(async()=>{const {defaults,submissionPath}=await import('./api.js?v=20261106-edit-prompts');return [submissionPath({...defaults,requestMode:'direct'},true),submissionPath({...defaults,editPath:'/custom/edit'},true),submissionPath({...defaults,baseUrl:'https://other.invalid'},true),submissionPath({...defaults,requestMode:'async',asyncEditPath:'/custom/edit/jobs'},true)];});
  assert.deepEqual(paths,['/v1/images/edits','/custom/edit','/v1/images/edits','/custom/edit/jobs']);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
  console.log('PASS: async multi-image upload preserves original bytes/order/roles, old settings migrate, task ID persists before reload, refresh queries without another POST, uncertain edit submission never falls back/repeats, direct/custom provider settings retained.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
