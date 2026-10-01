import test from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV='test';
const {server}=await import('../server.js');
test('admin authentication, participant permissions, privacy, start, stop, cancel',async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function api(path,data,token){const r=await fetch(base+path,{method:data?'POST':'GET',headers:{...(data?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},body:data?JSON.stringify(data):undefined});return {status:r.status,body:await r.json()};}
  try {
    assert.equal((await api('/api/create',{name:'방장',password:'wrong'})).status,403);
    const admin=(await api('/api/create',{name:'방장',password:process.env.ADMIN_PASSWORD||'8959'})).body;
    const a=(await api('/api/join',{name:'참가자A',code:admin.state.code})).body;
    const b=(await api('/api/join',{name:'참가자B',code:admin.state.code})).body;
    assert.equal(a.state.admin,false);assert.equal(admin.state.admin,true);
    for(const action of ['start','stop','cancel','settings','reset','logout'])assert.equal((await api('/api/admin/'+action,{},a.token)).status,403);
    assert.equal((await api('/api/admin/start',{},admin.token)).status,400);
    await api('/api/sit',{seat:0},a.token);await api('/api/sit',{seat:1},b.token);
    assert.equal((await api('/api/sit',{seat:0},admin.token)).status,400);
    const started=await api('/api/admin/start',{},admin.token);assert.equal(started.body.phase,'preflop');assert.equal(started.body.running,true);
    const av=(await api('/api/state',null,a.token)).body;
    assert.ok(av.seats[0].cards.every(Boolean));assert.ok(av.seats[1].cards.every(c=>c===null));assert.ok(started.body.seats.every(p=>!p||p.cards.every(c=>c===null)));
    assert.equal((await api('/api/admin/settings',{smallBlind:100,bigBlind:200,startingChips:10000,turnSeconds:20},admin.token)).status,400);
    const stop=await api('/api/admin/stop',{},admin.token);assert.equal(stop.body.running,false);assert.equal(stop.body.phase,'preflop');
    const cancelled=await api('/api/admin/cancel',{},admin.token);assert.equal(cancelled.body.phase,'waiting');assert.equal(cancelled.body.seats[0].chips,100000);assert.equal(cancelled.body.seats[1].chips,100000);
    assert.equal((await api('/api/admin/logout',{},admin.token)).body.admin,false);
    assert.equal((await api('/api/admin/start',{},admin.token)).status,403);
    assert.equal((await api('/api/admin-login',{password:process.env.ADMIN_PASSWORD||'8959'},a.token)).body.admin,true);
    assert.equal((await api('/api/state',null,admin.token)).body.admin,false);
    const page=await (await fetch(base+'/app.js')).text();assert.ok(!page.includes('8959'));assert.ok(!page.includes('/api/chat'));
  } finally {await new Promise(resolve=>server.close(resolve));}
});
