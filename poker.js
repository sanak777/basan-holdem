import { randomInt } from 'node:crypto';

export const HAND_NAMES = ['하이카드','원페어','투페어','트리플','스트레이트','플러시','풀하우스','포카드','스트레이트 플러시'];
export function compare(a, b) {
  for (let i = 0; i < Math.max(a.length,b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}
function five(cards) {
  const counts = new Map();
  for (const c of cards) counts.set(c.r,(counts.get(c.r)||0)+1);
  const groups = [...counts].sort((a,b)=>b[1]-a[1] || b[0]-a[0]);
  const ranks = [...counts.keys()].sort((a,b)=>b-a);
  const flush = cards.every(c=>c.s===cards[0].s);
  const straight = ranks.length===5 && (ranks[0]-ranks[4]===4 ? ranks[0] : ranks.join(',')==='14,5,4,3,2' ? 5 : 0);
  if (flush && straight) return [8,straight];
  if (groups[0][1]===4) return [7,groups[0][0],groups[1][0]];
  if (groups[0][1]===3 && groups[1][1]===2) return [6,groups[0][0],groups[1][0]];
  if (flush) return [5,...ranks];
  if (straight) return [4,straight];
  if (groups[0][1]===3) return [3,groups[0][0],...ranks.filter(x=>x!==groups[0][0])];
  if (groups[0][1]===2 && groups[1][1]===2) return [2,Math.max(groups[0][0],groups[1][0]),Math.min(groups[0][0],groups[1][0]),groups[2][0]];
  if (groups[0][1]===2) return [1,groups[0][0],...ranks.filter(x=>x!==groups[0][0])];
  return [0,...ranks];
}
export function evaluate(cards) {
  if (cards.length<5 || cards.length>7) throw new Error('카드 개수 오류');
  let best = null;
  for(let a=0;a<cards.length-4;a++) for(let b=a+1;b<cards.length-3;b++)
  for(let c=b+1;c<cards.length-2;c++) for(let d=c+1;d<cards.length-1;d++)
  for(let e=d+1;e<cards.length;e++) {
    const score = five([cards[a],cards[b],cards[c],cards[d],cards[e]]);
    if(!best || compare(score,best)>0) best=score;
  }
  return best;
}
export function describeHand(cards) {
  if(cards.length<2)return '';
  let score;
  if(cards.length>=5)score=evaluate(cards);
  else {
    const counts=new Map();for(const c of cards)counts.set(c.r,(counts.get(c.r)||0)+1);
    const groups=[...counts].sort((a,b)=>b[1]-a[1]||b[0]-a[0]);
    score=[groups[0][1]===4?7:groups[0][1]===3?3:groups[0][1]===2?(groups[1]?.[1]===2?2:1):0,groups[0][0]];
    if(score[0]===2)score.push(groups[1][0]);
  }
  const rank=r=>({14:'A',13:'K',12:'Q',11:'J'}[r]||String(r));
  if(score[0]===8&&score[1]===14)return '로열 스트레이트 플러시';
  return HAND_NAMES[score[0]]+' '+rank(score[1])+(score[0]===2?' · '+rank(score[2]):'');
}
const combinations=(n,k)=>{
  if(k<0||k>n)return 0;
  let count=1;for(let i=1;i<=k;i++)count=count*(n-i+1)/i;return Math.round(count);
};
// Exact probability of a final seven-card hand ranking at least one pair.
// Conditioned only on this player's cards and the public board. No opponent
// cards, burn cards, or pre-shuffled future board cards are inspected.
export function madeProbability(cards) {
  if(cards.length<2||cards.length>7)throw new Error('카드 개수 오류');
  const ranks=new Set(cards.map(c=>c.r)),missing=7-cards.length;
  if(ranks.size<cards.length)return {percent:100,estimated:false,threshold:'원페어 이상'};
  const base={s:0,h:0,d:0,c:0};for(const card of cards)base[card.s]++;
  let flushWays=0;
  for(const count of Object.values(base))for(let j=Math.max(0,5-count);j<=missing;j++)flushWays+=combinations(missing,j)*3**(missing-j);
  const available=Array.from({length:13},(_,i)=>i+2).filter(r=>!ranks.has(r));
  let nonStraightRankSets=0;
  const isStraight=set=>{
    for(let high=14;high>=6;high--)if([0,1,2,3,4].every(i=>set.has(high-i)))return true;
    return [14,5,4,3,2].every(r=>set.has(r));
  };
  const visit=(start,left)=>{
    if(!left){if(!isStraight(ranks))nonStraightRankSets++;return;}
    for(let i=start;i<=available.length-left;i++){ranks.add(available[i]);visit(i+1,left-1);ranks.delete(available[i]);}
  };
  visit(0,missing);
  const total=combinations(52-cards.length,missing);
  const unmade=nonStraightRankSets*(4**missing-flushWays);
  return {percent:Math.round((1-unmade/total)*1000)/10,estimated:false,threshold:'원페어 이상'};
}
export function deck() {
  const cards=[];
  for(const s of ['s','h','d','c']) for(let r=2;r<=14;r++) cards.push({r,s});
  for(let i=cards.length-1;i>0;i--) {
    const j=randomInt(i+1); [cards[i],cards[j]]=[cards[j],cards[i]];
  }
  return cards;
}
export function equity(players,board,sampleCount=1200) {
  const known=new Set([...board,...players.flatMap(p=>p.cards)].map(c=>c.r+c.s));
  const remaining=[];
  for(const s of ['s','h','d','c'])for(let r=2;r<=14;r++)if(!known.has(r+s))remaining.push({r,s});
  const needed=5-board.length,shares=players.map(()=>0);let trials=0;
  const trial=extra=>{
    const scores=players.map(p=>evaluate([...p.cards,...board,...extra]));
    const best=scores.reduce((a,b)=>compare(a,b)>0?a:b);
    const wins=scores.map((s,i)=>compare(s,best)===0?i:-1).filter(i=>i>=0);
    for(const i of wins)shares[i]+=1/wins.length;trials++;
  };
  if(needed===0)trial([]);
  else if(needed===1)for(const c of remaining)trial([c]);
  else if(needed===2)for(let i=0;i<remaining.length-1;i++)for(let j=i+1;j<remaining.length;j++)trial([remaining[i],remaining[j]]);
  else for(let n=0;n<sampleCount;n++) {
    for(let i=0;i<needed;i++){const j=randomInt(i,remaining.length);[remaining[i],remaining[j]]=[remaining[j],remaining[i]];}
    trial(remaining.slice(0,needed));
  }
  return {estimated:needed>2,samples:trials,players:players.map((p,i)=>({id:p.id,percent:Math.round(shares[i]/trials*1000)/10,
    hand:board.length>=3?HAND_NAMES[evaluate([...p.cards,...board])[0]]:p.cards[0].r===p.cards[1].r?'원페어':'하이카드'}))};
}
const requireRule = (condition,message) => { if(!condition) throw new Error(message); };
export class Table {
  constructor({smallBlind=3000,bigBlind=6000,turnSeconds=30,computeOdds=true}={}) {
    this.settings={smallBlind,bigBlind,turnSeconds};
    this.seats=Array(20).fill(null);
    this.dealer=-1; this.phase='waiting'; this.handNo=0; this.board=[];
    this.turn=-1; this.deadline=0; this.currentBet=0; this.minRaise=bigBlind;
    this.result=null; this.logs=[]; this.version=0; this.balances=new Map(); this.pendingBlinds=null;
    this.computeOdds=computeOdds;this.revealing=false;this.runoutAt=0;this.odds=null;this.events=[];this.eventId=0;
    this.dealing=false;this.dealQueue=[];this.dealAt=0;
    this.madeCache=new Map();
  }
  get playing() { return ['preflop','flop','turn','river'].includes(this.phase); }
  log(message,sound=null) {
    this.logs.push({message,time:Date.now()});this.logs=this.logs.slice(-40);this.version++;
    if(sound){this.events.push({id:++this.eventId,type:sound,time:Date.now()});this.events=this.events.slice(-40);}
  }
  sit(id,name,seat,chips) {
    requireRule(Number.isInteger(seat)&&seat>=0&&seat<20,'좌석을 선택해주세요.');
    requireRule(!this.seats.some(p=>p?.id===id),'이미 착석 중입니다.');
    requireRule(!this.seats[seat],'다른 참가자가 앉은 좌석입니다.');
    chips=this.balances.has(id)?this.balances.get(id):chips;
    requireRule(chips>0,'보유칩이 없어 다시 착석할 수 없습니다. 관전은 가능합니다.');this.balances.set(id,chips);
    this.seats[seat]={id,name,chips,away:false,leaving:false,inHand:false,cards:[],bet:0,total:0,folded:false,allIn:false,actedAt:null,action:''};
    this.log(`${name}님이 ${seat+1}번 좌석에 앉았습니다.`);
  }
  player(id) { return this.seats.find(p=>p?.id===id); }
  setBlinds(smallBlind,bigBlind) {
    requireRule(Number.isSafeInteger(smallBlind)&&Number.isSafeInteger(bigBlind)&&smallBlind>=1&&bigBlind>=smallBlind*2&&bigBlind<=100000,
      '블라인드를 확인해주세요. 빅 블라인드는 스몰의 2배 이상, 최대 100,000칩이어야 합니다.');
    if(this.playing) {
      this.pendingBlinds={smallBlind,bigBlind};
      this.log(`방장 블라인드 변경 예약 · 다음 판부터 ${smallBlind.toLocaleString()} / ${bigBlind.toLocaleString()}`);
    } else {
      this.settings={...this.settings,smallBlind,bigBlind};this.pendingBlinds=null;this.minRaise=bigBlind;
      this.log(`방장 블라인드 변경 · ${smallBlind.toLocaleString()} / ${bigBlind.toLocaleString()}`);
    }
  }
  applyPendingBlinds() {
    if(this.pendingBlinds) {this.settings={...this.settings,...this.pendingBlinds};this.pendingBlinds=null;this.minRaise=this.settings.bigBlind;}
  }
  next(from,predicate) {
    for(let n=1;n<=20;n++) { const s=(from+n+20)%20; if(this.seats[s] && predicate(this.seats[s])) return s; }
    return -1;
  }
  leave(id) {
    const i=this.seats.findIndex(p=>p?.id===id); if(i<0) return;
    const p=this.seats[i];
    if(this.playing&&p.inHand) { p.leaving=true; p.away=true; this.log(`${p.name}님은 이번 판 이후 퇴장합니다.`); }
    else { this.balances.set(id,p.chips);this.seats[i]=null; this.log(`${p.name}님이 자리에서 일어났습니다.`); }
  }
  kick(id) {
    const p=this.player(id);requireRule(p,'참가자가 이미 자리를 떠났습니다.');
    this.leave(id);
    if(this.playing&&p.inHand&&!p.folded&&!p.allIn&&!this.revealing) {
      p.folded=true;p.action='강퇴 · 폴드';this.version++;
      this.log(`${p.name} · 강퇴로 폴드`,'fold');
      if(this.seats.filter(x=>x?.inHand&&!x.folded).length===1)this.finish(false);
      else if(this.turn===this.seats.indexOf(p))this.advance(this.seats.indexOf(p));
    }
    this.log(`${p.name}님을 방장이 강퇴했습니다.`);
  }
  start(connected=()=>true) {
    requireRule(!this.playing,'이미 게임이 진행 중입니다.');
    this.cleanup();
    const ready=p=>p.chips>0&&!p.away&&!p.leaving&&connected(p.id);
    requireRule(this.seats.filter(p=>p&&ready(p)).length>=2,'접속 중인 참가자 2명 이상이 착석해야 합니다.');
    this.applyPendingBlinds();
    this.handNo++; this.phase='preflop'; this.result=null; this.board=[];this.revealing=false;this.runoutAt=0;this.odds=null;this.dealing=false;this.dealQueue=[];this.dealAt=0;this.madeCache.clear();
    this.cards=deck(); this.currentBet=this.settings.bigBlind; this.minRaise=this.settings.bigBlind;
    this.dealer=this.next(this.dealer,ready);
    for(const p of this.seats.filter(Boolean)) {
      Object.assign(p,{inHand:ready(p),cards:[],bet:0,total:0,folded:false,allIn:false,actedAt:null,action:''});
    }
    const playing=this.seats.filter(p=>p?.inHand);
    let dealSeat=this.dealer;
    for(let round=0;round<2;round++) for(let n=0;n<playing.length;n++) {
      dealSeat=this.next(dealSeat,p=>p.inHand); this.seats[dealSeat].cards.push(this.cards.pop());
    }
    const sb=playing.length===2?this.dealer:this.next(this.dealer,p=>p.inHand);
    const bb=this.next(sb,p=>p.inHand);
    this.smallSeat=sb; this.bigSeat=bb;
    this.pay(this.seats[sb],this.settings.smallBlind); this.seats[sb].action='스몰 블라인드';
    this.pay(this.seats[bb],this.settings.bigBlind); this.seats[bb].action='빅 블라인드';
    this.log(`${this.handNo}번째 판 시작 · 블라인드 ${this.settings.smallBlind.toLocaleString()} / ${this.settings.bigBlind.toLocaleString()}`,'deal');
    this.advance(bb);
  }
  pay(p,amount) {
    const paid=Math.min(amount,p.chips);
    p.chips-=paid; p.bet+=paid; p.total+=paid; p.allIn=p.chips===0;
    return paid;
  }
  canRaise(p) {
    return (p.actedAt===null || this.currentBet-p.actedAt>=this.minRaise)
      && this.seats.some(x=>x&&x!==p&&x.inHand&&!x.folded&&!x.allIn);
  }
  legal(id) {
    const p=this.player(id);
    if(!this.playing || this.seats[this.turn]!==p || !p) return null;
    return {call:Math.min(Math.max(0,this.currentBet-p.bet),p.chips),toCall:Math.max(0,this.currentBet-p.bet),
      min:this.currentBet+this.minRaise,max:p.bet+p.chips,canRaise:this.canRaise(p),check:p.bet>=this.currentBet};
  }
  act(id,kind,amount,handNo,version) {
    requireRule(this.playing,'진행 중인 판이 없습니다.');
    requireRule(handNo===this.handNo && version===this.version,'게임 상태가 변경되었습니다. 화면이 갱신된 후 다시 선택해주세요.');
    const p=this.player(id), legal=this.legal(id);
    requireRule(!!legal,'본인 차례가 아닙니다.');
    const seat=this.turn;
    if(kind==='fold') { p.folded=true; p.action='폴드'; }
    else if(kind==='check') { requireRule(legal.check,'콜 또는 폴드를 선택해주세요.'); p.action='체크'; }
    else if(kind==='call') {
      this.pay(p,legal.call); p.action=p.allIn?'올인':legal.call?'콜':'체크';
    } else if(kind==='raise'||kind==='allin') {
      const target=kind==='allin'?legal.max:amount;
      requireRule(Number.isSafeInteger(target)&&target>p.bet&&target<=legal.max,'베팅 금액을 확인해주세요.');
      if(target<=this.currentBet) {
        requireRule(target===legal.max,'부족한 콜은 올인만 가능합니다.');
        this.pay(p,target-p.bet); p.action='올인';
      } else {
        requireRule(legal.canRaise,'이 차례에는 다시 레이즈할 수 없습니다.');
        requireRule(target>=legal.min || target===legal.max,'최소 레이즈 금액 이상을 입력해주세요.');
        const increase=target-this.currentBet;
        this.pay(p,target-p.bet); this.currentBet=target;
        if(increase>=this.minRaise) this.minRaise=increase;
        p.action=p.allIn?'올인': '레이즈';
      }
    } else throw new Error('잘못된 행동입니다.');
    p.actedAt=this.currentBet;
    this.log(`${p.name} · ${p.action}${p.action==='폴드'||p.action==='체크'?'':` ${p.bet.toLocaleString()}`}`,p.action==='폴드'?'fold':p.action==='체크'?'check':p.allIn?'allin':'chips');
    this.advance(seat);
  }
  advance(from) {
    const live=this.seats.filter(p=>p?.inHand&&!p.folded);
    if(live.length===1) return this.finish(false);
    const able=live.filter(p=>!p.allIn);
    const pending=p=>p.inHand&&!p.folded&&!p.allIn&&(p.actedAt===null||p.bet<this.currentBet);
    // One remaining player may still need to call, but cannot bet into a dry side pot.
    if(able.length<=1 && (!able.length||able[0].bet>=this.currentBet)) return this.runout();
    const next=this.next(from,pending);
    if(next!==-1) { this.turn=next; this.deadline=Date.now()+this.settings.turnSeconds*1000; this.version++; return; }
    if(this.phase==='river') return this.finish(true);
    this.street();
    if(!this.dealing)this.advance(this.dealer);
  }
  street() {
    const phases=['preflop','flop','turn','river']; this.phase=phases[phases.indexOf(this.phase)+1];
    this.cards.pop(); // burn
    const count=this.phase==='flop'?3:1;
    this.dealQueue=[];for(let n=0;n<count;n++)this.dealQueue.push(this.cards.pop());
    this.board.push(this.dealQueue.shift());
    this.dealing=this.dealQueue.length>0;this.dealAt=Date.now()+400;
    if(this.dealing){this.turn=-1;this.deadline=0;}
    for(const p of this.seats.filter(Boolean)) { p.bet=0;p.actedAt=null;p.action=p.folded?'폴드':p.allIn?'올인':''; }
    this.currentBet=0; this.minRaise=this.settings.bigBlind;
    this.log({flop:'플롭',turn:'턴',river:'리버'}[this.phase]+' 공개','reveal');
  }
  updateOdds() {
    const live=this.seats.filter(p=>p?.inHand&&!p.folded);
    this.odds=this.computeOdds&&live.length>1?equity(live,this.board,Math.max(400,Math.floor(3000/live.length))):null;
  }
  runout() {
    this.revealing=true;this.turn=-1;this.deadline=0;this.updateOdds();
    this.runoutAt=Date.now()+2500;this.log('올인 베팅 완료 · 패 공개 · 승률 계산','reveal');
  }
  tick(now=Date.now()) {
    if(this.dealing&&this.playing) {
      if(now>=this.dealAt) {
        this.board.push(this.dealQueue.shift());this.log(`플롭 ${this.board.length}번째 카드 공개`,'reveal');
        if(this.revealing)this.updateOdds();
        this.dealing=this.dealQueue.length>0;this.dealAt=Date.now()+400;
        if(!this.dealing){if(this.revealing)this.runoutAt=Date.now()+2500;else this.advance(this.dealer);}
      }
      return;
    }
    if(this.revealing&&this.playing&&now>=this.runoutAt) {
      if(this.phase==='river')this.finish(true);
      else {this.street();this.updateOdds();this.runoutAt=Date.now()+2500;}
    } else this.timeout();
  }
  finish(showdown) {
    const players=this.seats.filter(p=>p?.inHand);
    const live=players.filter(p=>!p.folded);
    const payouts=new Map(), pots=[], returned=new Map();
    const levels=[...new Set(players.map(p=>p.total).filter(Boolean))].sort((a,b)=>a-b);
    const scores=new Map(showdown?live.map(p=>[p.id,evaluate([...p.cards,...this.board])]):[]);
    let previous=0;
    for(const level of levels) {
      const contributors=players.filter(p=>p.total>=level);
      const amount=(level-previous)*contributors.length; previous=level;
      if(contributors.length===1) {
        const p=contributors[0];p.chips+=amount;returned.set(p.id,(returned.get(p.id)||0)+amount);continue;
      }
      const eligible=contributors.filter(p=>!p.folded);
      requireRule(eligible.length>0,'팟 계산 오류');
      let winners=eligible;
      if(showdown) {
        const best=eligible.reduce((best,p)=>compare(scores.get(p.id),best)>0?scores.get(p.id):best,scores.get(eligible[0].id));
        winners=eligible.filter(p=>compare(scores.get(p.id),best)===0);
      }
      winners.sort((a,b)=>((this.seats.indexOf(a)-this.dealer+19)%20)-((this.seats.indexOf(b)-this.dealer+19)%20));
      const share=Math.floor(amount/winners.length), remainder=amount%winners.length;
      winners.forEach((p,i)=>{const won=share+(i<remainder?1:0);p.chips+=won;payouts.set(p.id,(payouts.get(p.id)||0)+won);});
      pots.push({amount,winners:winners.map(p=>({id:p.id,name:p.name}))});
    }
    this.result={showdown,pots,winners:[...payouts].map(([id,amount])=>({id,name:this.player(id).name,amount,
      hand:showdown?HAND_NAMES[scores.get(id)[0]]:'상대 폴드'})),returned:[...returned].map(([id,amount])=>({id,amount})),
      hands:showdown?live.map(p=>({id:p.id,name:HAND_NAMES[scores.get(p.id)[0]]})):[]};
    this.phase='finished';this.turn=-1;this.deadline=0;this.revealing=false;this.runoutAt=0;
    if(showdown)this.updateOdds();else this.odds=null;
    this.log(this.result.winners.map(w=>`${w.name} ${w.amount.toLocaleString()}칩 획득 (${w.hand})`).join(' · ')||'판 종료');
  }
  cancel() {
    for(const p of this.seats.filter(Boolean)) {
      if(this.playing)p.chips+=p.total;
      Object.assign(p,{total:0,bet:0,cards:[],inHand:false,folded:false,allIn:false,actedAt:null,action:''});
    }
    this.phase='waiting';this.board=[];this.turn=-1;this.deadline=0;this.result=null;this.revealing=false;this.runoutAt=0;this.odds=null;this.dealing=false;this.dealQueue=[];this.dealAt=0;
    this.applyPendingBlinds();
    this.log('방장이 즉시 종료했습니다. 진행 중인 판의 베팅칩을 반환했습니다.');this.cleanup();
  }
  cleanup() {
    for(let i=0;i<20;i++) if(this.seats[i]?.leaving) {this.balances.set(this.seats[i].id,this.seats[i].chips);this.seats[i]=null;}
  }
  resetSession() {
    this.cancel();this.seats=Array(20).fill(null);this.balances.clear();
    this.dealer=-1;this.smallSeat=undefined;this.bigSeat=undefined;this.handNo=0;
    this.madeCache.clear();
    this.log('게임 종료 · 전원 관전 전환 · 좌석과 보유칩 초기화. 다음 게임은 다시 착석해주세요.');
  }
  timeout() {
    if(this.playing && !this.revealing && !this.dealing && this.turn>=0 && Date.now()>=this.deadline) {
      const p=this.seats[this.turn]; p.away=true;
      this.act(p.id,p.bet>=this.currentBet?'check':'fold',0,this.handNo,this.version);
    }
  }
  view(id) {
    const mine=this.player(id),known=mine?.cards.length===2?[...mine.cards,...this.board]:null;
    let made=null;
    if(known){const key=known.map(c=>c.r+c.s).join(',');if(!this.madeCache.has(key))this.madeCache.set(key,madeProbability(known));made=this.madeCache.get(key);}
    return {settings:this.settings,pendingBlinds:this.pendingBlinds,seats:this.seats.map((p,i)=>p?{id:p.id,name:p.name,seat:i,chips:p.chips,
      bet:p.bet,total:p.total,away:p.away,leaving:p.leaving,inHand:p.inHand,folded:p.folded,allIn:p.allIn,action:p.action,
      cards:p.id===id||((this.revealing||this.result?.showdown)&&p.inHand&&!p.folded)?p.cards:p.cards.map(()=>null)}:null),
      phase:this.phase,handNo:this.handNo,dealer:this.dealer,smallSeat:this.smallSeat,bigSeat:this.bigSeat,
      board:this.board,turn:this.turn,deadline:this.deadline,pot:this.playing?this.seats.reduce((n,p)=>n+(p?.total||0),0):0,
      currentBet:this.currentBet,result:this.result,legal:this.legal(id),version:this.version,logs:this.logs,
      revealing:this.revealing,dealing:this.dealing,odds:this.odds,events:this.events,
      myHand:known?describeHand(known):null,myMade:made};
  }
}
