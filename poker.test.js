import test from 'node:test';
import assert from 'node:assert/strict';
import {Table,evaluate,compare,deck} from '../poker.js';
const c=text=>text.split(' ').map(x=>({r:({A:14,K:13,Q:12,J:11,T:10}[x[0]]||Number(x[0])),s:x[1]}));
const setup=(chips=[10000,10000,10000])=>{
  const t=new Table({smallBlind:50,bigBlind:100});chips.forEach((v,i)=>t.sit(String(i),`선수${i}`,i,v));return t;
};
const act=(t,kind,amount)=>t.act(t.seats[t.turn].id,kind,amount,t.handNo,t.version);
const total=t=>t.seats.reduce((n,p)=>n+(p?p.chips+(t.playing?p.total:0):0),0);
test('all categories, ace low straight, best of seven, kickers',()=>{
  const hands=['As Kh 9d 7c 2h','As Ah Kd 7c 2h','As Ah Kd Kc 2h','As Ah Ad 7c 2h','As 2h 3d 4c 5h','As Js 9s 7s 2s','As Ah Ad Kc Kh','As Ah Ad Ac Kh','9s Ts Js Qs Ks'];
  hands.forEach((hand,i)=>assert.equal(evaluate(c(hand))[0],i));
  assert.deepEqual(evaluate(c('As 2h 3d 4c 5h')),[4,5]);
  assert.deepEqual(evaluate(c('As Ah Ad Ks Kh Kd 2c')),[6,14,13]);
  assert.deepEqual(evaluate(c('As Ks Qs Js Ts 2h 3d')),[8,14]);
  assert.equal(compare(evaluate(c('As Ah Kc Qd 9h')),evaluate(c('Ad Ac Ks Qh 8c'))),1);
});
test('shuffle has 52 unique cards',()=>{
  const d=deck();assert.equal(d.length,52);assert.equal(new Set(d.map(x=>x.r+x.s)).size,52);
});
test('heads up dealer SB acts first preflop and last postflop',()=>{
  const t=setup([10000,10000]);t.start();assert.equal(t.dealer,0);assert.equal(t.smallSeat,0);assert.equal(t.bigSeat,1);assert.equal(t.turn,0);
  act(t,'call');assert.equal(t.turn,1);act(t,'check');assert.equal(t.phase,'flop');assert.equal(t.turn,1);
  act(t,'check');act(t,'check');assert.equal(t.phase,'turn');assert.equal(t.turn,1);
});
test('BB has option and min raise rejects too small raise without changing chips',()=>{
  const t=setup();t.start();act(t,'call');act(t,'call');assert.equal(t.turn,t.bigSeat);assert.equal(t.phase,'preflop');
  const before=total(t);assert.throws(()=>act(t,'raise',150),/최소/);assert.equal(total(t),before);
  act(t,'raise',300);assert.equal(t.minRaise,200);assert.equal(t.legal(t.seats[t.turn].id).min,500);
});
test('short all-in does not reopen raise for prior caller',()=>{
  const t=setup([10000,150,10000]);t.start();act(t,'call'); // dealer calls 100
  act(t,'allin'); // SB raises to 150 (short)
  act(t,'call'); // BB
  assert.equal(t.turn,0);assert.equal(t.legal('0').canRaise,false);
  assert.throws(()=>act(t,'raise',250),/다시 레이즈/);act(t,'call');assert.equal(t.phase,'flop');
});
test('cumulative short all-ins reopen action',()=>{
  const t=setup([10000,150,200,10000]);t.start(); // UTG seat3
  act(t,'call');act(t,'call'); // seat3 and dealer
  act(t,'allin');act(t,'allin'); // SB 150 BB 200
  assert.equal(t.turn,3);assert.equal(t.legal('3').canRaise,true);assert.equal(t.legal('3').min,300);
});
test('unequal all-ins main/side pot and unmatched refund',()=>{
  const t=setup([100,200,300]);t.phase='river';t.handNo=1;t.dealer=0;t.board=c('2s 3h 7d 8c 9h');
  const holes=['As Ah','Ks Kh','Qs Qh'];
  t.seats.filter(Boolean).forEach((p,i)=>Object.assign(p,{inHand:true,chips:0,total:[100,200,300][i],cards:c(holes[i]),allIn:true}));
  t.finish(true);
  assert.deepEqual(t.seats.filter(Boolean).map(p=>p.chips),[300,200,100]);assert.equal(t.result.pots.length,2);assert.equal(t.result.returned[0].amount,100);assert.equal(total(t),600);
});
test('board tie splits side pots and odd chip goes left of button',()=>{
  const t=setup([11,11,11]);t.phase='river';t.dealer=0;t.board=c('As Ks Qs Js Ts');
  t.seats.filter(Boolean).forEach((p,i)=>Object.assign(p,{inHand:true,chips:0,total:11,folded:i===2,cards:c(['2c 3c','4d 5d','6h 7h'][i])}));
  t.finish(true);assert.deepEqual(t.seats.filter(Boolean).map(p=>p.chips),[16,17,0]);
});
test('fold win does not disclose cards; showdown does not disclose folded cards',()=>{
  const t=setup();t.start();const mine=t.view('0');assert.ok(mine.seats[0].cards.every(Boolean));assert.ok(mine.seats[1].cards.every(x=>x===null));
  act(t,'fold');act(t,'fold');assert.equal(t.phase,'finished');assert.equal(t.result.showdown,false);assert.ok(t.view('0').seats[2].cards.every(x=>x===null));
});
test('cancel refunds bets, no stale/double actions, reseating preserves chips',()=>{
  const t=setup();t.start();const initial=total(t),v=t.version;
  const id=t.seats[t.turn].id;act(t,'call');assert.throws(()=>t.act(id,'call',0,t.handNo,v),/변경/);
  t.cancel();assert.equal(total(t),initial);assert.deepEqual(t.seats.filter(Boolean).map(p=>p.chips),[10000,10000,10000]);
  t.seats[0].chips=7000;t.leave('0');t.sit('0','선수0',8,10000);assert.equal(t.player('0').chips,7000);
});
test('timeout checks free action and marks away; turn with call requirement folds',()=>{
  const t=setup();t.start();t.deadline=0;t.timeout();assert.equal(t.player('0').folded,true);assert.equal(t.player('0').away,true);
  act(t,'call');act(t,'check');t.deadline=0;const id=t.seats[t.turn].id;t.timeout();assert.equal(t.player(id).action,'체크');
});
test('500 simulated hands keep all chips, terminate, and never leak other hole cards',()=>{
  for(let n=0;n<500;n++) {
    const stacks=Array.from({length:2+n%9},(_,i)=>20+(n*73+i*41)%1000);
    const t=setup(stacks);t.start();const initial=stacks.reduce((a,b)=>a+b,0);let steps=0;
    while(t.playing&&steps++<300) {
      assert.equal(total(t),initial);
      const id=t.seats[t.turn].id,l=t.legal(id),view=t.view(id);
      for(const p of view.seats.filter(Boolean))if(p.id!==id)assert.ok(p.cards.every(x=>x===null));
      const pick=(n+steps*17)%11;
      if(pick===0)act(t,'fold');else if(pick===1&&l.canRaise)act(t,'allin');
      else if(pick===2&&l.canRaise&&l.max>=l.min)act(t,'raise',l.min);
      else act(t,l.check?'check':'call');
    }
    assert.equal(t.phase,'finished');assert.ok(steps<300);assert.equal(total(t),initial);
    assert.ok(t.seats.filter(Boolean).every(p=>p.chips>=0));
  }
});
