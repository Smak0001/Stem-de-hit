const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const ts = require('typescript');

// Execute the actual effect, not a separate copy of the transition logic.
const source = readFileSync('app/party-app.tsx', 'utf8');
const start = source.indexOf('    if (!hostMode || !autoDj || !autoDjLeader || !adminCode');
const end = source.indexOf('  // Auto-DJ reacts', start);
assert.ok(start >= 0 && end > start);
const effect = new vm.Script(`(function () { ${source.slice(start, end)} })()`);
function scenario() {
  const calls = [];
  const notices = [];
  let now = 100_000;
  const state = {
    hostMode: true, autoDj: true, autoDjLeader: true, adminCode: 'test-only',
    autoDjBusy: { current: false }, inactivePolls: { current: 0 },
    triggeredFor: { current: 'old' }, lastPlaybackId: { current: 'old' },
    expectedPlayback: { current: { spotifyId: 'winner', itemId: 7, until: 102_000, normalizeOnStart: false, recoveryAttempts: 0 } },
    playback: { active: true, isPlaying: false, progressMs: 180_000, item: { spotifyId: 'old', durationMs: 180_000 } },
    topTrack: { id: 8 }, Date: { now: () => now },
    playNext: (...args) => { calls.push(args); state.autoDjBusy.current = true; },
    setNotice: text => notices.push(text),
  };
  const context = vm.createContext(state);
  return { state, calls, notices, run: () => effect.runInContext(context), time: value => { now = value; } };
}

test('new requests during countdown keep the reserved winner; ended track recovers once', () => {
  const s = scenario();
  s.state.playback.isPlaying = true;
  s.state.playback.progressMs = 174_000;
  for (let id = 8; id < 18; id++) { s.state.topTrack = { id }; s.run(); }
  assert.equal(s.calls.length, 0);
  s.state.playback.isPlaying = false;
  s.state.playback.progressMs = 180_000;
  s.time(102_001); s.run();
  assert.deepEqual(s.calls, [[7, true, true, true, true]]);
  assert.equal(s.state.expectedPlayback.current.spotifyId, 'winner');
  for (let id = 18; id < 30; id++) { s.state.topTrack = { id }; s.run(); }
  assert.equal(s.calls.length, 1);
});

test('recovery also works with no remaining candidates', () => {
  const s = scenario(); s.state.topTrack = null; s.time(103_000); s.run();
  assert.equal(s.calls[0][0], 7);
});

test('playing winner confirms transition; next candidate is not started immediately', () => {
  const s = scenario();
  s.state.playback = { active: true, isPlaying: true, progressMs: 1000, item: { spotifyId: 'winner', durationMs: 200_000 } };
  s.run(); s.run();
  assert.equal(s.state.expectedPlayback.current, null);
  assert.equal(s.calls.length, 0);
});

test('timeout does not skip playing music or resume a mid-track pause', () => {
  for (const isPlaying of [true, false]) {
    const s = scenario(); s.time(200_000);
    s.state.playback.isPlaying = isPlaying; s.state.playback.progressMs = 90_000;
    s.run(); assert.equal(s.calls.length, 0);
    assert.equal(s.state.expectedPlayback.current.spotifyId, 'winner');
  }
});

test('temporarily unavailable playback waits for deadline and remains bounded', () => {
  const s = scenario(); s.state.playback = { active: false };
  s.run(); s.run(); assert.equal(s.calls.length, 0);
  s.time(103_000); s.run(); assert.equal(s.calls.length, 1);
  s.state.autoDjBusy.current = false; s.run(); assert.equal(s.calls.length, 1);
  s.time(114_000); s.run(); assert.equal(s.calls.length, 2);
  s.state.autoDjBusy.current = false; s.time(125_000);
  s.run(); s.run();
  assert.equal(s.calls.length, 2); assert.equal(s.notices.length, 1);
  assert.equal(s.state.expectedPlayback.current.spotifyId, 'winner');
});

test('in-flight command cannot lose pending winner; confirmation never restarts it', () => {
  const s = scenario(); s.state.autoDjBusy.current = true;
  s.state.playback.item.spotifyId = 'winner'; s.state.playback.isPlaying = true;
  s.state.expectedPlayback.current.normalizeOnStart = true;
  s.run(); assert.ok(s.state.expectedPlayback.current); assert.equal(s.calls.length, 0);
  s.state.autoDjBusy.current = false; s.run(); s.run(); assert.equal(s.calls.length, 0);
  assert.equal(s.state.expectedPlayback.current, null);
});

function routeHarness(current, overrides = {}) {
  const requests = [];
  const track = { id: 7, status: 'queued', uri: 'spotify:track:winner', name: 'Winner' };
  const compiled = ts.transpileModule(readFileSync('app/api/host/play-next/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const mocks = {
    '@/db/repository': { getTrack: async () => track, markQueued: async () => {}, getTopCandidate: async () => track },
    '@/lib/spotify': {
      assertAdmin: () => {}, apiError: e => Response.json({ error: e.message }, { status: 503 }),
      spotifyFetch: async (path, init) => {
        requests.push({ path, init });
        if (path === '/me/player?additional_types=track') { if (current instanceof Error) throw current; return current; }
        if (path === '/me/player/queue') return { queue: [{ uri: track.uri }, { uri: 'spotify:track:later' }] };
        return null;
      },
    },
  };
  new Function('require', 'exports', compiled)(name => mocks[name], exports);
  return { requests, run: () => exports.POST(new Request('http://localhost/api/host/play-next', {
    method: 'POST', body: JSON.stringify({ adminCode: 'test-only', itemId: 7, recover: true, ensureStarted: true, ...overrides }),
  })) };
}

test('server rechecks playback and never restarts a winner that already plays', async () => {
  const s = routeHarness({ is_playing: true, item: { uri: 'spotify:track:winner' } });
  const response = await s.run();
  assert.equal((await response.json()).strategy, 'already-playing');
  assert.equal(s.requests.length, 1);
});

test('ended track recovers the reserved winner without duplicating it in the sequence', async () => {
  const s = routeHarness({ is_playing: false, item: { uri: 'spotify:track:old' } });
  assert.equal((await s.run()).status, 200);
  const play = s.requests.find(r => r.init?.method === 'PUT');
  assert.deepEqual(JSON.parse(play.init.body).uris, ['spotify:track:winner', 'spotify:track:later']);
});

test('failed confirmation does not issue a blind playback command', async () => {
  const s = routeHarness(new Error('temporary Spotify error'));
  assert.equal((await s.run()).status, 503);
  assert.equal(s.requests.length, 1);
});

test('old host tabs cannot normalize/restart the current winner either', async () => {
  for (const is_playing of [true, false]) {
    const s = routeHarness({ is_playing, item: { uri: 'spotify:track:winner' } }, { ensureStarted: false });
    const data = await (await s.run()).json();
    assert.equal(data.played, is_playing);
    assert.equal(data.normalizeOnStart, false);
    assert.equal(s.requests.length, 1);
  }
});

test('crossfade confirmation with duplicate flag sends no new playback command', () => {
  const s = scenario();
  s.state.expectedPlayback.current.normalizeOnStart = true;
  s.state.playback = { active: true, isPlaying: true, progressMs: 0, item: { spotifyId: 'winner', durationMs: 200_000 } };
  s.run();
  for (let id = 8; id < 18; id++) { s.state.topTrack = { id }; s.run(); }
  assert.equal(s.calls.length, 0);
  assert.equal(s.state.expectedPlayback.current, null);
});
