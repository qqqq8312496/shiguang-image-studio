const { chromium }=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});const page=await browser.newPage({viewport:{width:1440,height:1080}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8765');await page.screenshot({path:'test-results/desktop.png',fullPage:true});
 const cors=await page.evaluate(async()=>{try{const r=await fetch('https://www.kuaiaiapi.com/v1/images/generations',{method:'POST',headers:{'Authorization':'Bearer cors-check-invalid-key','Content-Type':'application/json'},body:JSON.stringify({model:'gpt-image-2.5',prompt:'connection-check'}),signal:AbortSignal.timeout(15000)});return {readable:true,status:r.status};}catch(e){return {readable:false,error:e.message};}});
 console.log('LIVE_CORS',JSON.stringify(cors));
 const fixture=await page.screenshot({clip:{x:30,y:20,width:80,height:80}});let submissions=[];let attempt=0;
 await page.route('https://mock.invalid/**',async route=>{const req=route.request();const url=req.url();if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'}});
 const headers={'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};
 if(url.includes('/tasks/'))return route.fulfill({status:200,headers,body:JSON.stringify({status:'SUCCESS',data:[{b64_json:fixture.toString('base64')}]})});
 if(url.endsWith('/edits')){submissions.push({kind:'edit',body:req.postDataBuffer().toString(),headers:req.headers()});return route.fulfill({status:200,headers,body:JSON.stringify({task_id:'task-123'})});}
 if(url.endsWith('/generations')){submissions.push({kind:'text',body:req.postDataJSON()});attempt++;if(attempt===2)return route.fulfill({status:503,headers,body:JSON.stringify({error:{message:'test transient failure'}})});return route.fulfill({status:200,headers,body:JSON.stringify({data:[{b64_json:fixture.toString('base64')}]})});}
 return route.abort();});
 await page.locator('#settingsOpen').click();await page.locator('#baseUrl').fill('https://mock.invalid');await page.locator('#apiKey').fill('test-only-secret');await page.locator('summary').click();await page.locator('#pollSeconds').fill('1');await page.locator('#settingsForm button[type=submit]').click();
 await page.locator('#prompt').fill('test scene');await page.locator('#count').fill('2');await page.locator('#generate').click();await page.waitForFunction(()=>!document.querySelector('#generate').disabled);
 assert.equal(await page.locator('.image-card img').count(),1);assert.equal(await page.getByRole('button',{name:'重试此张'}).count(),1);
 await page.getByRole('button',{name:'重试此张'}).click();await page.waitForFunction(()=>!document.querySelector('#generate').disabled);assert.equal(await page.locator('.image-card img').count(),2);
 assert.equal(submissions[0].body.model,'gpt-image-2.5');assert.equal(submissions[0].body.prompt,'test scene');assert.equal(submissions[0].body.n,1);
 await page.locator('#fileInput').setInputFiles([{name:'room.png',mimeType:'image/png',buffer:fixture},{name:'dog.png',mimeType:'image/png',buffer:fixture}]);await page.waitForFunction(()=>document.querySelector('#mode').textContent.includes('2 张'));
 await page.locator('.reference select').nth(0).selectOption('background');await page.locator('.reference select').nth(1).selectOption('subject');await page.locator('#count').fill('1');await page.locator('#generate').click();await page.waitForFunction(()=>!document.querySelector('#generate').disabled);assert.equal(await page.locator('.image-card img').count(),1);
 const edit=submissions.find(s=>s.kind==='edit');assert.equal((edit.body.match(/name="image\[\]"/g)||[]).length,2);assert.ok(edit.body.includes('唯一背景参考'));assert.ok(edit.body.includes('主体外观'));assert.equal(edit.headers.authorization,'Bearer test-only-secret');
 await page.locator('.image-card img').first().click();await page.locator('#preview').waitFor({state:'visible'});const dl=page.waitForEvent('download');await page.locator('#previewDownload').click();assert.ok((await dl).suggestedFilename().endsWith('.png'));await page.locator('[data-close=preview]').click();
 const stored=await page.evaluate(async()=>{const db=await new Promise(r=>{const req=indexedDB.open('shiguang-studio');req.onsuccess=()=>r(req.result);});const result=await new Promise(r=>{const req=db.transaction('batches').objectStore('batches').getAll();req.onsuccess=()=>r(req.result);});return JSON.stringify(result)+JSON.stringify({...localStorage});});assert.ok(!stored.includes('test-only-secret'));
 await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.image-card img').length===3);await page.locator('#settingsOpen').click();assert.equal(await page.locator('#apiKey').inputValue(),'');await page.locator('[data-close=settings]').click();
 await page.locator('#batchSelect').selectOption({index:1});await page.locator('#reuse').click();assert.equal(await page.locator('.reference').count(),2);await page.locator('.reference button').first().click();await page.locator('.reference button').first().click();assert.equal(await page.locator('#mode').innerText(),'文生图');
 await page.screenshot({path:'test-results/gallery.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/mobile.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
 let cdnAuthorization='not-called';
 await page.route('https://assets.invalid/**',r=>{cdnAuthorization=r.request().headers().authorization;return r.fulfill({status:200,headers:{'Access-Control-Allow-Origin':'*','Content-Type':'application/octet-stream'},body:fixture});});
 await page.route('https://mock.invalid/remote/generations',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:[{url:'https://assets.invalid/test.png'}]})}));
 const remote=await page.evaluate(async()=>{const {generateImage,defaults}=await import('./api.js');const result=await generateImage({config:{...defaults,baseUrl:'https://mock.invalid',generationPath:'/remote/generations'},key:'test-only-secret',prompt:'test',refs:[],size:'1024x1024',quality:'high',signal:new AbortController().signal,onStatus:()=>{}});return {type:result.blob.type,width:result.width};});
 assert.equal(cdnAuthorization,undefined);assert.equal(remote.type,'image/png');assert.equal(remote.width,80);
 assert.deepEqual(errors,[]);console.log('PASS: generation, batch partial failure, retry, image[] multipart, role prompts, async task, download, history, no persisted key, mode switching, mobile overflow, CDN download without forwarding credentials, image type normalization.');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
