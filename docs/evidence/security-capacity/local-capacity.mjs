/** Run via node --import tsx; local-only, source-selected isolated HTTP/WS runtime. */
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import os from 'node:os';
const source = process.env.CAPACITY_SOURCE ?? process.cwd();
const port = Number(process.env.PORT ?? 8082);
process.env.PUBLIC_ORIGIN = `http://127.0.0.1:${port}`;
process.env.ANALYTICS = 'off';
// A local harness puts every simulated house behind a single IP. Keep gameplay
// quotas, global socket/room caps and lifecycle intact; enlarge only coarse NAT
// admission ceilings so the experiment can reach those caps.
for (const key of ['RATE_LIMIT_SESSION_IP_LIMIT','RATE_LIMIT_CONNECTION_IP_LIMIT','RATE_LIMIT_ROOM_CREATION_IP_LIMIT']) process.env[key]='10000';
process.env.MAX_SOCKETS_PER_IP='4000';
const { createGameServer } = await import(pathToFileURL(`${source}/server/src/index.ts`));
const runtime = createGameServer();
runtime.server.listen(port,'127.0.0.1'); await once(runtime.server,'listening');
const base = `http://127.0.0.1:${port}`;
const sockets=[]; const groups=[]; let seq=0;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const histogram=monitorEventLoopDelay({resolution:10}); histogram.enable();
const percentile=(a,p)=>a.slice().sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor(a.length*p))] ?? 0;
const quantiles=a=>({n:a.length,p50Ms:+percentile(a,.5).toFixed(2),p95Ms:+percentile(a,.95).toFixed(2),p99Ms:+percentile(a,.99).toFixed(2),maxMs:+Math.max(0,...a).toFixed(2)});
class Client {
  constructor(){this.pending=[];this.view=null;this.code=null;this.frames=0;}
  wait(predicate,timeout=10000){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending=this.pending.filter(x=>x!==entry);reject(Error('message timeout'));},timeout);const entry={predicate,resolve:m=>{clearTimeout(timer);resolve(m)}};this.pending.push(entry);});}
  async connect(){if(!this.cookie){const res=await fetch(`${base}/api/session`);assert.equal(res.status,200);this.cookie=res.headers.get('set-cookie').split(';')[0];}this.ws=new WebSocket(`ws://127.0.0.1:${port}/ws`,{headers:{Cookie:this.cookie,Origin:base}});sockets.push(this.ws);this.ws.on('message',data=>{const m=JSON.parse(data.toString());this.frames++;if(m.t==='STATE'){this.view=m.view;if(this.code)assert.equal(m.view.room.code,this.code,'cross-room STATE');}for(const p of [...this.pending])if(p.predicate(m)){this.pending.splice(this.pending.indexOf(p),1);p.resolve(m);}});await once(this.ws,'open');const hello=this.wait(m=>m.t==='HELLO_OK'||m.t==='STATE');this.ws.send(JSON.stringify({t:'HELLO',protocolVersion:2}));const m=await hello;this.uid=m.t==='STATE'?m.view.self.uid:m.uid;}
  async action(message){const rid=`load_${++seq}`;const ready=this.wait(m=>(m.t==='ACK'||m.t==='ERROR')&&m.rid===rid);this.ws.send(JSON.stringify({...message,rid}));const reply=await ready;assert.equal(reply.t,'ACK',JSON.stringify(reply));}
  async ping(){const sampleId=`ping_${++seq}`;const start=performance.now();const ready=this.wait(m=>m.t==='PONG'&&m.sampleId===sampleId);this.ws.send(JSON.stringify({t:'PING',sampleId,clientMonoMs:start}));await ready;return performance.now()-start;}
}
async function createGroup(i){const clients=[new Client(),new Client(),new Client()];await Promise.all(clients.map(c=>c.connect()));await clients[0].action({t:'CREATE_ROOM',name:`مالك${i}`});const code=clients[0].view.room.code;for(const c of clients)c.code=code;await Promise.all(clients.slice(1).map((c,j)=>c.action({t:'JOIN_ROOM',code,name:`لاعب${j+1}`})));const states=clients.map(c=>c.wait(m=>m.t==='STATE'&&m.view.room.phase==='QUESTION'));await clients[0].action({t:'START_GAME'});await Promise.all(states);assert.equal(clients.filter(c=>c.view.isImpostor).length,1);const impostor=clients.find(c=>c.view.isImpostor);assert.equal(impostor.view.myPrompt,undefined);assert.equal(impostor.view.publicPrompt,undefined);assert.equal(clients.filter(c=>!c.view.isImpostor&&c.view.myPrompt).length,2);return {code,clients};}
const rows=[];
try {
  console.log(JSON.stringify({type:'environment',label:process.env.LABEL,node:process.version,os:os.platform(),cpuModel:os.cpus()[0]?.model,logicalCpus:os.cpus().length,memoryGiB:+(os.totalmem()/2**30).toFixed(2),port,source,overrides:{coarseIpAdmission:10000,maxSocketsPerIp:4000},timers:'shipped values',network:'loopback',sharedRunner:true}));
  for(const tier of [1,5,20,50,100,250,500]){
    histogram.reset();const cpuBefore=process.cpuUsage();const begin=performance.now();
    while(groups.length<tier){const batch=Math.min(5,tier-groups.length);const next=await Promise.all(Array.from({length:batch},(_,i)=>createGroup(groups.length+i)));groups.push(...next);}
    const convergence=[];
    // Reconnect one participant in each party concurrently. Remaining clients
    // must observe disconnected and then connected, and the recovering client
    // must receive the same room's authoritative private QUESTION state.
    for(let trial=0;trial<2;trial++){await Promise.all(groups.map(async g=>{const recovering=g.clients[2];const left=g.clients.slice(0,2).map(c=>c.wait(m=>m.t==='STATE'&&m.view.players.find(p=>p.uid===recovering.uid)?.connected===false));const closed=once(recovering.ws,'close');recovering.ws.close();await closed;await Promise.all(left);const start=performance.now();const back=g.clients.map(c=>c.wait(m=>m.t==='STATE'&&m.view.players.find(p=>p.uid===recovering.uid)?.connected===true));await recovering.connect();await Promise.all(back);assert.equal(recovering.view.room.code,g.code);convergence.push(performance.now()-start);}));await delay(25);}
    const sampleClients=groups.filter((_,i)=>i%Math.max(1,Math.floor(groups.length/20))===0).flatMap(g=>g.clients).slice(0,60);
    const pings=[];for(let round=0;round<4;round++){pings.push(...await Promise.all(sampleClients.map(c=>c.ping())));await delay(25);}
    await delay(100);const cpu=process.cpuUsage(cpuBefore);const memory=process.memoryUsage();const elapsed=performance.now()-begin;
    const row={type:'tier',label:process.env.LABEL,rooms:runtime.manager.roomCount,sockets:runtime.capacity.active,elapsedMs:+elapsed.toFixed(2),cpuMs:+((cpu.user+cpu.system)/1000).toFixed(2),rssMiB:+(memory.rss/2**20).toFixed(2),heapMiB:+(memory.heapUsed/2**20).toFixed(2),eventLoopP95Ms:+(histogram.percentile(95)/1e6).toFixed(2),eventLoopMaxMs:+(histogram.max/1e6).toFixed(2),rtt:quantiles(pings),broadcastConvergence:quantiles(convergence),errors:0,crossRoomStates:0,privacy:'one impostor receives no prompt; two normals receive private prompts per room'};rows.push(row);console.log(JSON.stringify(row));
  }
  // At shipped room ceiling, existing parties remain usable while admission
  // fails predictably. Use a fresh identity, not a rate-limited existing owner.
  const overflow=new Client();await overflow.connect();const rid=`overflow_${++seq}`;const result=overflow.wait(m=>(m.t==='ACK'||m.t==='ERROR')&&m.rid===rid);overflow.ws.send(JSON.stringify({t:'CREATE_ROOM',name:'فوقالحد',rid}));const reply=await result;assert.equal(reply.t,'ERROR');assert.equal(reply.code,'RATE_LIMITED');console.log(JSON.stringify({type:'ceiling',roomCeiling:500,rejection:reply.code,existingRttMs:+(await groups[0].clients[0].ping()).toFixed(2)}));
  await Promise.all(groups.map(g=>g.clients[0].action({t:'CLOSE_ROOM'})));for(const ws of sockets)ws.close();const end=performance.now()+5000;while(runtime.capacity.active>0&&performance.now()<end)await delay(10);assert.equal(runtime.manager.roomCount,0);assert.equal(runtime.capacity.active,0);console.log(JSON.stringify({type:'cleanup',rooms:runtime.manager.roomCount,sockets:runtime.capacity.active,requestCache:'bounded by code at 5000 identities * 128 IDs; max five-minute expiry; tested separately',rssMiB:+(process.memoryUsage().rss/2**20).toFixed(2)}));
} catch(error){console.log(JSON.stringify({type:'failure',message:error.stack,rooms:runtime.manager.roomCount,sockets:runtime.capacity.active}));process.exitCode=1;} finally {histogram.disable();runtime.dispose();await new Promise(r=>runtime.server.close(r));}
