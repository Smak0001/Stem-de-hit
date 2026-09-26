"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronUp, Copy, Headphones, Loader2, LockKeyhole, Music2, PartyPopper, Play, RotateCcw, Search, Settings2, Smartphone, Sparkles, Users, Volume2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

type Track = { id: number; spotifyId: string; uri: string; name: string; artist: string; album: string; imageUrl: string | null; durationMs: number; votes: number; hasVoted: boolean; status: string };
type SearchTrack = Omit<Track, "id" | "votes" | "hasVoted" | "status">;
type Device = { id: string; name: string; type: string; is_active: boolean };
type Playback = { active: boolean; isPlaying?: boolean; progressMs?: number; item?: SearchTrack; device?: { id: string; name: string; type: string } | null };

const getVoterId = () => {
  let value = localStorage.getItem("stem-de-hit-voter");
  if (!value) { value = crypto.randomUUID(); localStorage.setItem("stem-de-hit-voter", value); }
  return value;
};

// API responses are validated at their route boundary; callers consume the route-specific shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const jsonFetch = async (url: string, options?: RequestInit): Promise<any> => {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({})) as { error?: string } & Record<string, unknown>;
  if (!response.ok) throw new Error(data.error || "Er ging iets mis. Probeer het opnieuw.");
  return data;
};

