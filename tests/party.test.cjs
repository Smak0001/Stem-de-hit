const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');

// Load actual application modules without Worker bindings or external network.
function modules(overrides = {}, globals = {}) {
  const cache = new Map();
  function load(name) {
    if (name in overrides) return overrides[name];
    if (!name.startsWith('@/')) return require(name);
    const file = path.join(root, name.slice(2)) + (fs.existsSync(path.join(root, name.slice(2)) + '.ts') ? '.ts' : '.tsx');
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    vm.runInNewContext(code, { exports, require: load, Request, Response, URL, URLSearchParams, TextEncoder, crypto: webcrypto, btoa, AbortSignal, console, process: { env: { ADMIN_CODE: 'test-admin' } }, fetch: () => { throw Error('Unexpected network'); }, ...globals }, { filename: file });
    return exports;
  }
  return load;
}

function storage() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)');
  function prepare(sql) {
    let args = [];
    return { bind(...values) { args = values; return this; },
      async first() { return db.prepare(sql).get(...args) || null; },
      async all() { return { results: db.prepare(sql).all(...args) }; },
      async run() { return { meta: { changes: Number(db.prepare(sql).run(...args).changes) } }; }
    };
  }
  const load = modules({ 'cloudflare:workers': { env: { DB: { prepare, batch: async statements => Promise.all(statements.map(s => s.run())) } } } });
  return { repo: load('@/db/repository'), close: () => db.close() };
}

class SpotifyError extends Error { constructor(message, status = 503, retryAfter = 5) { super(message); this.status = status; this.retryAfter = retryAfter; } }
const uri = id => `spotify:track:${id}`;
const track = id => ({ id, uri: uri(id), name: id, duration_ms: 180000 });
const plain = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const store = storage();
  let now = 1_800_000_000_000;
  class Clock extends Date { static now() { return now; } }
  const calls = [];
  let candidate = { id: 1, uri: uri('B'), name: 'B', status: 'candidate' };
  let snapshot = { playback: { item: track('A'), device: { id: 'laptop' }, is_playing: true, progress_ms: 50000 }, queue: [track('B'), track('C')], sampledAt: now, stale: false, retryAt: now + 1000 };
  let handler = async () => null;
  const repo = { ...store.repo, getTopCandidate: async () => candidate?.status === 'candidate' ? candidate : null, getTrack: async () => candidate, markQueued: async () => { if(candidate) candidate.status = 'queued'; } };
  const load = modules({ '@/db/repository': repo,
    '@/lib/playback': { getPlaybackSnapshot: async () => snapshot, invalidatePlayback: async () => {} },
    '@/lib/spotify': { SpotifyError, assertAdmin: code => { if(code !== 'test-admin') throw Error('Unauthorized'); }, apiError: e => Response.json({error:e.message},{status:e.status || 400}), spotifyFetch: async (p, init) => { calls.push({path:p, ...init, body:init?.body ? JSON.parse(init.body) : undefined}); return handler(p, init); } }
  }, { Date: Clock });
  return { ...store, repo, load, calls, snapshot, setCandidate: c => {candidate=c;}, setHandler: fn => {handler=fn;}, tick: ms => {now+=ms; snapshot.sampledAt=now;}, post: body => load('@/app/api/host/play-next/route').POST(new Request('https://test/api/host/play-next',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({adminCode:'test-admin',...body})})) };
}

test('atomic lease: different Worker owners cannot overlap or release each other', async () => {
  const s=storage();
  assert.equal(await s.repo.acquireLease('lock','one',10000),true);
  assert.equal(await s.repo.acquireLease('lock','two',10000),false);
  await s.repo.releaseLease('lock','two');
  assert.equal(await s.repo.acquireLease('lock','two',10000),false);
  await s.repo.releaseLease('lock','one');
  assert.equal(await s.repo.acquireLease('lock','two',10000),true); s.close();
});

