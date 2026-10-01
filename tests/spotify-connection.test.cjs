const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
const { webcrypto } = require('node:crypto');

function fixture(profileOk = true) {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL); CREATE TABLE votes(id INTEGER); CREATE TABLE suggestions(id INTEGER); CREATE TABLE reactions(id INTEGER); INSERT INTO votes VALUES(1); INSERT INTO suggestions VALUES(1); INSERT INTO reactions VALUES(1)");
  const initial = { spotify_connection_id: 'old-connection', spotify_access_token: 'old-access', spotify_refresh_token: 'old-refresh', party_access_seed: 'old-party', party_playback_plan_v1: 'old-plan', spotify_playback_cache_v2: 'old-cache' };
  for (const [key, value] of Object.entries(initial)) db.prepare('INSERT INTO settings VALUES (?, ?, 0)').run(key, value);
  let failBatch = false, networkCalls = 0;
  const binding = {
    prepare(sql) { let args = []; return { bind(...values) { args = values; return this; }, run() { return { meta: { changes: Number(db.prepare(sql).run(...args).changes) } }; } }; },
    async batch(statements) {
      db.exec('BEGIN');
      try { const results = statements.map((statement, i) => { if (failBatch && i === 2) throw Error('Simulated storage failure'); return statement.run(); }); db.exec('COMMIT'); return results; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
  const cache = new Map();
  const overrides = { 'cloudflare:workers': { env: { DB: binding } }, '@/lib/spotify': { assertAdmin(code) { if(code !== 'admin') throw Error('Wrong admin'); }, apiError(error, status) { return Response.json({ error: error.message }, { status }); } } };
  function load(name) {
    if (name in overrides) return overrides[name];
    if (cache.has(name)) return cache.get(name);
    const file = path.join(__dirname, '..', name.slice(2) + '.ts');
    const exports = {}; cache.set(name, exports);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { exports, require: load, crypto: webcrypto, process: { env: { ADMIN_CODE: 'admin' } }, TextEncoder, TextDecoder, Uint8Array, btoa, atob, Request, Response, AbortSignal, fetch: async () => { networkCalls++; return Response.json(profileOk ? {id:'new-user',display_name:'New user'} : {error:'Rejected'}, {status:profileOk ? 200 : 401}); } }, {filename:file});
    return exports;
  }
  return { db, load, get: key => db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value, count: table => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, networkCalls: () => networkCalls, fail: () => {failBatch = true;}, close: () => db.close(), post: body => load('@/app/api/host/setup/route').POST(new Request('https://site.test/api/host/setup', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({adminCode:'admin',clientId:'new-client',access_token:'new-access',refresh_token:'new-refresh',expires_in:3600,...body})})) };
}

test('wrong admin and missing tokens cannot replace the connection or clear the party', async () => {
  for (const body of [{adminCode:'wrong',newParty:true},{access_token:'',newParty:true}]) {
    const f=fixture(); assert.equal((await f.post(body)).status,401); assert.equal(f.networkCalls(),0); assert.equal(f.get('spotify_access_token'),'old-access'); assert.equal(f.count('votes'),1); f.close();
  }
});
test('Spotify rejection preserves old account and party', async () => {
  const f=fixture(false); assert.equal((await f.post({newParty:true})).status,401); assert.equal(f.get('spotify_refresh_token'),'old-refresh'); assert.equal(f.get('party_access_seed'),'old-party'); assert.equal(f.count('votes'),1); f.close();
});
test('reconnect stores encrypted tokens and preserves party unless explicitly requested', async () => {
  const f=fixture(); assert.equal((await f.post({})).status,200);
  assert.equal(await f.load('@/lib/secure-settings').decryptSetting(f.get('spotify_access_token')),'new-access');
  assert.match(f.get('spotify_refresh_token'),/^enc:v1:/); assert.equal(f.get('party_access_seed'),'old-party'); assert.equal(f.count('votes'),1); assert.equal(f.get('party_playback_plan_v1'),''); assert.equal(f.get('spotify_playback_cache_v2'),''); f.close();
});
test('explicit fresh party atomically clears requests and rotates guest access', async () => {
  const f=fixture(); assert.equal((await f.post({newParty:true})).status,200); assert.notEqual(f.get('party_access_seed'),'old-party'); for(const table of ['votes','suggestions','reactions']) assert.equal(f.count(table),0); f.close();
});
test('storage failure rolls back both credentials and party changes', async () => {
  const f=fixture(); f.fail(); assert.equal((await f.post({newParty:true})).status,401); assert.equal(f.get('spotify_access_token'),'old-access'); assert.equal(f.get('party_access_seed'),'old-party'); assert.equal(f.count('votes'),1); f.close();
});
test('late old-account refresh cannot overwrite new account', async () => {
  const f=fixture(); assert.equal((await f.post({})).status,200); const value=f.get('spotify_access_token');
  await assert.rejects(f.load('@/lib/spotify-connection').saveRefreshedSpotifyTokens({spotify_access_token:'stale-token'},'old-connection'),/gewijzigd/);
  assert.equal(f.get('spotify_access_token'),value);
  await f.load('@/lib/spotify-connection').saveRefreshedSpotifyTokens({spotify_access_token:'valid-refresh'},f.get('spotify_connection_id'));
  assert.equal(f.get('spotify_access_token'),'valid-refresh'); f.close();
});
