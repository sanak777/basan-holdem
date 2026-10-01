import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { Table } from './poker.js';

const rooms=new Map(), sessions=new Map(), limits=new Map();
const password=process.env.ADMIN_PASSWORD || '8959';
const port=Number(process.env.PORT || 3000);
const publicRoot=fileURLToPath(new URL('./public/',import.meta.url));
const files=new Map([['/',['index.html','text/html; charset=utf-8']],['/style.css',['style.css','text/css; charset=utf-8']],['/app.js',['app.js','text/javascript; charset=utf-8']]]);
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
export function createRoomCode(existing,start=randomInt(1000,10000)) {
  for(let n=0;n<9000;n++) {
    const code=String(1000+(start-1000+n)%9000);
    if(!existing.has(code))return code;
  }
  fail('사용 가능한 방 코드가 없습니다.');
}
function throttle(key,max,windowMs) {
  let record=limits.get(key);
  if(!record||Date.now()>record.until) {record={count:0,until:Date.now()+windowMs};limits.set(key,record);}
  if(++record.count>max) fail('요청이 많습니다. 잠시 후 다시 시도해주세요.',429);
}
function checkPassword(value,ip) {
  const key=`password:${ip}`; const record=limits.get(key);
  if(record&&record.count>=10&&Date.now()<record.until) fail('로그인 시도 횟수를 초과했습니다. 15분 후 다시 시도해주세요.',429);
  const a=Buffer.from(String(value||'')),b=Buffer.from(password);
  if(a.length!==b.length||!timingSafeEqual(a,b)) {throttle(key,10,15*60*1000);fail('관리자 비밀번호가 올바르지 않습니다.',403);}
  limits.delete(key);
}
function newSession(room,name) {
  if(room.members.size>=80) fail('방 입장 인원이 가득 찼습니다.');
  const token=randomBytes(32).toString('hex');
  const user={id:randomUUID(),room:room.code,name,lastSeen:Date.now(),token};
  room.members.add(token);sessions.set(token,user);return user;
}
const nameOf=value=>{
  const name=String(value||'').trim().replace(/[\u0000-\u001f\u007f]/g,'').slice(0,16);
  if(!name) fail('닉네임을 입력해주세요.');return name;
};
const isConnected=id=>{for(const s of sessions.values()) if(s.id===id&&Date.now()-s.lastSeen<12000)return true;return false;};
function state(room,user) {
  return {...room.table.view(user.id),me:user.id,name:user.name,code:room.code,title:room.title,
    admin:room.adminId===user.id,running:room.running,sessionActive:!!room.sessionActive,
    canSit:!room.sessionActive&&!room.table.playing&&!room.table.player(user.id)&&(room.table.balances.get(user.id)??room.startingChips)>0,
    balance:room.table.player(user.id)?.chips??room.table.balances.get(user.id)??room.startingChips,
    nextAt:room.nextAt||0,startingChips:room.startingChips,
    serverTime:Date.now(),seats:room.table.view(user.id).seats.map(p=>p?{...p,connected:isConnected(p.id)}:null)};
}
async function body(req) {
  let data='';for await(const chunk of req) {data+=chunk;if(data.length>8192)fail('요청 크기가 너무 큽니다.',413);}
  try{return JSON.parse(data||'{}');}catch{fail('잘못된 요청입니다.');}
}
function config(room,data) {
  const small=Number(data.smallBlind),big=Number(data.bigBlind),chips=Number(data.startingChips),seconds=Number(data.turnSeconds);
  if(![small,big,chips,seconds].every(Number.isSafeInteger)||small<1||big<small*2||big>100000||chips<big*10||chips>10000000||seconds<10||seconds>120)
    fail('블라인드·칩·제한시간을 확인해주세요. 빅블라인드는 스몰의 2배 이상, 시작칩은 빅블라인드의 10배 이상이어야 합니다.');
  room.table.settings={smallBlind:small,bigBlind:big,turnSeconds:seconds};room.table.pendingBlinds=null;room.table.minRaise=big;room.startingChips=chips;
}
export const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
  const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  try {
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/health') return json({ok:true});
    if(!url.pathname.startsWith('/api/')) {
      const file=files.get(url.pathname);if(!file||req.method!=='GET'){res.writeHead(404);return res.end('Not found');}
      res.writeHead(200,{'Content-Type':file[1],'Cache-Control':'no-cache'});return res.end(await readFile(publicRoot+file[0]));
    }
    if(req.method==='POST'&&req.headers.origin) {
      const origin=new URL(req.headers.origin);if(origin.host!==req.headers.host) fail('허용되지 않은 요청입니다.',403);
    }
    const ip=(process.env.RENDER ? String(req.headers['x-forwarded-for']||req.socket.remoteAddress).split(',')[0] : req.socket.remoteAddress);
    throttle(`requests:${ip}`,6000,60000);
    const data=req.method==='POST'?await body(req):{};
    if(url.pathname==='/api/create'&&req.method==='POST') {
      checkPassword(data.password,ip);if(rooms.size>=100)fail('방이 가득 찼습니다.');
      const code=createRoomCode(rooms);
      const room={code,title:'바카라산악회 홀덤',table:new Table(),members:new Set(),adminId:null,running:false,nextAt:0,
        startingChips:100000,lastSeen:Date.now()};
      const user=newSession(room,nameOf(data.name));room.adminId=user.id;rooms.set(code,room);
      room.table.log('방이 열렸습니다. 참가자 착석 후 방장이 시작합니다.');return json({token:user.token,state:state(room,user)});
    }
    if(url.pathname==='/api/join'&&req.method==='POST') {
      throttle(`join:${ip}`,40,60000);
      const code=String(data.code||'').trim().normalize('NFKC');
      if(!/^[0-9]{4}$/.test(code))fail('방 코드는 숫자 4자리로 입력해주세요.');
      const room=rooms.get(code);if(!room)fail('방을 찾을 수 없습니다. 방 코드를 다시 확인해주세요.',404);
      const name=nameOf(data.name);
      if([...room.members].some(t=>sessions.get(t)?.name===name))fail('이미 사용 중인 닉네임입니다. 다른 이름을 입력해주세요.');
      const user=newSession(room,name);room.lastSeen=Date.now();return json({token:user.token,state:state(room,user)});
    }
    const token=String(req.headers.authorization||'').replace(/^Bearer /,'');
    const user=sessions.get(token);if(!user)fail('입장 정보가 만료되었습니다. 다시 입장해주세요.',401);
    throttle(`session:${token}`,180,60000);
    const room=rooms.get(user.room);if(!room)fail('방이 종료되었습니다. 다시 입장해주세요.',401);
    user.lastSeen=Date.now();room.lastSeen=Date.now();
    if(url.pathname==='/api/state'&&req.method==='GET')return json(state(room,user));
    if(req.method!=='POST')fail('잘못된 요청입니다.',405);
    if(url.pathname==='/api/admin-login') {checkPassword(data.password,ip);room.adminId=user.id;room.table.log('방장 관리 권한이 활성화되었습니다.');}
    else if(url.pathname==='/api/sit') {
      if(room.sessionActive||room.table.playing)fail('게임 시작 후에는 중간 참여할 수 없습니다. 관전은 가능합니다.');
      room.table.sit(user.id,user.name,Number(data.seat),room.startingChips);
    }
    else if(url.pathname==='/api/leave-seat') room.table.leave(user.id);
    else if(url.pathname==='/api/away') {
      const p=room.table.player(user.id);if(!p)fail('먼저 착석해주세요.');p.away=!p.away;room.table.log(`${p.name} · ${p.away?'자리비움':'복귀'}`);
    } else if(url.pathname==='/api/action') {
      room.table.act(user.id,data.kind,Number(data.amount),data.handNo,data.version);
    } else if(url.pathname==='/api/exit') {
      room.table.leave(user.id);sessions.delete(token);room.members.delete(token);return json({ok:true});
    } else if(url.pathname.startsWith('/api/admin/')) {
      if(room.adminId!==user.id)fail('방장만 사용할 수 있는 기능입니다.',403);
      const command=url.pathname.split('/').pop();
      if(command==='start') {
        if(room.running)fail('이미 게임이 시작되었습니다.');
        if(!room.table.playing) room.table.start(isConnected);
        room.running=true;room.sessionActive=true;room.nextAt=0;room.table.log('방장이 게임을 시작했습니다. 중간 착석은 마감되었습니다.');
      } else if(command==='stop'||command==='cancel') {
        room.running=false;room.sessionActive=false;room.nextAt=0;room.table.resetSession();
      }
      else if(command==='blinds') {
        room.table.setBlinds(Number(data.smallBlind),Number(data.bigBlind));
      } else if(command==='settings') {
        if(room.sessionActive||room.running||room.table.playing)fail('게임 종료 후 설정할 수 있습니다.');
        config(room,data);room.table.log('방장이 블라인드와 시작칩 설정을 변경했습니다.');
      } else if(command==='reset') {
        if(room.sessionActive||room.running||room.table.playing)fail('방장이 게임종료를 누른 후 칩을 초기화할 수 있습니다.');
        for(const p of room.table.seats.filter(Boolean))Object.assign(p,{chips:room.startingChips,inHand:false,cards:[],bet:0,total:0,folded:false,allIn:false,action:''});
        for(const id of room.table.balances.keys())room.table.balances.set(id,room.startingChips);
        room.table.phase='waiting';room.table.board=[];room.table.result=null;room.table.odds=null;room.table.revealing=false;room.table.runoutAt=0;room.table.log('모든 참가자의 가상칩이 초기화되었습니다.');
      } else if(command==='logout')room.adminId=null;
      else fail('없는 기능입니다.',404);
    } else fail('없는 기능입니다.',404);
    return json(state(room,user));
  } catch(error) {json({error:error.message||'서버 오류가 발생했습니다.'},error.status||400);}
});
const timer=setInterval(()=>{
  for(const [code,room] of rooms) {
    try {
      room.table.tick();
      if(room.running&&!room.table.playing) {
        if(!room.nextAt)room.nextAt=Date.now()+8000;
        if(Date.now()>=room.nextAt) {
          const count=room.table.seats.filter(p=>p&&!p.away&&!p.leaving&&p.chips>0&&isConnected(p.id)).length;
          if(count>=2){room.table.start(isConnected);room.nextAt=0;}
          else {room.running=false;room.nextAt=0;room.table.log('접속·착석 중인 참가자가 2명 미만이라 게임이 중지되었습니다. 방장이 다시 시작할 수 있습니다.');}
        }
      }
      if(Date.now()-room.lastSeen>12*60*60*1000) {for(const t of room.members)sessions.delete(t);rooms.delete(code);}
    } catch(error) {console.error('Game stopped:',error.message);room.running=false;room.nextAt=0;room.table.cancel();}
  }
  for(const [key,value] of limits)if(Date.now()>value.until)limits.delete(key);
},500);
timer.unref();
if(process.env.NODE_ENV!=='test') server.listen(port,'0.0.0.0',()=>console.log(`바카라산악회 홀덤 · http://localhost:${port}`));
