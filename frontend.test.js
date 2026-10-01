// Runs the shipped client against the HTTP server. This checks client/server
// interaction and visibility flags; it is not a browser layout test.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
process.env.NODE_ENV='test';
const {server}=await import('../server.js');
const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const script=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
function client(base) {
  const elements=new Map();
  for(const m of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g))elements.set(m[1],{
    hidden:/\bhidden\b/.test(m[0]),disabled:/\bdisabled\b/.test(m[0]),value:'',innerHTML:'',textContent:'',open:false,
    classList:{toggle(){}},listeners:{},addEventListener(k,fn){this.listeners[k]=fn;},
    showModal(){this.open=true;},close(){this.open=false;},focus(){},elements:{}
  });
  const storage=()=>{const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};};
  const context=vm.createContext({document:{getElementById:id=>elements.get(id),querySelectorAll:()=>[]},
    sessionStorage:storage(),localStorage:storage(),URLSearchParams,location:{search:'',origin:base},history:{replaceState(){}},
    navigator:{},AbortSignal,fetch:(path,opts)=>fetch(base+path,opts),console,
    setInterval:()=>1,setTimeout:()=>1,clearTimeout(){},confirm:()=>true,prompt(){}});
  vm.runInContext(script+'\nglobalThis.inspect={poll,act,command,get state(){return current;}};',context);
  return {elements,context,get:id=>elements.get(id),api:context.inspect};
}
test('shipped client can create/join/sit/start/play/stop and hides admin for guests',async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`,event={preventDefault(){}};
  try {
    const host=client(base),a=client(base),b=client(base);
    host.get('nickname').value='방장';host.get('create-room').onclick();host.get('admin-password').value=process.env.ADMIN_PASSWORD||'8959';
    await host.get('admin-form').listeners.submit(event);
    const code=host.api.state.code;assert.equal(host.get('admin-bar').hidden,false);
    for(const [p,name,seat] of [[a,'신선생',0],[b,'고회장',1]]) {
      p.get('nickname').value=name;p.get('room-code').value=code;
      await p.get('join-form').listeners.submit(event);
      await p.get('seats').onclick({target:{closest:()=>({dataset:{seat:String(seat)}})}});
      assert.equal(p.get('admin-bar').hidden,true);assert.match(p.get('seats').innerHTML,/seat me/);
    }
    await host.get('start-game').onclick();await a.api.poll();await b.api.poll();
    assert.equal(a.api.state.phase,'preflop');assert.equal(a.get('check-call').disabled,false);
    assert.equal(b.get('check-call').disabled,true);
    let actions=0;
    while(a.api.state.phase!=='finished'&&actions++<30) {
      for(const p of [a,b]) {await p.api.poll();if(p.api.state.legal)await p.get('check-call').onclick();}
      await a.api.poll();
    }
    assert.equal(a.api.state.phase,'finished');assert.equal(a.get('result').hidden,false);
    await host.get('stop-game').onclick();assert.equal(host.api.state.running,false);
    await host.api.command('/api/admin/logout');assert.equal(host.get('admin-bar').hidden,true);
    assert.equal(a.get('admin-bar').hidden,true);assert.equal(b.get('admin-bar').hidden,true);
  } finally {await new Promise(resolve=>server.close(resolve));}
});