test('winner is removed from continuation; complete playlist beyond Spotify snapshot is retained', async () => {
  const f=fixture(); f.snapshot.playback.context={uri:'spotify:playlist:source'};
  f.snapshot.queue=[track('C'),track('B')];
  const source=['A','C','B',...Array.from({length:130},(_,i)=>`tail${i}`)];
  f.setHandler(async (p, init) => { if(init) return null; const offset=Number(new URL('https://spotify'+p).searchParams.get('offset')); return { items:source.slice(offset,offset+50).map(id=>({item:track(id)})),next:offset+50<source.length?'next':null }; });
  assert.equal((await f.post({itemId:1,commandId:'one'})).status,200);
  const put=f.calls.find(c=>c.method==='PUT');
  assert.equal(put.body.uris.length,100);
  assert.deepEqual(put.body.uris.slice(0,3),[uri('B'),uri('C'),uri('tail0')]);
  const plan=await f.load('@/lib/party-queue').getQueuePlan();
  assert.equal(plan.uris.length,132); assert.equal(plan.uris.at(-1),uri('tail129'));
  assert.equal(plan.uris.filter(u=>u===uri('B')).length,1); f.close();
});

test('already playing winner is acknowledged without any Spotify mutation', async () => {
  const f=fixture(); f.snapshot.playback.item=track('B'); f.snapshot.playback.progress_ms=1500;
  assert.equal((await f.post({itemId:1})).status,200); assert.equal(f.calls.length,0); f.close();
});

test('stale/missing queue or unavailable device cannot trigger playback', async () => {
  for(const patch of [{stale:true},{playback:null}]) {
    const f=fixture(); Object.assign(f.snapshot,patch);
    assert.notEqual((await f.post({itemId:1})).status,200); assert.equal(f.calls.length,0); f.close();
  }
});

test('playlist read failure fails closed, without winner-only replacement', async () => {
  const f=fixture(); f.snapshot.playback.context={uri:'spotify:playlist:private'};
  f.setHandler(async ()=>{throw new SpotifyError('Forbidden',403);});
  const response=await f.post({itemId:1}); assert.notEqual(response.status,200);
  assert.match((await response.json()).error,/opnieuw/); assert.equal(f.calls.filter(c=>c.method==='PUT').length,0); f.close();
});

test('duplicate command delivery and second host do not restart or skip winner', async () => {
  const f=fixture(); f.snapshot.playback.progress_ms=179900;
  assert.equal((await f.post({automatic:true,afterTrack:uri('A'),commandId:'one'})).status,200);
  f.tick(1000); f.snapshot.playback.item=track('B'); f.snapshot.playback.progress_ms=500;
  f.setCandidate({id:2,uri:uri('C'),name:'C',status:'candidate'});
  await f.post({automatic:true,afterTrack:uri('A'),commandId:'two'});
  await f.post({automatic:true,afterTrack:uri('A'),commandId:'one'});
  assert.equal(f.calls.filter(c=>c.method==='PUT').length,1); f.close();
});

test('uncertain write is persisted and not blindly retried', async () => {
  const f=fixture(); f.setHandler(async ()=>{throw Error('network timeout');});
  await f.post({itemId:1,commandId:'one'}); await f.post({itemId:1,commandId:'one'});
  assert.equal(f.calls.filter(c=>c.method==='PUT').length,1);
  assert.equal((await f.load('@/lib/party-queue').getQueuePlan()).confirmed,false); f.close();
});

test('managed batch tail starts only after confirmed end, even without guest requests', async () => {
  const f=fixture(); const queue=f.load('@/lib/party-queue');
  await queue.startSequence(Array.from({length:120},(_,i)=>uri(String(i))),'laptop',null,'initial',uri('old'));
  f.tick(40000); f.snapshot.playback.item=track('99'); f.snapshot.playback.is_playing=false; f.snapshot.playback.progress_ms=180000;
  f.setCandidate(null);
  const response=await f.post({automatic:true,afterTrack:uri('99'),commandId:'tail'});
  assert.equal(response.status,200);
  assert.deepEqual(f.calls.at(-1).body.uris,Array.from({length:20},(_,i)=>uri(String(i+100)))); f.close();
});

