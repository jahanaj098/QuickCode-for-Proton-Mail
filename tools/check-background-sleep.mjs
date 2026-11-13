// Real MV3 slow-poll test without a debugger attached while the alarm runs.
// Only an isolated copy of the build receives a synthetic fetch implementation.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const root = await fs.mkdtemp(path.resolve('artifacts/sleep-test-'));
const extension = path.join(root, 'extension'); await fs.cp(process.argv[2] || 'dist/chrome', extension, { recursive: true });
const old = { ID: 'old', ConversationID: 'old', Subject: 'Older mail', Sender: { Address: 'sender@example.test' }, Time: 1, Unread: 1, LabelIDs: ['0'] };
const fresh = { ...old, ID: 'new', ConversationID: 'new', Subject: 'Sign-in verification', Time: 2 };
const fast = process.env.QUICKCODE_BACKGROUND_FAST === '1';
let fixture = `{
const old=${JSON.stringify(old)}, fresh=${JSON.stringify(fresh)};
const api=globalThis.browser||chrome;const original=api.notifications.create.bind(api.notifications);api.notifications.create=async(...args)=>{try{const result=await original(...args);await api.storage.session.set({testNotificationCreated:true});return result;}catch(e){await api.storage.session.set({testNotificationError:e.message});throw e;}};

const nativeFetch=globalThis.fetch.bind(globalThis);
globalThis.fetch=async(input,init)=>{
 const url=typeof input==='string'?input:input.url||String(input); if(new URL(url,location.href).protocol==='chrome-extension:'||url.startsWith('data:'))return nativeFetch(input,init); let data,delay;
 if(url.endsWith('messages/count')){data={Code:1000,Counts:[{LabelID:'0',Unread:2}]};delay=10000;}
 else if(url.includes('messages?')){data={Code:1000,Messages:[fresh,old]};delay=10000;}
 else if(url.endsWith('/messages/new')){data={Code:1000,Message:{...fresh,Body:'Your verification code is 583920.',MIMEType:'text/plain'}};delay=15000;}
 else throw Error('Unexpected request in isolated fixture');
 await new Promise(resolve=>setTimeout(resolve,delay));return Response.json(data);
};
}
`;
if(fast)fixture=fixture.replaceAll('delay=10000','delay=0').replaceAll('delay=15000','delay=0');
const originalBundle=await fs.readFile(path.join(extension,'background.js'),'utf8');
const bundleStart=originalBundle.indexOf('(() => {');assert.ok(bundleStart>=0);
await fs.writeFile(path.join(extension,'background.js'),fixture+originalBundle.slice(bundleStart));
const edge = path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe');
const browserProcess = spawn(edge, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + path.join(root, 'profile'), '--no-first-run', '--disable-component-extensions-with-background-pages', '--no-default-browser-check', '--disable-extensions-except=' + extension, '--load-extension=' + extension, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let ws, sequence = 0; const pending = new Map();
function command(method, params = {}, sessionId) {
  const id = ++sequence;
  return new Promise((resolve, reject) => { const timeout=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},10000);pending.set(id, { resolve:value=>{clearTimeout(timeout);resolve(value)}, reject:error=>{clearTimeout(timeout);reject(error)} }); ws.send(JSON.stringify({ id, method, params, sessionId })); });
}
async function evaluate(session, expression) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
try {
  let port;
  for (let i = 0; i < 100; i++) { try { port = (await fs.readFile(path.join(root, 'profile/DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await new Promise(r => setTimeout(r, 100)); } }
  assert.ok(port, 'Isolated browser did not start');
  const version = await (await fetch('http://127.0.0.1:' + port + '/json/version')).json();
  ws = new WebSocket(version.webSocketDebuggerUrl); await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  ws.addEventListener('message', event => { const message = JSON.parse(event.data); const request = pending.get(message.id); if (!request) { if(message.method==='Runtime.exceptionThrown')console.log('Worker error: '+JSON.stringify(message.params.exceptionDetails)); return; } pending.delete(message.id); if (message.error) request.reject(Error(message.error.message)); else request.resolve(message.result); });
  let target;
  for(let i=0;i<30 && !target;i++) {
    for(const candidate of (await command('Target.getTargets')).targetInfos.filter(t=>t.type==='service_worker')) {
      const probe=(await command('Target.attachToTarget',{targetId:candidate.targetId,flatten:true})).sessionId;
      try { const name=await evaluate(probe, "globalThis.chrome?.runtime?.getManifest?.().name"); if(name==='QuickCode for Proton Mail') target=candidate; }
      catch {} finally { await command('Target.detachFromTarget',{sessionId:probe}).catch(()=>{}); }
      if(target)break;
    }
    if(!target)await new Promise(r=>setTimeout(r,500));
  }
  assert.ok(target,'Isolated QuickCode worker did not load');
  const { sessionId } = await command('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  console.log('Attached to '+target.url);
  await command('Runtime.enable', {}, sessionId);
  await new Promise(r=>setTimeout(r,1500));
  console.log(await evaluate(sessionId, `({url:location.href,chrome:typeof chrome,browser:typeof browser})`));
  console.log(await evaluate(sessionId, `(async()=>{for(let i=0;i<30;i++){const title=await chrome.action.getTitle({});if(title.includes('unread inbox'))return title;await new Promise(r=>setTimeout(r,100));}return {title:await chrome.action.getTitle({}),alarms:await chrome.alarms.getAll()};})()`));
  await evaluate(sessionId, `(async()=>{
    await chrome.storage.local.set({preferences:{pollSeconds:30}});
    await chrome.storage.session.set({sessions:[{id:'fixture',uid:'fixture',username:'fixture@example.test',access:'synthetic',refresh:'synthetic',phase:'ready',remember:false,label:'Fixture',color:'#177668'}],snapshot:{fixture:[{accountId:'fixture',message:${JSON.stringify(old)},preview:'',codes:[],bodyLoaded:true}]},seeded:['fixture'],seen:['old'],checkedAt:Date.now(),unreadCounts:{fixture:1}});
    await chrome.alarms.create('quickcode-poll',{delayInMinutes:.05,periodInMinutes:.5});
  })()`);
  await command('Target.detachFromTarget', { sessionId });
  await command('Target.closeTarget', {targetId:target.targetId});
  console.log(fast?'Detached debugger. Waiting for a real alarm, with no popup.':'Detached debugger. Waiting for a real alarm and 35-second synthetic poll, with no popup.');
  await new Promise(resolve => setTimeout(resolve, fast ? 8_000 : 42_000));
  const { targetId } = await command('Target.createTarget', { url: 'about:blank' });
  const reader = (await command('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await command('Page.enable',{},reader);
  await command('Page.navigate',{url:new URL('clipboard.html', target.url).href},reader);
  await command('Runtime.enable',{},reader);
  let initialized=false;
  for(let i=0;i<50;i++){
    try { if(await evaluate(reader, '!!globalThis.chrome?.notifications?.getAll')){initialized=true;break;} } catch {}
    await new Promise(r=>setTimeout(r,100));
  }
  assert.ok(initialized,'Diagnostic page did not initialize');
  const result = await evaluate(reader, `(async()=>({notifications:await chrome.notifications.getAll(),state:await chrome.storage.session.get(['seen','notificationTargets','backgroundHealth','notificationHealth','testNotificationError','testNotificationCreated'])}))()`);
  console.log(JSON.stringify(result));
  assert.equal(result.state.testNotificationCreated, true, 'Browser did not create a background notification');
  assert.ok(Object.values(result.state.notificationTargets || {}).some(target => target.code === '583920'));
  console.log('Passed: '+(fast?'fast':'35-second')+' OTP poll completes without a popup or an attached debugger.');
} finally { if (ws?.readyState === WebSocket.OPEN) { await Promise.race([command('Browser.close').catch(() => {}), new Promise(r=>setTimeout(r,1000))]); ws.close(); } browserProcess.kill(); }