function formatDuration(ms: number) {
  const minutes = Math.floor(ms / 60000);
  return `${minutes}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
}

export default function PartyApp() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [voterCount, setVoterCount] = useState(0);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchTrack[]>([]);
  const [searching, setSearching] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [notice, setNotice] = useState("");
  const [hostMode, setHostMode] = useState(false);
  const [showHost, setShowHost] = useState(false);
  const [adminCode, setAdminCode] = useState("");
  const [clientId, setClientId] = useState("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [shareUrl, setShareUrl] = useState("");
  const [playback, setPlayback] = useState<Playback>({ active: false });
  const [autoDj, setAutoDj] = useState(true);
  const triggeredFor = useRef("");
  const lastPlaybackId = useRef<string | null>(null);
  const autoDjBusy = useRef(false);
  const inactivePolls = useRef(0);
  const expectedPlayback = useRef<{ spotifyId: string; until: number } | null>(null);

  const refresh = useCallback(async () => {
    const data = await jsonFetch(`/api/state?voterId=${encodeURIComponent(getVoterId())}`);
    setTracks(data.tracks); setConfigured(data.configured); setVoterCount(Number(data.voterCount || 0));
  }, []);

  useEffect(() => {
    setHostMode(new URLSearchParams(location.search).get("host") === "1");
    setShareUrl(`${location.origin}/`);
    setAdminCode(localStorage.getItem("stem-de-hit-admin") || "");
    setAutoDj(localStorage.getItem("stem-de-hit-auto-dj") !== "false");
    void refresh().catch((error) => setNotice(error.message));
    const timer = setInterval(() => void refresh().catch(() => undefined), 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const loadPlayback = () => void jsonFetch("/api/playback", { cache: "no-store" }).then(setPlayback).catch(() => setPlayback({ active: false }));
    loadPlayback();
    const timer = setInterval(loadPlayback, 2000);
    return () => clearInterval(timer);
  }, [configured]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const code = params.get("code");
    if (code && hostMode) void completeSpotifyLogin(code, params.get("state")).catch((error) => setNotice(error.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostMode]);

  useEffect(() => {
    type ModelContext = { registerTool: (tool: unknown, options?: { signal: AbortSignal }) => void };
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    context.registerTool({ name: "read_party_queue", title: "Bekijk verzoeklijst", description: "Lees de actuele muziekwensen en stemtotalen.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: async () => (await jsonFetch(`/api/state?voterId=${encodeURIComponent(getVoterId())}`)).tracks }, { signal: lifecycle.signal });
    context.registerTool({ name: "vote_for_track", title: "Stem op nummer", description: "Breng namens deze telefoon een stem uit op een bestaand nummer.", inputSchema: { type: "object", properties: { itemId: { type: "number" } }, required: ["itemId"], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: async (input: unknown) => { const { itemId } = input as { itemId: number }; await vote(itemId); return { itemId, voted: true }; } }, { signal: lifecycle.signal });
    return () => lifecycle.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const candidateTracks = tracks.filter((track) => track.status === "candidate");
  const topTrack = candidateTracks[0];

  useEffect(() => {
    if (!hostMode || !autoDj || !adminCode || !topTrack) return;
    if (!playback.active || !playback.item) {
      if (lastPlaybackId.current && ++inactivePolls.current >= 2 && triggeredFor.current !== lastPlaybackId.current && !autoDjBusy.current) {
        triggeredFor.current = lastPlaybackId.current;
        void playNext(undefined, true);
      }
      return;
    }
    inactivePolls.current = 0;
    const currentId = playback.item.spotifyId;
    if (expectedPlayback.current) {
      if (currentId === expectedPlayback.current.spotifyId) { expectedPlayback.current = null; lastPlaybackId.current = currentId; return; }
      else if (Date.now() < expectedPlayback.current.until) { lastPlaybackId.current = currentId; return; }
      else expectedPlayback.current = null;
    }
    const changedNaturally = lastPlaybackId.current !== null && lastPlaybackId.current !== currentId;
    const remaining = playback.item.durationMs - Number(playback.progressMs || 0);
    const finishedWithoutNextTrack = !playback.isPlaying && remaining >= 0 && remaining <= 3000;
    lastPlaybackId.current = currentId;
    if ((changedNaturally || finishedWithoutNextTrack) && triggeredFor.current !== currentId && !autoDjBusy.current) {
      triggeredFor.current = currentId;
      void playNext(undefined, true);
    }
  // Auto-DJ reacts to a real Spotify track transition or to playback ending without a next track.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playback, hostMode, autoDj, adminCode, topTrack?.id]);

  useEffect(() => {
    if (hostMode && configured && adminCode && devices.length === 0) void loadDevices(adminCode).catch(() => undefined);
  // Load the active Spotify device once when the host page is reopened.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostMode, configured, adminCode]);
  async function search(event: React.FormEvent) {
    event.preventDefault(); if (query.trim().length < 2) return;
    setSearching(true); setNotice("");
    try { const data = await jsonFetch(`/api/search?q=${encodeURIComponent(query.trim())}`); setResults(data.tracks); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Zoeken lukte niet."); }
    finally { setSearching(false); }
  }

  async function add(track: SearchTrack) {
    setBusyId(-1); setNotice("");
    try { await jsonFetch("/api/suggestions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ track, voterId: getVoterId() }) }); setResults([]); setQuery(""); setNotice(`${track.name} staat in de lijst.`); await refresh(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Toevoegen lukte niet."); }
    finally { setBusyId(null); }
  }

  async function vote(itemId: number) {
    setBusyId(itemId); setNotice("");
    try { await jsonFetch("/api/vote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId, voterId: getVoterId() }) }); await refresh(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Stemmen lukte niet."); }
    finally { setBusyId(null); }
  }

  async function beginSpotifyLogin() {
    if (!clientId.trim() || !adminCode.trim()) { setNotice("Vul je Spotify Client ID en beheercode in."); return; }
    localStorage.setItem("stem-de-hit-admin", adminCode.trim()); localStorage.setItem("stem-de-hit-client", clientId.trim());
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    const verifier = Array.from(crypto.getRandomValues(new Uint8Array(64)), (n) => chars[n % chars.length]).join("");
    localStorage.setItem("spotify-verifier", verifier);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const state = crypto.randomUUID(); localStorage.setItem("spotify-state", state);
    const auth = new URL("https://accounts.spotify.com/authorize");
    auth.search = new URLSearchParams({ client_id: clientId.trim(), response_type: "code", redirect_uri: `${location.origin}/?host=1`, scope: "user-read-playback-state user-read-currently-playing user-modify-playback-state", code_challenge_method: "S256", code_challenge: challenge, state }).toString();
    location.href = auth.toString();
  }

  async function completeSpotifyLogin(code: string, returnedState: string | null) {
    const verifier = localStorage.getItem("spotify-verifier"); const savedClient = localStorage.getItem("stem-de-hit-client"); const savedAdmin = localStorage.getItem("stem-de-hit-admin");
    if (!verifier || !savedClient || !savedAdmin) throw new Error("De Spotify-aanmelding is verlopen. Start opnieuw.");
    if (!returnedState || returnedState !== localStorage.getItem("spotify-state")) throw new Error("De Spotify-aanmelding kon niet veilig worden bevestigd. Start opnieuw.");
    const tokenResponse = await fetch("https://accounts.spotify.com/api/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: savedClient, grant_type: "authorization_code", code, redirect_uri: `${location.origin}/?host=1`, code_verifier: verifier }) });
    const tokens = await tokenResponse.json() as Record<string, string | number>; if (!tokenResponse.ok) throw new Error("Spotify kon niet worden gekoppeld. Controleer de Redirect URI.");
    await jsonFetch("/api/host/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ adminCode: savedAdmin, clientId: savedClient, ...tokens }) });
    localStorage.removeItem("spotify-verifier"); localStorage.removeItem("spotify-state");
    history.replaceState({}, "", "/?host=1"); setNotice("Spotify is gekoppeld."); setConfigured(true); setAdminCode(savedAdmin); await loadDevices(savedAdmin);
  }

  async function loadDevices(code = adminCode) {
    localStorage.setItem("stem-de-hit-admin", code);
    const data = await jsonFetch(`/api/host/devices?adminCode=${encodeURIComponent(code)}`);
    setDevices(data.devices); setSelectedDevice(data.devices.find((device: Device) => device.is_active)?.id || data.devices[0]?.id || ""); setNotice("");
  }

  async function playNext(itemId?: number, automatic = false) {
    setBusyId(itemId ?? -2);
    if (automatic) autoDjBusy.current = true;
    try {
      const data = await jsonFetch("/api/host/play-next", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ adminCode, itemId, deviceId: selectedDevice || undefined }) });
      expectedPlayback.current = { spotifyId: data.spotifyId, until: Date.now() + 10_000 };
      setNotice(automatic ? `${data.name} is als winnaar gestart.` : `${data.name} speelt nu op Spotify.`);
      await refresh();
      const latest = await jsonFetch("/api/playback", { cache: "no-store" }).catch(() => null);
      if (latest?.item?.spotifyId) lastPlaybackId.current = latest.item.spotifyId;
      if (latest) setPlayback(latest);
    }
    catch (error) { if (automatic) triggeredFor.current = ""; setNotice(error instanceof Error ? error.message : "Afspelen op Spotify lukte niet."); }
    finally { setBusyId(null); autoDjBusy.current = false; }
  }

  async function startNewParty() {
    setBusyId(-3); setNotice("");
    try { await jsonFetch("/api/host/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ adminCode }) }); setTracks([]); setResults([]); setQuery(""); triggeredFor.current = ""; setNotice("Nieuwe sessie gestart. De oude verzoeken en stemmen zijn gewist."); await refresh(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Nieuwe sessie starten lukte niet."); }
    finally { setBusyId(null); }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_75%_5%,rgba(81,255,168,.13),transparent_28%),linear-gradient(145deg,#07110d_0%,#0d1813_52%,#050907_100%)] text-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-8">
        <a href="/" className="flex items-center gap-3 font-black tracking-tight"><span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#64f5a4] text-[#07110d] shadow-[0_0_28px_rgba(100,245,164,.28)]"><Music2 size={21}/></span><span className="text-xl">Stem de Hit</span></a>
        <Button variant="ghost" className="rounded-full text-zinc-300 hover:bg-white/10 hover:text-white" onClick={() => setShowHost(!showHost)}><Settings2 size={17}/><span className="hidden sm:inline">Host</span></Button>
      </header>
      {hostMode && <div className="mx-auto mb-2 max-w-6xl px-4 sm:px-8"><div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#64f5a4]/25 bg-[#64f5a4]/10 px-4 py-3 text-sm text-[#baffd4]"><span><strong>Auto-DJ staat {autoDj ? "aan" : "uit"}.</strong> Laat deze hostpagina open; de winnaar start automatisch aan het einde van het huidige nummer.</span><Button size="sm" variant="outline" onClick={() => { const next = !autoDj; setAutoDj(next); localStorage.setItem("stem-de-hit-auto-dj", String(next)); }} className="border-[#64f5a4]/30 bg-transparent text-[#baffd4] hover:bg-[#64f5a4]/15 hover:text-white">{autoDj ? "Uitzetten" : "Aanzetten"}</Button></div></div>}
      {hostMode && <div className="mx-auto flex max-w-6xl justify-end px-4 pt-2 sm:px-8"><AlertDialog><AlertDialogTrigger asChild><Button variant="outline" className="rounded-xl border-red-400/25 bg-red-400/5 text-red-200 hover:bg-red-400/15 hover:text-red-100"><RotateCcw size={16}/>Nieuwe sessie</Button></AlertDialogTrigger><AlertDialogContent className="border-white/10 bg-[#101914] text-white"><AlertDialogHeader><AlertDialogTitle>Nieuwe muzieksessie starten?</AlertDialogTitle><AlertDialogDescription className="text-zinc-400">Alle oude verzoeken en stemmen worden definitief gewist. De Spotify-koppeling blijft bewaard.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="border-white/10 bg-white/[.04] text-white hover:bg-white/10 hover:text-white">Annuleren</AlertDialogCancel><AlertDialogAction onClick={() => void startNewParty()} disabled={busyId === -3} className="bg-red-500 font-bold text-white hover:bg-red-400">Wis lijst en start opnieuw</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div>}
      <section className="mx-auto grid max-w-6xl gap-6 px-4 pb-16 pt-3 sm:px-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:pt-8">
        <div>
          <div className="mb-7 max-w-2xl"><p className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-[.18em] text-[#64f5a4]"><PartyPopper size={16}/> Jij bepaalt wat hierna komt</p><h1 className="text-4xl font-black leading-[.98] tracking-[-.055em] sm:text-6xl">Zoek. Stem.<br/><span className="text-zinc-500">Zet de avond aan.</span></h1></div>
          <form onSubmit={search} className="relative mb-3"><Search className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-500" size={22}/><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={configured ? "Zoek een nummer of artiest" : "Spotify wordt zo gekoppeld door de host"} disabled={!configured} className="h-16 rounded-2xl border-white/10 bg-white/[.07] pl-14 pr-28 text-base text-white placeholder:text-zinc-500 focus-visible:border-[#64f5a4]/70 focus-visible:ring-[#64f5a4]/20"/><Button type="submit" disabled={searching || !configured} className="absolute right-2 top-2 h-12 rounded-xl bg-[#64f5a4] px-5 font-bold text-[#06100b] hover:bg-[#8affba]">{searching ? <Loader2 className="animate-spin"/> : "Zoeken"}</Button></form>
          {results.length > 0 && <div className="mb-8 overflow-hidden rounded-2xl border border-white/10 bg-[#111d17] shadow-2xl"><div className="flex items-center justify-between border-b border-white/10 px-5 py-3 text-sm text-zinc-400"><span>Spotify-resultaten</span><button onClick={() => setResults([])} aria-label="Sluiten"><X size={18}/></button></div>{results.map((track) => <button key={track.spotifyId} onClick={() => add(track)} disabled={busyId === -1} className="flex w-full items-center gap-3 border-b border-white/[.06] p-3 text-left last:border-0 hover:bg-white/[.06]">{track.imageUrl ? <img src={track.imageUrl} alt="" className="h-12 w-12 rounded-lg object-cover"/> : <span className="grid h-12 w-12 place-items-center rounded-lg bg-white/10"><Music2/></span>}<span className="min-w-0 flex-1"><strong className="block truncate text-[15px]">{track.name}</strong><span className="block truncate text-sm text-zinc-400">{track.artist}</span></span><span className="text-xs text-zinc-500">{formatDuration(track.durationMs)}</span><span className="grid h-9 w-9 place-items-center rounded-full bg-[#64f5a4] text-xl font-bold text-[#07110d]">+</span></button>)}</div>}
          {notice && <div className="my-4 flex items-center gap-2 rounded-xl border border-[#64f5a4]/20 bg-[#64f5a4]/10 px-4 py-3 text-sm text-[#b9ffd5]"><Sparkles size={16}/>{notice}</div>}
          <div className="mt-8 flex items-end justify-between border-b border-white/10 pb-4"><div><p className="text-sm text-zinc-500">De gezamenlijke volgorde</p><h2 className="text-2xl font-bold tracking-tight">Hierna</h2></div><span className="flex items-center gap-2 text-sm text-zinc-400"><Users size={16}/>{candidateTracks.length} {candidateTracks.length === 1 ? "verzoek" : "verzoeken"}</span></div>
          <div className="divide-y divide-white/[.07]">{candidateTracks.map((track, index) => <article key={track.id} className="group flex items-center gap-3 py-4"><span className={`w-6 text-center text-sm font-black ${index === 0 ? "text-[#64f5a4]" : "text-zinc-600"}`}>{index + 1}</span>{track.imageUrl ? <img src={track.imageUrl} alt="" className="h-14 w-14 rounded-xl object-cover shadow-lg"/> : <span className="grid h-14 w-14 place-items-center rounded-xl bg-white/10"><Music2/></span>}<div className="min-w-0 flex-1"><h3 className="truncate font-bold">{track.name}</h3><p className="truncate text-sm text-zinc-500">{track.artist} · {formatDuration(track.durationMs)}</p></div>{hostMode ? <Button onClick={() => playNext(track.id)} disabled={busyId === track.id} className="rounded-xl bg-white/10 text-white hover:bg-[#64f5a4] hover:text-[#07110d]"><Play size={16}/><span className="hidden sm:inline">Speel nu</span></Button> : <button onClick={() => vote(track.id)} disabled={busyId === track.id || track.hasVoted} aria-label={`Stem op ${track.name}`} className={`flex min-w-16 items-center justify-center gap-1 rounded-xl border px-3 py-2 font-black transition ${track.hasVoted ? "border-[#64f5a4]/30 bg-[#64f5a4]/15 text-[#64f5a4]" : "border-white/10 bg-white/[.05] hover:-translate-y-0.5 hover:border-[#64f5a4]/50 hover:bg-[#64f5a4]/10"}`}>{track.hasVoted ? <Check size={17}/> : <ChevronUp size={18}/>} {track.votes}</button>}</article>)}{candidateTracks.length === 0 && <div className="grid min-h-52 place-items-center rounded-2xl border border-dashed border-white/10 text-center"><div><Headphones className="mx-auto mb-3 text-zinc-600" size={32}/><p className="font-semibold text-zinc-300">De dansvloer wacht nog</p><p className="mt-1 text-sm text-zinc-600">Zoek hierboven het eerste nummer.</p></div></div>}</div>
        </div>
        <aside className="space-y-5 lg:self-start">
          {hostMode && <div className="rounded-[28px] border border-[#64f5a4]/25 bg-[#0e1914] p-5 shadow-[0_24px_70px_rgba(0,0,0,.45)] lg:sticky lg:top-4 lg:z-20"><div className="mb-4 flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-white/10"><Smartphone size={20}/></span><div className="min-w-0 flex-1"><h3 className="font-bold">QR-code voor gasten</h3><p className="text-xs text-zinc-500">Blijft zichtbaar op de hostpagina</p></div><span className="rounded-full bg-[#64f5a4]/15 px-3 py-1 text-sm font-black text-[#64f5a4]">{voterCount} {voterCount === 1 ? "stemmer" : "stemmers"}</span></div><div className="mx-auto mb-4 grid aspect-square w-44 place-items-center overflow-hidden rounded-2xl bg-white p-3">{shareUrl ? <img src={`https://quickchart.io/qr?text=${encodeURIComponent(shareUrl)}&size=220&margin=1`} alt="QR-code naar deze verzoeklijst" className="h-full w-full"/> : <Loader2 className="animate-spin text-[#07110d]"/>}</div><Button variant="outline" disabled={!shareUrl} onClick={() => { void navigator.clipboard.writeText(shareUrl); setNotice("Link gekopieerd."); }} className="w-full rounded-xl border-white/10 bg-white/[.04] text-white hover:bg-white/10 hover:text-white"><Copy size={16}/>Kopieer link</Button></div>}
          {playback.active && playback.item && <div className="overflow-hidden rounded-[28px] border border-[#64f5a4]/20 bg-[#0d1d15] p-5 shadow-[0_30px_80px_rgba(0,0,0,.35)]"><div className="mb-4 flex items-center justify-between"><span className="flex items-center gap-2 rounded-full bg-[#64f5a4] px-3 py-1 text-xs font-black uppercase tracking-wider text-[#07110d]"><Volume2 size={13}/>Nu speelt</span><span className="text-xs text-zinc-500">{playback.isPlaying ? playback.device?.name || "Spotify" : "Gepauzeerd"}</span></div><div className="flex items-center gap-4">{playback.item.imageUrl ? <img src={playback.item.imageUrl} alt="Albumhoes" className="h-20 w-20 rounded-2xl object-cover"/> : <span className="grid h-20 w-20 place-items-center rounded-2xl bg-white/10"><Music2/></span>}<div className="min-w-0"><h2 className="truncate text-xl font-black tracking-tight">{playback.item.name}</h2><p className="truncate text-sm text-zinc-400">{playback.item.artist}</p><p className="mt-2 text-xs text-zinc-600">{formatDuration(playback.progressMs || 0)} / {formatDuration(playback.item.durationMs)}</p></div></div><div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[#64f5a4] transition-all" style={{ width: `${Math.min(100, Math.max(0, ((playback.progressMs || 0) / Math.max(1, playback.item.durationMs)) * 100))}%` }}/></div></div>}
          {topTrack && <div className="overflow-hidden rounded-[28px] border border-white/10 bg-white/[.06] p-5 shadow-[0_30px_80px_rgba(0,0,0,.35)]"><div className="mb-4 flex items-center justify-between"><span className="rounded-full bg-[#64f5a4] px-3 py-1 text-xs font-black uppercase tracking-wider text-[#07110d]">Hierna #1</span><span className="text-sm font-bold text-[#64f5a4]">{topTrack.votes} stemmen</span></div>{topTrack.imageUrl && <img src={topTrack.imageUrl} alt="Albumhoes" className="aspect-square w-full rounded-2xl object-cover"/>}<h2 className="mt-4 truncate text-2xl font-black tracking-tight">{topTrack.name}</h2><p className="truncate text-zinc-400">{topTrack.artist}</p></div>}
        </aside>
      </section>
      {showHost && <div className="fixed inset-0 z-50 grid place-items-end bg-black/70 p-0 backdrop-blur-sm sm:place-items-center sm:p-5" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowHost(false); }}>
        <section className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-[28px] border border-white/10 bg-[#101914] p-6 shadow-2xl sm:rounded-[28px] sm:p-8">
          <div className="mb-6 flex items-start justify-between"><div><p className="mb-2 flex items-center gap-2 text-sm font-bold text-[#64f5a4]"><LockKeyhole size={16}/>Alleen voor de host</p><h2 className="text-3xl font-black tracking-tight">Bedien de avond</h2></div><button onClick={() => setShowHost(false)} aria-label="Sluiten"><X/></button></div>
          {!configured ? <div className="space-y-4">
            <p className="text-sm leading-6 text-zinc-400">Maak in het Spotify Developer Dashboard een app aan en voeg deze exacte Redirect URI toe:</p>
            <code className="block overflow-x-auto rounded-xl bg-black/30 p-3 text-xs text-[#9cfbc4]">{shareUrl}?host=1</code>
            <label className="block text-sm font-semibold">Spotify Client ID<Input value={clientId} onChange={(e) => setClientId(e.target.value)} className="mt-2 h-12 border-white/10 bg-white/[.06]" placeholder="Bijvoorbeeld 1a2b3c…"/></label>
            <label className="block text-sm font-semibold">Beheercode<Input type="password" value={adminCode} onChange={(e) => setAdminCode(e.target.value)} className="mt-2 h-12 border-white/10 bg-white/[.06]" placeholder="De code die je van ons krijgt"/></label>
            <Button onClick={beginSpotifyLogin} className="h-12 w-full rounded-xl bg-[#64f5a4] font-black text-[#07110d] hover:bg-[#8affba]">Koppel met Spotify</Button>
          </div> : <div className="space-y-5">
            <div className="rounded-2xl border border-[#64f5a4]/20 bg-[#64f5a4]/10 p-4 text-sm text-[#bcffd7]"><strong className="flex items-center gap-2"><Check size={17}/>Spotify is gekoppeld</strong><p className="mt-1 text-[#8bd7aa]">Laat Spotify spelen op de laptop en kies dat apparaat hieronder.</p></div>
            <label className="block text-sm font-semibold">Beheercode<div className="mt-2 flex gap-2"><Input type="password" value={adminCode} onChange={(e) => setAdminCode(e.target.value)} className="h-11 border-white/10 bg-white/[.06]"/><Button onClick={() => loadDevices()} variant="outline" className="h-11 border-white/10 bg-white/[.06] text-white hover:bg-white/10">Ververs</Button></div></label>
            {devices.length > 0 && <div><p className="mb-2 text-sm font-semibold">Spotify-apparaat</p><div className="grid gap-2">{devices.map((device) => <button key={device.id} onClick={() => setSelectedDevice(device.id)} className={`flex items-center justify-between rounded-xl border p-3 text-left ${selectedDevice === device.id ? "border-[#64f5a4] bg-[#64f5a4]/10" : "border-white/10 bg-white/[.04]"}`}><span><strong className="block">{device.name}</strong><span className="text-xs text-zinc-500">{device.type}</span></span>{device.is_active && <span className="text-xs font-bold text-[#64f5a4]">Actief</span>}</button>)}</div></div>}
            <Button onClick={() => setShowHost(false)} variant="outline" className="w-full border-white/10 bg-white/[.04] text-white hover:bg-white/10">Terug naar de hostlijst</Button>
          </div>}
        </section>
      </div>}
    </main>
  );
}
