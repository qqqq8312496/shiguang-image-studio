const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];let posts=0;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/v1/images/**',route=>{if(route.request().method()==='POST')posts++;return route.abort();});
  await page.goto(process.env.TEST_URL||'http://127.0.0.1:8765/');
  await page.waitForFunction(()=>!document.querySelector('#composerFields').disabled);
  const fixture=await page.screenshot({clip:{x:10,y:10,width:60,height:60}});
  const oldPrompt='我家的柯基认真写贺卡，保留宽宽的白色脖子。\n贺卡写着 To my one and only。\n显示原文：<img src=x onerror="window.promptInjected=true">';
  await page.evaluate(async({bytes,oldPrompt})=>{
   const blob=new Blob([new Uint8Array(bytes)],{type:'image/png'});
   const db=await new Promise(r=>{const q=indexedDB.open('shiguang-studio');q.onsuccess=()=>r(q.result);});
   await new Promise((resolve,reject)=>{const tx=db.transaction('batches','readwrite');const s=tx.objectStore('batches');
    const base={created:Date.now()-100000,prompt:oldPrompt,refs:[{name:'room.png',blob,role:'background'},{name:'dog.png',blob,role:'subject'}],config:{model:'gpt-image-2.5'},size:'1360x2048',quality:'high',concurrency:1,items:[{id:'old-photo',number:1,status:'done',blob,width:60,height:60,name:'old.png'}]};
    s.put({...base,id:'old-history'});s.put({...base,id:'new-history',created:Date.now(),prompt:'第二组提示词',effectivePrompt:'第二组提示词\n\n参考图片分工：第一张保留背景。',items:[{...base.items[0],id:'new-photo'}]});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
  },{bytes:Array.from(fixture),oldPrompt});
  await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.image-card img').length===2);
  await page.locator('#batchSelect').selectOption('old-history');await page.locator('#prompt').fill('当前草稿，不应覆盖历史。');
  await page.locator('.card-bottom').getByRole('button',{name:'提示词',exact:true}).click();
  assert.equal(await page.locator('#historyPrompt').inputValue(),oldPrompt);assert.equal(await page.locator('#historyPromptDetails').isVisible(),false);assert.equal(await page.locator('#historyPrompt').getAttribute('readonly'),'');
  await page.evaluate(()=>{navigator.clipboard.writeText=async value=>{window.copiedPrompt=value;};});
  await page.locator('#copyHistoryPrompt').click();assert.equal(await page.evaluate(()=>window.copiedPrompt),oldPrompt);assert.equal(await page.evaluate(()=>Boolean(window.promptInjected)),false);
  await page.keyboard.press('Control+Enter');assert.equal(await page.locator('#settings').isVisible(),false);assert.equal(posts,0);
  await page.locator('[data-close=promptHistory]').click();assert.equal(await page.locator('#prompt').inputValue(),'当前草稿，不应覆盖历史。');
  await page.locator('.image-card img').click();await page.locator('#previewPrompt').click();assert.equal(await page.locator('#historyPrompt').inputValue(),oldPrompt);
  await page.locator('#reuseHistoryPrompt').click();assert.equal(await page.locator('#preview').isVisible(),false);assert.equal(await page.locator('#promptHistory').isVisible(),false);assert.equal(await page.locator('#prompt').inputValue(),oldPrompt);
  assert.equal(await page.locator('.reference').count(),2);assert.equal(await page.locator('#size').inputValue(),'1360x2048');
  await page.locator('#settingsOpen').click();await page.locator('#settings summary').click();assert.equal(await page.locator('#asyncEditPath').inputValue(),'/v1/images/edits/async');await page.locator('[data-close=settings]').click();
  await page.locator('#batchSelect').selectOption('new-history');await page.locator('.card-bottom').getByRole('button',{name:'提示词',exact:true}).click();await page.locator('#historyPromptDetails summary').click();assert.ok((await page.locator('#historyEffectivePrompt').innerText()).includes('第一张保留背景'));
  await page.screenshot({path:'test-results/prompts-mobile.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'test-results/prompts-desktop.png',fullPage:true});
  assert.equal(posts,0);assert.deepEqual(errors,[]);
  console.log('PASS: old/new history prompts readable, exact text and line breaks preserved, copy and preview entry work, role notes shown, viewing leaves draft intact, reuse restores references and parameters with migrated settings, no automatic generation or unsafe HTML, mobile/desktop layout.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