test('Auto-DJ ignores stale/inactive playback, early votes, ordinary pauses and reconnects', () => {
  const {autoDjDecision}=modules()('@/lib/auto-dj'); const now=Date.now();
  const sample={active:true,isPlaying:true,sampledAt:now,item:{uri:uri('A'),durationMs:180000},progressMs:170000};
  const previous={uri:uri('A'),remaining:1000,sampledAt:now,isPlaying:true};
  for(const patch of [{active:false},{stale:true},{progressMs:120000},{isPlaying:false,progressMs:120000},{sampledAt:now-10000}]) assert.equal(autoDjDecision({...sample,...patch},previous,now,true).afterTrack,null);
  assert.equal(autoDjDecision({...sample,item:{uri:uri('B'),durationMs:180000},progressMs:100},null,now,true).afterTrack,null);
  assert.equal(autoDjDecision({...sample,progressMs:179900},previous,now,true).afterTrack,uri('A'));
  assert.equal(autoDjDecision({...sample,item:{uri:uri('B'),durationMs:180000},progressMs:100},previous,now,true).afterTrack,uri('A'));
});

test('Top 5 fills 0–5 candidates with deduplicated Spotify songs', () => {
  const {fillPartyQueue}=modules()('@/lib/auto-dj');
  const tracks=Array.from({length:8},(_,i)=>({spotifyId:String(i)}));
  for(let count=0;count<=5;count++) {
    const result=fillPartyQueue(tracks.slice(0,count),tracks);
    assert.equal(result.length,5); assert.equal(new Set(result.map(t=>t.spotifyId)).size,5);
    assert.deepEqual(plain(result),tracks.slice(0,5));
  }
});

test('cache collapses concurrent requests across module instances and retains last good data on failure', async () => {
  const s=storage(); let calls=0,fail=false;
  const overrides={'@/db/repository':s.repo,'@/lib/spotify':{SpotifyError,spotifyFetch:async p=>{calls++;if(fail)throw Error('offline');return p.includes('/queue')?{queue:[track('B')]}:{item:track('A'),device:{id:'laptop'}};}}};
  const first=modules(overrides)('@/lib/playback'); const second=modules(overrides)('@/lib/playback');
  const responses=await Promise.allSettled(Array.from({length:50},(_,i)=>(i%2?first:second).getPlaybackSnapshot()));
  assert.equal(calls,2);assert.ok(responses.some(r=>r.status==='fulfilled'&&!r.value.stale));
  await second.getPlaybackSnapshot();assert.equal(calls,2);
  await first.invalidatePlayback();fail=true;
  const stale=await first.getPlaybackSnapshot();assert.equal(stale.stale,true);assert.equal(stale.playback.item.id,'A');
  const prior=calls;await second.getPlaybackSnapshot();assert.equal(calls,prior);s.close();
});

test('429 Retry-After is shared and blocks further Spotify calls', async () => {
  const s=storage(); let calls=0;
  await s.repo.setSettings({spotify_access_token:'access',spotify_refresh_token:'refresh',spotify_client_id:'client',spotify_expires_at:String(Date.now()+3600000)});
  const load=modules({'@/db/repository':s.repo,'@/lib/secure-settings':{decryptSetting:async v=>v,encryptSetting:async v=>v}}, {fetch:async()=>{calls++;return Response.json({error:{message:'limited',reason:'QUOTA_EXCEEDED'}},{status:429,headers:{'Retry-After':'120'}});}});
  const spotify=load('@/lib/spotify');
  await assert.rejects(spotify.spotifyFetch('/me/player'),e=>e.status===429&&e.retryAfter===120);
  await assert.rejects(spotify.spotifyFetch('/me/player'),e=>e.status===429);
  assert.equal(calls,1); s.close();
});

test('401 emits session-expired event; prior in-flight results cannot restore the old UI', async () => {
  const events=[]; let finish;
  const load=modules({}, {window:{dispatchEvent:e=>events.push(e.type)},Event,fetch:async p=> p==='/slow'?new Promise(resolve=>{finish=resolve;}):Response.json({error:'expired',code:'PARTY_ACCESS_REQUIRED'},{status:401})});
  const client=load('@/lib/client-api');
  const slow=client.jsonFetch('/slow');
  await assert.rejects(client.jsonFetch('/api/state'),e=>e.status===401);
  finish(Response.json({tracks:['old']})); await assert.rejects(slow,e=>e.status===409);
  assert.deepEqual(events,['party-access-expired']);
});

