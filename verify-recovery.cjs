const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await page.goto(process.env.TEST_URL||'http://127.0.0.1:8765/');
 await page.waitForFunction(()=>!document.querySelector('#composerFields').disabled);
 const fixture=await page.screenshot({clip:{x:0,y:0,width:100,height:100}});
 let posts=0,downloads=0,mode='image',failDownload=true,polls=0,failPoll=true;
 const auth=[];
 await page.route('https://mock.invalid/**',async route=>{
  const req=route.request();
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'}});
  const headers={'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};
  if(req.method()==='POST'){
   posts++;
   if(mode==='lost')return route.abort();
   return route.fulfill({status:200,headers,body:JSON.stringify(mode==='task'?{task_id:'resume-task'}:{data:[{url:'https://mock.invalid/image.png?sig=example'}]})});
  }
  if(req.url().includes('/tasks/')){
   polls++;if(failPoll)return route.abort();
   return route.fulfill({status:200,headers,body:JSON.stringify({status:'SUCCESS',data:[{url:'https://mock.invalid/image.png?sig=example'}]})});
  }
  downloads++;auth.push(req.headers().authorization);
  if(failDownload)return route.abort();
  return route.fulfill({status:200,headers:{'Access-Control-Allow-Origin':'*','Content-Type':'image/png'},body:fixture});
 });
 await page.locator('#settingsOpen').click();await page.locator('#baseUrl').fill('https://mock.invalid');await page.locator('#apiKey').fill('test-recovery-only');await page.locator('#rememberKey').check();await page.locator('#settings summary').click();await page.locator('#pollSeconds').fill('1');await page.locator('#settingsForm button[type=submit]').click();
 await page.locator('#prompt').fill('recover result');await page.locator('#generate').click();
 await page.getByRole('button',{name:'重新获取图片'}).waitFor();assert.equal(posts,1);assert.equal(await page.getByRole('link',{name:'打开原图链接'}).count(),1);
 await page.reload();await page.getByRole('button',{name:'重新获取图片'}).waitFor();failDownload=false;
 await page.getByRole('button',{name:'重新获取图片'}).click();await page.waitForFunction(()=>document.querySelector('.image-card img')?.naturalWidth>0);assert.equal(posts,1);assert.ok(auth.every(v=>v===undefined));
 await page.locator('.image-card img').tap();await page.waitForFunction(()=>document.querySelector('#previewImage').naturalWidth===100);await page.locator('[data-close=preview]').click();
 mode='task';await page.locator('#generate').click();await page.getByRole('button',{name:'重新获取图片'}).waitFor();assert.equal(posts,2);assert.equal(polls,4);
 await page.reload();failPoll=false;await page.getByRole('button',{name:'重新获取图片'}).click();await page.waitForFunction(()=>document.querySelectorAll('.image-card img').length===2);assert.equal(posts,2);assert.equal(polls,5);
 mode='lost';await page.locator('#generate').click();await page.getByRole('button',{name:'重新生成（可能扣费）'}).waitFor();assert.equal(posts,3);assert.ok((await page.locator('.pending-content').innerText()).includes('提交/接收生成结果阶段'));
 page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'重新生成（可能扣费）'}).click();assert.equal(posts,3);
 console.log('PASS: download failure checkpoint survives reload; image/task recovery performs GET only; signed image download omits auth; recovered image previews on mobile; uncertain submission never auto-retries.');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
