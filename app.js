const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Number(n||0).toLocaleString('ko-KR');
const phaseNames={waiting:'참가자 대기',preflop:'프리플롭',flop:'플롭',turn:'턴',river:'리버',finished:'판 종료'};
const suits={s:'♠',h:'♥',d:'♦',c:'♣'},ranks={11:'J',12:'Q',13:'K',14:'A'};
let token=sessionStorage.getItem('basan-holdem-token'),current=null,busy=false,polling=false,adminMode='create',toastTimer,epoch=0,connected=false,serverOffset=0;
const roomQuery=new URLSearchParams(location.search).get('room');
const numericCode=value=>String(value).normalize('NFKC').replace(/[^0-9]/g,'').slice(0,4);
if(roomQuery)$('room-code').value=numericCode(roomQuery);
$('room-code').addEventListener('input',()=>{$('room-code').value=numericCode($('room-code').value);});
$('nickname').value=localStorage.getItem('basan-holdem-name')||'';
function toast(message) {$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4500);}
async function request(path,data) {
  const response=await fetch(path,{method:data?'POST':'GET',headers:{...(data?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(12000)});
  const result=await response.json();if(!response.ok){const e=new Error(result.error||'요청에 실패했습니다.');e.status=response.status;throw e;}return result;
}
function connectedUI(value){connected=value;$('connection').textContent=value?'● 접속 중':'● 재연결 중';$('connection').classList.toggle('offline',!value);}
function enter(result) {
  token=result.token;sessionStorage.setItem('basan-holdem-token',token);localStorage.setItem('basan-holdem-name',result.state.name);
  history.replaceState({},'',`/?room=${result.state.code}`);$('lobby').hidden=true;$('game').hidden=false;connectedUI(true);render(result.state);
}
async function command(path,data={}) {
  if(busy)return;busy=true;epoch++;updateActions();
  try {const state=await request(path,data);connectedUI(true);render(state);return true;}
  catch(e){toast(e.message);return false;}
  finally{busy=false;updateActions();}
}
function card(c,empty=false) {
  if(empty)return '<span class="card empty"></span>';
  if(!c)return '<span class="card back" aria-label="비공개 카드"></span>';
  return `<span class="card ${c.s==='h'||c.s==='d'?'red':''}" aria-label="${esc(ranks[c.r]||c.r)} ${suits[c.s]}"><span class="rank">${ranks[c.r]||c.r}</span><span class="suit">${suits[c.s]}</span></span>`;
}
function render(state) {
  const prior=current;current=state;serverOffset=state.serverTime-Date.now();
  $('lobby').hidden=true;$('game').hidden=false;
  $('admin-bar').hidden=!state.admin;
  if(!state.admin && $('settings-dialog').open)$('settings-dialog').close();
  if(!state.admin && $('blinds-dialog').open)$('blinds-dialog').close();
  $('code-label').textContent=state.code;$('phase-label').textContent=phaseNames[state.phase];$('hand-label').textContent=`HAND ${state.handNo}`;
  $('pot').textContent=fmt(state.phase==='finished'?state.result?.pots.reduce((n,p)=>n+p.amount,0):state.pot);
  $('board').innerHTML=Array.from({length:5},(_,i)=>card(state.board[i],!state.board[i])).join('');
  $('blind-label').textContent=`NLH · ${fmt(state.settings.smallBlind)} / ${fmt(state.settings.bigBlind)}${state.pendingBlinds?` · 다음 판 ${fmt(state.pendingBlinds.smallBlind)} / ${fmt(state.pendingBlinds.bigBlind)}`:''}`;
  const me=state.seats.find(p=>p?.id===state.me),mySeat=me?.seat;
  const seats=Array.from({length:10},(_,visual)=>{
    const seat=mySeat===undefined?visual:(visual+mySeat-5+10)%10,p=state.seats[seat];
    if(!p)return `<div class="seat"><button class="empty-seat" data-seat="${seat}" ${me?'disabled':''}>＋ ${seat+1}번 좌석</button></div>`;
    const markers=p.seat===state.dealer?'D':p.seat===state.smallSeat&&state.phase==='preflop'?'SB':p.seat===state.bigSeat&&state.phase==='preflop'?'BB':'';
    const hand=state.result?.hands.find(h=>h.id===p.id)?.name;
    return `<div class="seat ${p.id===state.me?'me':''} ${state.turn===seat?'turn':''} ${p.inHand&&p.folded?'folded':''}">
      <div class="seat-cards">${p.cards.map(c=>card(c)).join('')}</div>
      <div class="seat-box"><div class="name">${esc(p.name)}${p.id===state.me?' · 나':''}${!p.connected?'<span class="offline-dot">●</span>':''}</div>
        <div class="chips">${p.allIn&&p.inHand&&state.phase!=='finished'?'ALL IN':fmt(p.chips)}</div>
        <div class="seat-action">${esc(p.leaving?'퇴장 예약':p.away?'자리비움':hand||p.action||'착석')}</div>
        ${markers?`<span class="dealer-tag">${markers}</span>`:''}</div>
      ${p.bet>0&&state.phase!=='finished'?`<span class="chip-bet">${fmt(p.bet)}</span>`:''}</div>`;
  }).join('');
  if($('seats').innerHTML!==seats)$('seats').innerHTML=seats;
  const whoseTurn=state.seats[state.turn];
  $('table-status').textContent=whoseTurn?`${whoseTurn.name}님의 차례`:state.running?state.nextAt?'다음 판 준비 중':'게임 진행 중':state.phase==='finished'?'방장이 시작하면 다음 판이 진행됩니다.':'방장의 게임 시작을 기다립니다.';
  $('my-status').textContent=me?`${me.name} · ${fmt(me.chips)}칩${me.leaving?' · 퇴장 예약':me.away?' · 자리비움':''}`:'관전 중 · 빈 좌석을 눌러 착석';
  $('away').disabled=!me||me.leaving;$('away').textContent=me?.away?'복귀':'자리비움';$('leave-seat').disabled=!me||me.leaving;
  $('admin-login-in-room').hidden=state.admin;
  $('start-game').disabled=state.running||busy;$('stop-game').disabled=!state.running||busy;$('cancel-game').disabled=(!state.running&&!['preflop','flop','turn','river'].includes(state.phase))||busy;
  $('result').hidden=!state.result;
  if(state.result) {
    const winners=state.result.winners.map(w=>`<b>${esc(w.name)}</b> +${fmt(w.amount)}칩 <small>${esc(w.hand)}</small>`).join('<br>');
    $('result').innerHTML=`${winners}<br><small>${state.result.pots.length>1?`메인팟 + 사이드팟 ${state.result.pots.length-1}개 개별 정산 · `:''}${state.running?'8초 후 다음 판':'게임 종료 · 방장 시작 대기'}</small>`;
  }
  if(prior?.handNo!==state.handNo||!state.legal)$('raise-form').hidden=true;
  if($('log-dialog').open)showLogs();
  updateActions();updateClock();
}
function updateActions() {
  const l=current?.legal,disabled=!l||busy||!connected;
  $('fold').disabled=disabled;$('check-call').disabled=disabled;
  $('check-call').textContent=l&&!l.check?`콜 ${fmt(l.call)}`:'체크';
  $('raise-toggle').disabled=disabled||!l?.canRaise||l.max<=current.currentBet;
  $('allin').disabled=disabled||!l||(l.max>current.currentBet&&!l.canRaise);
  if(l){$('raise-hint').textContent=`최소 ${fmt(l.min)}칩 · 최대 ${fmt(l.max)}칩${l.max<l.min?' (올인만 가능)':''}`;$('raise-amount').min=Math.min(l.min,l.max);$('raise-amount').max=l.max;}
}
function updateClock() {
  if(!current)return;
  const now=Date.now()+serverOffset;
  if(current.turn>=0){const n=Math.max(0,Math.ceil((current.deadline-now)/1000));$('turn-timer').textContent=`${current.legal?'내 차례 · ':''}${n}초`;}
  else if(current.running&&current.nextAt)$('turn-timer').textContent=`다음 판 ${Math.max(0,Math.ceil((current.nextAt-now)/1000))}초`;
  else $('turn-timer').textContent='';
}
async function poll() {
  if(!token||polling||busy)return;
  polling=true;const generation=epoch;
  try {
    const state=await request('/api/state');
    if(generation===epoch){connectedUI(true);render(state);}
  } catch(e) {
    if(generation!==epoch)return;
    connectedUI(false);updateActions();
    if(e.status===401){token=null;current=null;sessionStorage.removeItem('basan-holdem-token');$('game').hidden=true;$('lobby').hidden=false;toast('서버가 재시작되었거나 입장 정보가 만료되었습니다. 다시 입장해주세요.');}
  } finally{polling=false;}
}
function showLogs(){$('log-list').innerHTML=[...(current?.logs||[])].reverse().map(l=>`<p><small>${new Date(l.time).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</small> · ${esc(l.message)}</p>`).join('');}
$('join-form').addEventListener('submit',async e=>{
  e.preventDefault();if(busy)return;busy=true;
  try{enter(await request('/api/join',{name:$('nickname').value,code:$('room-code').value}));}
  catch(e){toast(e.message);}finally{busy=false;updateActions();}
});
$('create-room').onclick=()=>{
  if(!$('nickname').value.trim()){toast('닉네임을 먼저 입력해주세요.');$('nickname').focus();return;}
  adminMode='create';$('admin-password').value='';$('admin-dialog').showModal();
};
$('admin-login-in-room').onclick=()=>{$('log-dialog').close();adminMode='login';$('admin-password').value='';$('admin-dialog').showModal();};
$('admin-form').addEventListener('submit',async e=>{
  e.preventDefault();if(busy)return;busy=true;epoch++;
  try {
    if(adminMode==='create')enter(await request('/api/create',{name:$('nickname').value,password:$('admin-password').value}));
    else render(await request('/api/admin-login',{password:$('admin-password').value}));
    $('admin-dialog').close();$('admin-password').value='';toast('방장으로 로그인했습니다.');
  } catch(e){toast(e.message);}finally{busy=false;updateActions();}
});
document.querySelectorAll('.close-dialog').forEach(b=>b.onclick=()=>b.closest('dialog').close());
$('seats').onclick=async e=>{const button=e.target.closest('[data-seat]');if(button)await command('/api/sit',{seat:Number(button.dataset.seat)});};
async function act(kind,amount){if(!current?.legal)return;const ok=await command('/api/action',{kind,amount,handNo:current.handNo,version:current.version});if(ok)$('raise-form').hidden=true;}
$('fold').onclick=()=>act('fold');$('check-call').onclick=()=>act(current.legal.check?'check':'call');
$('allin').onclick=()=>{if(confirm(`보유한 ${fmt(current.legal.max-(current.seats.find(p=>p?.id===current.me)?.bet||0))}칩을 모두 베팅할까요?`))act('allin');};
$('raise-toggle').onclick=()=>{$('raise-form').hidden=!$('raise-form').hidden;$('raise-amount').value=Math.min(current.legal.min,current.legal.max);};
$('raise-form').addEventListener('submit',e=>{e.preventDefault();act('raise',Number($('raise-amount').value));});
document.querySelectorAll('[data-bet]').forEach(b=>b.onclick=()=>{
  if(!current?.legal)return;const l=current.legal;
  let amount=l.min;
  if(b.dataset.bet==='half')amount=current.currentBet+Math.ceil((current.pot+l.toCall)/2);
  if(b.dataset.bet==='pot')amount=current.currentBet+current.pot+l.toCall;
  if(b.dataset.bet==='max')amount=l.max;
  $('raise-amount').value=Math.min(l.max,Math.max(l.min,amount));
});
$('away').onclick=()=>command('/api/away');
$('leave-seat').onclick=()=>{if(confirm('자리에서 일어날까요? 진행 중이면 현재 판이 끝난 후 관전으로 전환됩니다.'))command('/api/leave-seat');};
$('show-log').onclick=()=>{showLogs();$('log-dialog').showModal();};
$('share').onclick=async()=>{
  const url=`${location.origin}/?room=${current.code}`;
  try{if(navigator.share)await navigator.share({title:'바카라산악회 홀덤',text:`방 코드 ${current.code}`,url});else{await navigator.clipboard.writeText(url);toast(`입장 링크 복사 완료 · 방 코드 ${current.code}`);}}
  catch(e){if(e.name!=='AbortError')prompt('아래 링크를 복사해서 회원들에게 보내주세요.',url);}
};
$('exit-room').onclick=async()=>{
  if(!confirm('방에서 나갈까요? 진행 중이면 제한시간에 따라 자동 체크 또는 폴드됩니다.'))return;
  if(busy)return;busy=true;epoch++;
  try{await request('/api/exit',{});token=null;current=null;sessionStorage.removeItem('basan-holdem-token');$('game').hidden=true;$('lobby').hidden=false;$('admin-bar').hidden=true;}
  catch(e){toast(e.message);}finally{busy=false;}
};
$('start-game').onclick=()=>command('/api/admin/start');$('stop-game').onclick=()=>command('/api/admin/stop');
$('cancel-game').onclick=()=>{if(confirm('진행 중인 판을 취소하고 베팅칩을 반환할까요?'))command('/api/admin/cancel');};
$('admin-panel-button').onclick=()=>{
  for(const [k,v] of Object.entries({...current.settings,startingChips:current.startingChips}))if($('settings-form').elements[k])$('settings-form').elements[k].value=v;
  $('settings-dialog').showModal();
};
$('blind-adjust').onclick=()=>{
  if(!current?.admin)return;
  const blinds=current.pendingBlinds||current.settings;
  $('blind-small').value=blinds.smallBlind;$('blind-big').value=blinds.bigBlind;
  $('blind-adjust-note').textContent=['preflop','flop','turn','river'].includes(current.phase)
    ?`현재 판은 ${fmt(current.settings.smallBlind)} / ${fmt(current.settings.bigBlind)}로 마칩니다. 변경은 다음 판부터 적용됩니다.`
    :'대기 중에는 즉시 적용되며, 다음 게임은 변경한 블라인드로 시작합니다.';
  $('blinds-dialog').showModal();
};
$('blinds-form').addEventListener('submit',async e=>{
  e.preventDefault();if(!current?.admin)return;
  if(await command('/api/admin/blinds',{smallBlind:Number($('blind-small').value),bigBlind:Number($('blind-big').value)})) {
    $('blinds-dialog').close();toast(current.pendingBlinds?'블라인드를 예약했습니다. 다음 판부터 적용됩니다.':'블라인드를 변경했습니다.');
  }
});
$('settings-form').addEventListener('submit',async e=>{
  e.preventDefault();const data=Object.fromEntries(new FormData(e.target));if(await command('/api/admin/settings',data)){toast('설정을 저장했습니다. 시작칩 변경은 새 참가자에게 적용됩니다. 전체 적용은 칩 초기화를 눌러주세요.');$('settings-dialog').close();}
});
$('reset-chips').onclick=()=>{if(confirm('모든 참가자의 가상칩을 시작칩으로 초기화할까요?'))command('/api/admin/reset');};
$('admin-logout').onclick=async()=>{if(await command('/api/admin/logout')){$('settings-dialog').close();toast('관리자 로그아웃 완료');}};
setInterval(poll,1000);setInterval(updateClock,250);if(token)poll();