test('PartyRanking renders five rows and votes with one request plus Spotify fill', () => {
  const React=require('react'); const {renderToStaticMarkup}=require('react-dom/server');
  const {PartyRanking}=modules()('@/components/party-ranking');
  const entries=Array.from({length:6},(_,i)=>({spotifyId:String(i),name:`Song ${i}`,artist:'Artist',imageUrl:null}));
  const html=renderToStaticMarkup(React.createElement(PartyRanking,{candidates:[{...entries[0],id:1,votes:10}],queue:entries,flashId:null}));
  assert.equal((html.match(/<li /g)||[]).length,5); assert.match(html,/10 stemmen/);
});

test('playlist continuation does not replay earlier songs after an external queued request', () => {
  const f=fixture();
  const result=f.load('@/lib/party-queue').mergeContinuation(uri('external'),[uri('C'),uri('D')],['A','B','C','D','E'].map(uri),false);
  assert.deepEqual(plain(result),['C','D','E'].map(uri));
  assert.throws(()=>f.load('@/lib/party-queue').mergeContinuation(uri('external'),[],['A','B'].map(uri),false),/positie/); f.close();
});

test('late vote selects the current winner, not a winner reserved during preparation', async () => {
  const f=fixture(); f.snapshot.playback.progress_ms=168000;
  await f.post({prepare:true}); assert.equal(f.calls.length,0);
  f.setCandidate({id:2,uri:uri('C'),name:'C',status:'candidate'});
  f.snapshot.playback.progress_ms=179900;
  await f.post({automatic:true,afterTrack:uri('A'),commandId:'late'});
  assert.equal(f.calls.at(-1).body.uris[0],uri('C'));f.close();
});

test('confirmed rejection rolls back intent; lost acknowledgement is reconciled without replay', async () => {
  const f=fixture(); f.setHandler(async()=>{throw new SpotifyError('limited',429,120);});
  await f.post({itemId:1,commandId:'rejected'});
  assert.equal(await f.load('@/lib/party-queue').getQueuePlan(),null);
  f.setHandler(async()=>{throw Error('lost acknowledgement');});
  await f.post({itemId:1,commandId:'lost'});
  f.tick(1000);f.snapshot.playback.item=track('B');
  const before=f.calls.length;await f.post({itemId:1,commandId:'lost'});
  assert.equal(f.calls.length,before);
  assert.equal((await f.load('@/lib/party-queue').getQueuePlan()).confirmed,true);
  assert.equal(await f.repo.getTopCandidate(),null);f.close();
});

test('an early automatic call, wrong device or shuffle never modifies Spotify', async () => {
  for(const mode of ['early','device','shuffle']) {
    const f=fixture();
    if(mode==='shuffle'){f.snapshot.playback.context={uri:'spotify:playlist:source'};f.snapshot.playback.shuffle_state=true;}
    await f.post(mode==='early'?{automatic:true,afterTrack:uri('A')}:mode==='device'?{itemId:1,deviceId:'other'}:{itemId:1});
    assert.equal(f.calls.length,0);f.close();
  }
});

test('reset revokes a real signed guest cookie and retains a confirmed continuation', async () => {
  const s=storage();let resets=0;
  const load=modules({'@/db/repository':{...s.repo,resetParty:async()=>{resets++;}}});
  const access=load('@/lib/party-access');
  const code=await access.getCurrentPartyCode(); assert.match(code.code,/^\d{6}$/);
  const cookie=await access.createPartyAccessCookie();
  const request=new Request('https://test/',{headers:{cookie:cookie.split(';')[0]}});
  assert.equal(await access.hasPartyAccess(request),true);
  await s.repo.setSettings({party_playback_plan_v1:JSON.stringify({confirmed:true,uris:[uri('B'),uri('C')]})});
  const response=await load('@/app/api/host/reset/route').POST(new Request('https://test/api/host/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({adminCode:'test-admin'})}));
  assert.equal(response.status,200); assert.equal(resets,1);
  assert.equal(await access.hasPartyAccess(request),false);
  assert.ok(await s.repo.getSetting('party_playback_plan_v1'));s.close();
});

test('a shorter concurrent rate-limit response cannot shorten an existing backoff', async () => {
  const s=storage(); await s.repo.extendDeadline('spotify_retry_at',10000);await s.repo.extendDeadline('spotify_retry_at',1000);
  assert.equal(await s.repo.getSetting('spotify_retry_at'),'10000');s.close();
});
