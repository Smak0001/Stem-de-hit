"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronUp, Copy, Headphones, Loader2, LockKeyhole, Maximize2, Music2, PartyPopper, Play, QrCode, RotateCcw, Search, Settings2, Smartphone, Sparkles, Users, Volume2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Switch } from "@/components/ui/switch";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

type Track = { id: number; spotifyId: string; uri: string; name: string; artist: string; album: string; imageUrl: string | null; durationMs: number; votes: number; hasVoted: boolean; status: string };
type SearchTrack = Omit<Track, "id" | "votes" | "hasVoted" | "status">;
type Device = { id: string; name: string; type: string; is_active: boolean };
type Playback = { active: boolean; isPlaying?: boolean; progressMs?: number; item?: SearchTrack; queue?: SearchTrack[]; device?: { id: string; name: string; type: string } | null };
type ReactionEvent = { id: number; emoji: string; createdAt: number };
type ReactionParticle = ReactionEvent & { x: number; drift: number; rotation: number };
type ReactionCombo = { id: number; emoji: string | null; count: number };
type PartyCodeInfo = { code: string; rotatesAt: number; expiresInSeconds: number };

const PARTY_THEMES = [
  { name: "Neon Jungle", primary: "#64f5a4", secondary: "#d946ef", background: "radial-gradient(circle at 12% 5%, rgba(217,70,239,.2), transparent 38%), radial-gradient(circle at 88% 92%, rgba(100,245,164,.17), transparent 42%), #050806" },
  { name: "Electric Sunset", primary: "#fb7185", secondary: "#fbbf24", background: "radial-gradient(circle at 14% 8%, rgba(251,113,133,.22), transparent 38%), radial-gradient(circle at 88% 90%, rgba(251,191,36,.16), transparent 42%), #0b0608" },
  { name: "Midnight Wave", primary: "#38bdf8", secondary: "#818cf8", background: "radial-gradient(circle at 10% 8%, rgba(129,140,248,.24), transparent 38%), radial-gradient(circle at 90% 92%, rgba(56,189,248,.17), transparent 44%), #04070d" },
  { name: "Laser Lime", primary: "#bef264", secondary: "#22d3ee", background: "radial-gradient(circle at 12% 7%, rgba(34,211,238,.2), transparent 38%), radial-gradient(circle at 86% 90%, rgba(190,242,100,.16), transparent 44%), #050905" },
  { name: "Purple Rain", primary: "#c084fc", secondary: "#60a5fa", background: "radial-gradient(circle at 15% 10%, rgba(96,165,250,.23), transparent 40%), radial-gradient(circle at 88% 88%, rgba(192,132,252,.2), transparent 44%), #080510" },
  { name: "Candy Rush", primary: "#f472b6", secondary: "#fb7185", background: "radial-gradient(circle at 10% 12%, rgba(244,114,182,.25), transparent 39%), radial-gradient(circle at 92% 86%, rgba(251,113,133,.18), transparent 44%), #10050b" },
  { name: "Ocean Drive", primary: "#22d3ee", secondary: "#2dd4bf", background: "radial-gradient(circle at 12% 8%, rgba(45,212,191,.22), transparent 40%), radial-gradient(circle at 90% 92%, rgba(34,211,238,.2), transparent 44%), #031014" },
  { name: "Tropical Heat", primary: "#fb923c", secondary: "#f43f5e", background: "radial-gradient(circle at 13% 10%, rgba(244,63,94,.25), transparent 40%), radial-gradient(circle at 88% 90%, rgba(251,146,60,.2), transparent 44%), #120605" },
  { name: "Cosmic Gold", primary: "#facc15", secondary: "#a78bfa", background: "radial-gradient(circle at 12% 8%, rgba(167,139,250,.23), transparent 40%), radial-gradient(circle at 90% 90%, rgba(250,204,21,.17), transparent 44%), #0d0904" },
  { name: "Blue Steel", primary: "#93c5fd", secondary: "#e2e8f0", background: "radial-gradient(circle at 12% 8%, rgba(226,232,240,.16), transparent 40%), radial-gradient(circle at 88% 92%, rgba(147,197,253,.2), transparent 45%), #050a12" },
];

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

function formatCountdown(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function PartyReactionLayer({ adminCode, onCombo }: { adminCode: string; onCombo: (combo: Omit<ReactionCombo, "id">) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    let stopped = false;
    let frame: number | null = null;
    let width = 0;
    let height = 0;
    let lastPaint = 0;
    let particles: ReactionParticle[] = [];
    let recentReactions: ReactionEvent[] = [];
    let lastComboAt = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    };

    const draw = (timestamp: number) => {
      if (stopped) return;
      if (timestamp - lastPaint < 22) { frame = requestAnimationFrame(draw); return; }
      lastPaint = timestamp;
      const now = Date.now();
      particles = particles.filter((particle) => now - particle.createdAt < 5400);
      context.clearRect(0, 0, width, height);
      for (const particle of particles) {
        const progress = Math.min(1, Math.max(0, (now - particle.createdAt) / 5400));
        const eased = 1 - Math.pow(1 - progress, 2);
        const opacity = progress < .12 ? progress / .12 : progress > .72 ? (1 - progress) / .28 : 1;
        const scale = progress < .12 ? .65 + (progress / .12) * .43 : 1.08 + progress * .27;
        const x = particle.x * width + particle.drift * eased;
        const y = height - 42 - eased * height * .78;
        context.save();
        context.globalAlpha = Math.max(0, opacity);
        context.translate(x, y);
        context.rotate((particle.rotation * progress * Math.PI) / 180);
        context.font = `${Math.round(48 * scale)}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(particle.emoji, 0, 0);
        context.restore();
      }
      frame = particles.length > 0 ? requestAnimationFrame(draw) : null;
    };

    const startDrawing = () => { if (frame === null) frame = requestAnimationFrame(draw); };
    const addReactions = (incoming: ReactionEvent[]) => {
      particles.push(...incoming.map((reaction) => ({
        ...reaction,
        x: .08 + ((reaction.id * 37) % 82) / 100,
        drift: (reaction.id % 2 === 0 ? 1 : -1) * (24 + (reaction.id % 4) * 12),
        rotation: reaction.id % 2 === 0 ? 14 : -14,
      })));
      particles = particles.slice(-70);
      const now = Date.now();
      recentReactions = [...recentReactions, ...incoming].filter((reaction) => now - reaction.createdAt <= 3000);
      if (recentReactions.length >= 10 && now - lastComboAt >= 4200) {
        const counts = new Map<string, number>();
        for (const reaction of recentReactions) counts.set(reaction.emoji, (counts.get(reaction.emoji) || 0) + 1);
        const dominant = [...counts.entries()].sort((left, right) => right[1] - left[1])[0];
        onCombo({ emoji: dominant && dominant[1] >= 7 ? dominant[0] : null, count: recentReactions.length });
        lastComboAt = now;
        recentReactions = [];
      }
      startDrawing();
    };

    const loadReactions = () => void jsonFetch(`/api/reactions?since=${Date.now() - 6500}&afterId=${cursorRef.current}&adminCode=${encodeURIComponent(adminCode)}`, { cache: "no-store" }).then((data) => {
      const incoming = (data.reactions || []) as ReactionEvent[];
      if (incoming.length === 0) return;
      cursorRef.current = incoming[incoming.length - 1].id;
      addReactions(incoming);
    }).catch(() => undefined);

    const observer = new ResizeObserver(() => { resize(); startDrawing(); });
    observer.observe(canvas);
    resize();
    loadReactions();
    const pollTimer = setInterval(loadReactions, 300);
    return () => {
      stopped = true;
      clearInterval(pollTimer);
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [adminCode, onCombo]);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 z-30 h-full w-full" aria-hidden="true"/>;
}

function PartyConfettiLayer({ burst }: { burst: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (burst === 0) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width));
    canvas.height = Math.max(1, Math.round(rect.height));
    const colors = ["#64f5a4", "#d946ef", "#38bdf8", "#fbbf24", "#fb7185", "#ffffff"];
    const pieces = Array.from({ length: 86 }, (_, index) => ({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * canvas.height * .22,
      vx: (Math.random() - .5) * 3.4,
      vy: 2.3 + Math.random() * 3.6,
      size: 5 + Math.random() * 8,
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - .5) * .22,
      color: colors[index % colors.length],
    }));
    const startedAt = performance.now();
    let previous = startedAt;
    let frame = 0;
    const draw = (now: number) => {
      const delta = Math.min(2, (now - previous) / 16.7);
      previous = now;
      context.clearRect(0, 0, canvas.width, canvas.height);
      const opacity = Math.max(0, Math.min(1, (2600 - (now - startedAt)) / 550));
      for (const piece of pieces) {
        piece.x += piece.vx * delta;
        piece.y += piece.vy * delta;
        piece.vy += .035 * delta;
        piece.rotation += piece.spin * delta;
        context.save();
        context.globalAlpha = opacity;
        context.translate(piece.x, piece.y);
        context.rotate(piece.rotation);
        context.fillStyle = piece.color;
        context.fillRect(-piece.size / 2, -piece.size / 3, piece.size, piece.size * .62);
        context.restore();
      }
      if (now - startedAt < 2600) frame = requestAnimationFrame(draw);
      else context.clearRect(0, 0, canvas.width, canvas.height);
    };
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); context.clearRect(0, 0, canvas.width, canvas.height); };
  }, [burst]);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 z-[32] h-full w-full" aria-hidden="true"/>;
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
  const [appReady, setAppReady] = useState(false);
  const [joined, setJoined] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState("");
  const [joining, setJoining] = useState(false);
  const [partyAccess, setPartyAccess] = useState<PartyCodeInfo | null>(null);
  const [showHost, setShowHost] = useState(false);
  const [adminCode, setAdminCode] = useState("");
  const [clientId, setClientId] = useState("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [shareUrl, setShareUrl] = useState("");
  const [playback, setPlayback] = useState<Playback>({ active: false });
  const [autoDj, setAutoDj] = useState(true);
  const [autoDjLeader, setAutoDjLeader] = useState(false);
  const [partyMode, setPartyMode] = useState(false);
  const [partyQrOpen, setPartyQrOpen] = useState(false);
  const [leaderCelebration, setLeaderCelebration] = useState(false);
  const [confettiBurst, setConfettiBurst] = useState(0);
  const [partyThemeIndex, setPartyThemeIndex] = useState(0);
  const [transitionTrack, setTransitionTrack] = useState<SearchTrack | null>(null);
  const [reactionCombo, setReactionCombo] = useState<ReactionCombo | null>(null);
  const [newRequestTrack, setNewRequestTrack] = useState<Track | null>(null);
  const [voteFlashId, setVoteFlashId] = useState<number | null>(null);
  const [showQrCard, setShowQrCard] = useState(true);
  const triggeredFor = useRef("");
  const lastPlaybackId = useRef<string | null>(null);
  const autoDjBusy = useRef(false);
  const inactivePolls = useRef(0);
  const expectedPlayback = useRef<{ spotifyId: string; itemId: number; until: number; normalizeOnStart: boolean; recoveryAttempts: number } | null>(null);
  const previousLeaderId = useRef<number | null>(null);
  const previousPartyPlaybackId = useRef<string | null>(null);
  const milestoneVotes = useRef(new Map<number, number>());
  const pendingReactions = useRef<string[]>([]);
  const reactionFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reactionFlushBusy = useRef(false);
  const partyTrackingReady = useRef(false);
  const knownCandidateIds = useRef(new Set<number>());
  const knownCandidateVotes = useRef(new Map<number, number>());

  const handleReactionCombo = useCallback((combo: Omit<ReactionCombo, "id">) => {
    setReactionCombo({ ...combo, id: Date.now() });
    if (combo.emoji === "🎉") setConfettiBurst((current) => current + 1);
  }, []);

  const refresh = useCallback(async () => {
    const adminQuery = hostMode && adminCode ? `&adminCode=${encodeURIComponent(adminCode)}` : "";
    const data = await jsonFetch(`/api/state?voterId=${encodeURIComponent(getVoterId())}${adminQuery}`);
    setTracks(data.tracks); setConfigured(data.configured); setVoterCount(Number(data.voterCount || 0));
  }, [adminCode, hostMode]);

  useEffect(() => {
    const isHost = new URLSearchParams(location.search).get("host") === "1";
    setHostMode(isHost);
    setShareUrl(`${location.origin}/`);
    setAdminCode(localStorage.getItem("stem-de-hit-admin") || "");
    setAutoDj(localStorage.getItem("stem-de-hit-auto-dj") !== "false");
    setPartyMode(localStorage.getItem("stem-de-hit-party-mode") === "true");
    if (isHost) { setJoined(true); setAppReady(true); return; }
    void jsonFetch("/api/join", { cache: "no-store" }).then((data) => setJoined(Boolean(data.authorized))).catch(() => setJoined(false)).finally(() => setAppReady(true));
  }, []);

  useEffect(() => {
    if (!appReady || (!hostMode && !joined) || (hostMode && !adminCode)) return;
    void refresh().catch((error) => setNotice(error.message));
    const timer = setInterval(() => void refresh().catch(() => undefined), 1000);
    return () => clearInterval(timer);
  }, [adminCode, appReady, hostMode, joined, refresh]);

  useEffect(() => {
    if (!appReady || (!hostMode && !joined) || (hostMode && !adminCode)) return;
    const adminQuery = hostMode && adminCode ? `?adminCode=${encodeURIComponent(adminCode)}` : "";
    const loadPlayback = () => void jsonFetch(`/api/playback${adminQuery}`, { cache: "no-store" }).then(setPlayback).catch(() => setPlayback({ active: false }));
    loadPlayback();
    const timer = setInterval(loadPlayback, 1000);
    return () => clearInterval(timer);
  }, [adminCode, appReady, configured, hostMode, joined]);

  useEffect(() => {
    if (!hostMode || !adminCode) { setPartyAccess(null); return; }
    const loadCode = () => void jsonFetch(`/api/host/party-code?adminCode=${encodeURIComponent(adminCode)}`, { cache: "no-store" }).then(setPartyAccess).catch(() => setPartyAccess(null));
    loadCode();
    const timer = setInterval(loadCode, 1000);
    return () => clearInterval(timer);
  }, [adminCode, hostMode]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const code = params.get("code");
    if (code && hostMode) void completeSpotifyLogin(code, params.get("state")).catch((error) => setNotice(error.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostMode]);

  useEffect(() => {
    if (!joined && !hostMode) return;
    type ModelContext = { registerTool: (tool: unknown, options?: { signal: AbortSignal }) => void };
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    context.registerTool({ name: "read_party_queue", title: "Bekijk verzoeklijst", description: "Lees de actuele muziekwensen en stemtotalen.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: async () => (await jsonFetch(`/api/state?voterId=${encodeURIComponent(getVoterId())}`)).tracks }, { signal: lifecycle.signal });
    context.registerTool({ name: "vote_for_track", title: "Stem op nummer", description: "Breng namens deze telefoon een stem uit op een bestaand nummer.", inputSchema: { type: "object", properties: { itemId: { type: "number" } }, required: ["itemId"], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: async (input: unknown) => { const { itemId } = input as { itemId: number }; await vote(itemId); return { itemId, voted: true }; } }, { signal: lifecycle.signal });
    return () => lifecycle.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostMode, joined]);

  const candidateTracks = tracks.filter((track) => track.status === "candidate");
  const topTrack = candidateTracks[0];
  const candidateSpotifyIds = new Set(candidateTracks.map((track) => track.spotifyId));
  const seenQueueIds = new Set<string>();
  const spotifyQueueTracks = (playback.queue || []).filter((track) => {
    if (!track.spotifyId || candidateSpotifyIds.has(track.spotifyId) || seenQueueIds.has(track.spotifyId)) return false;
    seenQueueIds.add(track.spotifyId);
    return true;
  });
  const partyTheme = PARTY_THEMES[partyThemeIndex];
  const newestCandidate = candidateTracks[candidateTracks.length - 1];
  const remainingSeconds = playback.item && playback.isPlaying ? Math.max(0, Math.ceil((playback.item.durationMs - Number(playback.progressMs || 0)) / 1000)) : null;
  const tickerItems = [
    topTrack ? `🔥 Nu populair: ${topTrack.name} · ${topTrack.votes} ${topTrack.votes === 1 ? "stem" : "stemmen"}` : "🎵 Voeg een nummer toe en bepaal wat hierna komt",
    newestCandidate ? `✨ Nieuw verzoek: ${newestCandidate.name} — ${newestCandidate.artist}` : "📱 Scan de QR-code om mee te doen",
    topTrack && topTrack.votes >= 10 ? `🎉 Stemmijlpaal: ${topTrack.votes} stemmen op ${topTrack.name}` : `🙌 ${voterCount} ${voterCount === 1 ? "stemmer doet" : "stemmers doen"} mee`,
    `🎨 Thema: ${partyTheme.name}`,
  ];

  useEffect(() => {
    if (!reactionCombo) return;
    const timer = setTimeout(() => setReactionCombo(null), 3400);
    return () => clearTimeout(timer);
  }, [reactionCombo?.id]);

  useEffect(() => {
    if (!newRequestTrack) return;
    const timer = setTimeout(() => setNewRequestTrack(null), 4200);
    return () => clearTimeout(timer);
  }, [newRequestTrack?.id]);

  useEffect(() => {
    if (voteFlashId === null) return;
    const timer = setTimeout(() => setVoteFlashId(null), 1100);
    return () => clearTimeout(timer);
  }, [voteFlashId]);

  useEffect(() => {
    const currentIds = new Set(candidateTracks.map((track) => track.id));
    const currentVotes = new Map(candidateTracks.map((track) => [track.id, track.votes]));
    if (!partyMode) {
      partyTrackingReady.current = false;
      knownCandidateIds.current = currentIds;
      knownCandidateVotes.current = currentVotes;
      return;
    }
    if (!partyTrackingReady.current) {
      partyTrackingReady.current = true;
      knownCandidateIds.current = currentIds;
      knownCandidateVotes.current = currentVotes;
      return;
    }
    const added = candidateTracks.filter((track) => !knownCandidateIds.current.has(track.id)).sort((left, right) => right.id - left.id)[0];
    if (added) setNewRequestTrack(added);
    const increased = candidateTracks.filter((track) => track.votes > (knownCandidateVotes.current.get(track.id) ?? track.votes)).sort((left, right) => (right.votes - (knownCandidateVotes.current.get(right.id) || 0)) - (left.votes - (knownCandidateVotes.current.get(left.id) || 0)))[0];
    if (increased) setVoteFlashId(increased.id);
    knownCandidateIds.current = currentIds;
    knownCandidateVotes.current = currentVotes;
  }, [partyMode, tracks]);

  useEffect(() => {
    if (!partyMode || !topTrack) { previousLeaderId.current = topTrack?.id || null; setLeaderCelebration(false); return; }
    if (previousLeaderId.current !== null && previousLeaderId.current !== topTrack.id) {
      setLeaderCelebration(true);
      setConfettiBurst((current) => current + 1);
      const timer = setTimeout(() => setLeaderCelebration(false), 4200);
      previousLeaderId.current = topTrack.id;
      return () => clearTimeout(timer);
    }
    previousLeaderId.current = topTrack.id;
  }, [partyMode, topTrack?.id]);

  useEffect(() => {
    if (!partyMode || !topTrack) return;
    const previousVotes = milestoneVotes.current.get(topTrack.id);
    if (previousVotes !== undefined && topTrack.votes >= 10 && Math.floor(previousVotes / 10) < Math.floor(topTrack.votes / 10)) setConfettiBurst((current) => current + 1);
    milestoneVotes.current.set(topTrack.id, topTrack.votes);
  }, [partyMode, topTrack?.id, topTrack?.votes]);

  useEffect(() => {
    const currentId = playback.item?.spotifyId || null;
    if (!partyMode || !currentId) { previousPartyPlaybackId.current = currentId; setTransitionTrack(null); return; }
    if (previousPartyPlaybackId.current && previousPartyPlaybackId.current !== currentId && playback.item) {
      setTransitionTrack(playback.item);
      const timer = setTimeout(() => setTransitionTrack(null), 2600);
      previousPartyPlaybackId.current = currentId;
      return () => clearTimeout(timer);
    }
    previousPartyPlaybackId.current = currentId;
  }, [partyMode, playback.item?.spotifyId]);

  useEffect(() => {
    if (!hostMode || !partyMode) return;
    const timer = setInterval(() => setPartyThemeIndex((current) => (current + 1) % PARTY_THEMES.length), 30_000);
    return () => clearInterval(timer);
  }, [hostMode, partyMode]);

  useEffect(() => {
    if (!hostMode || !partyMode) return;
    let closeTimer: ReturnType<typeof setTimeout> | null = null;
    const showAutomaticQr = () => {
      setPartyQrOpen(true);
      if (closeTimer) clearTimeout(closeTimer);
      closeTimer = setTimeout(() => setPartyQrOpen(false), 30_000);
    };
    const timer = setInterval(showAutomaticQr, 5 * 60_000);
    return () => { clearInterval(timer); if (closeTimer) clearTimeout(closeTimer); };
  }, [hostMode, partyMode]);

  useEffect(() => {
    if (!hostMode || !topTrack) { setShowQrCard(true); return; }
    const timer = setInterval(() => setShowQrCard((current) => !current), 8000);
    return () => clearInterval(timer);
  }, [hostMode, topTrack?.id]);

  useEffect(() => {
    if (!hostMode || !autoDj) { setAutoDjLeader(false); return; }
    if (!navigator.locks) {
      setAutoDjLeader(true);
      return () => setAutoDjLeader(false);
    }
    let cancelled = false;
    let releaseLock: (() => void) | null = null;
    const holdLock = new Promise<void>((resolve) => { releaseLock = resolve; });
    void navigator.locks.request("stem-de-hit-auto-dj", { mode: "exclusive" }, async () => {
      if (cancelled) return;
      setAutoDjLeader(true);
      await holdLock;
    }).finally(() => { if (!cancelled) setAutoDjLeader(false); });
    return () => { cancelled = true; releaseLock?.(); setAutoDjLeader(false); };
  }, [hostMode, autoDj]);

  useEffect(() => {
    if (!hostMode || !autoDj || !autoDjLeader || !adminCode || autoDjBusy.current) return;
    // Keep ownership of the queued winner until Spotify confirms it started.
    // Track/vote updates must not clear it or launch concurrent transitions.
    const retryExpected = () => {
      const expected = expectedPlayback.current;
      if (!expected || Date.now() < expected.until) return;
      if (expected.recoveryAttempts >= 2) {
        if (expected.until !== Infinity) {
          expected.until = Infinity;
          setNotice("Spotify heeft het volgende nummer niet bevestigd. Controleer Spotify op de laptop en gebruik zo nodig Speel nu.");
        }
        return;
      }
      expected.recoveryAttempts += 1;
      expected.until = Date.now() + 10_000;
      void playNext(expected.itemId, true, true, true, true);
    };
    if (!playback.active || !playback.item) {
      const inactiveCount = ++inactivePolls.current;
      const expected = expectedPlayback.current;
      if (expected && lastPlaybackId.current && inactiveCount >= 2 && !autoDjBusy.current) {
        retryExpected();
        return;
      }
      if (topTrack && lastPlaybackId.current && inactiveCount >= 2 && triggeredFor.current !== lastPlaybackId.current && !autoDjBusy.current) {
        triggeredFor.current = lastPlaybackId.current;
        void playNext(undefined, true);
      }
      return;
    }
    inactivePolls.current = 0;
    const currentId = playback.item.spotifyId;
    if (expectedPlayback.current) {
      if (currentId === expectedPlayback.current.spotifyId && playback.isPlaying) {
        expectedPlayback.current = null;
        lastPlaybackId.current = currentId;
        // Spotify already started the winner. Never rebuild its sequence here:
        // that restarts playback at zero, including during a crossfade.
        return;
      }
      const changedBeforeWinner = currentId !== expectedPlayback.current.spotifyId && lastPlaybackId.current !== null && lastPlaybackId.current !== currentId;
      if (changedBeforeWinner && !autoDjBusy.current) {
        expectedPlayback.current.until = Math.min(expectedPlayback.current.until, Date.now());
        lastPlaybackId.current = currentId;
        retryExpected();
        return;
      }
      else {
        const remaining = playback.item.durationMs - Number(playback.progressMs || 0);
        // Never interpret a pause in the middle of a track as its end.
        if (!playback.isPlaying && remaining <= 3000) retryExpected();
        lastPlaybackId.current = currentId;
        return;
      }
    }
    if (!topTrack) { lastPlaybackId.current = currentId; return; }
    const changedNaturally = lastPlaybackId.current !== null && lastPlaybackId.current !== currentId;
    const remaining = playback.item.durationMs - Number(playback.progressMs || 0);
    const readyToQueue = Boolean(playback.isPlaying) && remaining > 0 && remaining <= 12_000;
    const finishedWithoutNextTrack = !playback.isPlaying && remaining >= 0 && remaining <= 3000;
    lastPlaybackId.current = currentId;
    if ((readyToQueue || changedNaturally || finishedWithoutNextTrack) && triggeredFor.current !== currentId && !autoDjBusy.current) {
      triggeredFor.current = currentId;
      void playNext(undefined, true, !readyToQueue);
    }
  // Auto-DJ reacts to a real Spotify track transition or to playback ending without a next track.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playback, hostMode, autoDj, autoDjLeader, adminCode, topTrack?.id, tracks]);

  useEffect(() => {
    if (hostMode && configured && adminCode && devices.length === 0) void loadDevices(adminCode).catch(() => undefined);
  // Load the active Spotify device once when the host page is reopened.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostMode, configured, adminCode]);
  async function search(event: React.FormEvent) {
    event.preventDefault(); if (query.trim().length < 2) return;
    setSearching(true); setNotice("");
    try { const data = await jsonFetch(`/api/search?q=${encodeURIComponent(query.trim())}${hostMode && adminCode ? `&adminCode=${encodeURIComponent(adminCode)}` : ""}`); setResults(data.tracks); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Zoeken lukte niet."); }
    finally { setSearching(false); }
  }

  async function add(track: SearchTrack) {
    setBusyId(-1); setNotice("");
    try { await jsonFetch("/api/suggestions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ track, voterId: getVoterId(), adminCode: hostMode ? adminCode : undefined }) }); setResults([]); setQuery(""); setNotice(`${track.name} staat in de lijst.`); await refresh(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Toevoegen lukte niet."); }
    finally { setBusyId(null); }
  }

  async function vote(itemId: number) {
    setBusyId(itemId); setNotice("");
    try { await jsonFetch("/api/vote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId, voterId: getVoterId(), adminCode: hostMode ? adminCode : undefined }) }); await refresh(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Stemmen lukte niet."); }
    finally { setBusyId(null); }
  }

  function sendReaction(emoji: string) {
    pendingReactions.current.push(emoji);
    if (reactionFlushTimer.current || reactionFlushBusy.current) return;
    reactionFlushTimer.current = setTimeout(() => { reactionFlushTimer.current = null; void flushReactionQueue(); }, 80);
  }

  async function flushReactionQueue() {
    if (reactionFlushBusy.current || pendingReactions.current.length === 0) return;
    reactionFlushBusy.current = true;
    const emojis = pendingReactions.current.splice(0, 50);
    try { await jsonFetch("/api/reactions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emojis, voterId: getVoterId(), adminCode: hostMode ? adminCode : undefined }) }); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Reacties versturen lukte niet."); }
    finally {
      reactionFlushBusy.current = false;
      if (pendingReactions.current.length > 0 && !reactionFlushTimer.current) reactionFlushTimer.current = setTimeout(() => { reactionFlushTimer.current = null; void flushReactionQueue(); }, 50);
    }
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

  async function playNext(itemId?: number, automatic = false, immediate = true, recover = false, ensureStarted = false) {
    if (autoDjBusy.current) return;
    setBusyId(itemId ?? -2);
    autoDjBusy.current = true;
    const recoveryAttempts = ensureStarted ? expectedPlayback.current?.recoveryAttempts || 0 : 0;
    try {
      const data = await jsonFetch("/api/host/play-next", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ adminCode, itemId, deviceId: selectedDevice || undefined, immediate, recover, ensureStarted }) });
      const remaining = Math.max(0, (playback.item?.durationMs || 0) - Number(playback.progressMs || 0));
      expectedPlayback.current = { spotifyId: data.spotifyId, itemId: data.itemId, until: Date.now() + (immediate ? 10_000 : remaining + 2000), normalizeOnStart: Boolean(data.normalizeOnStart), recoveryAttempts };
      setNotice(automatic && !immediate ? `${data.name} staat klaar als volgende.` : automatic ? `${data.name} is als winnaar gestart.` : `${data.name} speelt nu op Spotify.`);
      await refresh();
      const latest = await jsonFetch(`/api/playback?adminCode=${encodeURIComponent(adminCode)}`, { cache: "no-store" }).catch(() => null);
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

  async function joinParty(event: React.FormEvent) {
    event.preventDefault();
    if (joinCode.length !== 6) return;
    setJoining(true); setJoinError("");
    try {
      await jsonFetch("/api/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: joinCode }) });
      setJoined(true); setJoinCode("");
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : "De code klopt niet.");
    } finally {
      setJoining(false);
    }
  }

  const shownTracks = hostMode ? candidateTracks.slice(0, 5) : candidateTracks;
  const queueFillTracks = spotifyQueueTracks.slice(0, hostMode ? Math.max(0, 5 - shownTracks.length) : 5);
  const comboVisual = reactionCombo?.emoji === "🔥" ? { title: "Vuurzee!", emoji: "🔥", kind: "fire" } : reactionCombo?.emoji === "❤️" ? { title: "Hartjesregen!", emoji: "❤️", kind: "heart" } : reactionCombo?.emoji === "🎉" ? { title: "Feestexplosie!", emoji: "🎉", kind: "party" } : reactionCombo?.emoji === "🙌" ? { title: "Handen in de lucht!", emoji: "🙌", kind: "hands" } : { title: "Crowd gaat los!", emoji: "⚡", kind: "generic" };

  if (!appReady) return <main className="grid min-h-[100dvh] place-items-center overflow-hidden bg-[#07110d] text-[#64f5a4]"><Loader2 className="animate-spin" size={32}/></main>;

  if (!hostMode && !joined) return (
    <main className="grid min-h-[100dvh] w-full max-w-full place-items-center overflow-x-hidden bg-[radial-gradient(circle_at_50%_0%,rgba(100,245,164,.16),transparent_38%),linear-gradient(145deg,#07110d,#050907)] px-4 py-8 text-white">
      <section className="w-[calc(100vw-2rem)] max-w-sm rounded-[28px] border border-white/10 bg-[#0e1914]/95 p-5 text-center shadow-[0_30px_100px_rgba(0,0,0,.55)] min-[360px]:p-6">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#64f5a4] text-[#07110d] shadow-[0_0_38px_rgba(100,245,164,.3)]"><LockKeyhole size={27}/></span>
        <p className="mt-5 text-xs font-black uppercase tracking-[.2em] text-[#64f5a4]">Alleen voor aanwezige gasten</p>
        <h1 className="mt-2 text-3xl font-black tracking-[-.045em]">Vul de code van het scherm in</h1>
        <p className="mx-auto mt-3 max-w-xs text-sm leading-6 text-zinc-400">De zescijferige code staat bij de QR-code op de tv en wisselt automatisch.</p>
        <form onSubmit={joinParty} className="mt-6">
          <InputOTP autoFocus maxLength={6} inputMode="numeric" pattern="^[0-9]*$" value={joinCode} onChange={(value) => { setJoinCode(value.replace(/\D/g, "")); setJoinError(""); }} containerClassName="w-full justify-center" aria-label="Toegangscode">
            <InputOTPGroup className="gap-1 min-[360px]:gap-1.5 min-[390px]:gap-2">{Array.from({ length: 6 }, (_, index) => <InputOTPSlot key={index} index={index} className="h-12 w-8 rounded-xl border border-white/10 bg-white/[.06] text-lg font-black uppercase text-white shadow-none first:rounded-xl first:border last:rounded-xl min-[360px]:h-13 min-[360px]:w-9 min-[390px]:h-14 min-[390px]:w-10"/>)}</InputOTPGroup>
          </InputOTP>
          {joinError && <p role="alert" className="mt-3 text-sm font-semibold text-red-300">{joinError}</p>}
          <Button type="submit" disabled={joining || joinCode.length !== 6} className="mt-5 h-12 w-full rounded-xl bg-[#64f5a4] font-black text-[#07110d] hover:bg-[#8affba]">{joining ? <><Loader2 className="animate-spin"/>Controleren</> : "Meedoen"}</Button>
        </form>
        <p className="mt-5 text-xs text-zinc-600">Al toegelaten? Deze telefoon onthoudt dat vanzelf.</p>
      </section>
    </main>
  );

  return (
    <main className={`${hostMode ? "h-[100dvh] overflow-hidden" : "min-h-screen w-full max-w-full overflow-x-hidden"} bg-[radial-gradient(circle_at_75%_5%,rgba(81,255,168,.13),transparent_28%),linear-gradient(145deg,#07110d_0%,#0d1813_52%,#050907_100%)] text-white`}>
      <header className={`mx-auto flex min-w-0 max-w-7xl items-center justify-between px-3 min-[360px]:px-4 sm:px-8 ${hostMode ? "h-16" : "py-4 sm:py-5"}`}>
        <a href="/" className="flex items-center gap-3 font-black tracking-tight"><span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#64f5a4] text-[#07110d] shadow-[0_0_28px_rgba(100,245,164,.28)]"><Music2 size={21}/></span><span className="text-xl">Stem de Hit</span></a>
        <div className="flex items-center gap-2">{hostMode && <span className={`hidden rounded-full px-3 py-1 text-xs font-black sm:block ${autoDj ? "bg-[#64f5a4]/15 text-[#64f5a4]" : "bg-white/10 text-zinc-500"}`}>Auto-DJ {autoDj ? "aan" : "uit"}</span>}<Button variant="ghost" className="rounded-full text-zinc-300 hover:bg-white/10 hover:text-white" onClick={() => setShowHost(!showHost)}><Settings2 size={17}/><span className="hidden sm:inline">Hostinstellingen</span></Button></div>
      </header>

      <section className={`mx-auto grid min-w-0 max-w-7xl gap-4 px-3 min-[360px]:px-4 sm:px-8 ${hostMode ? "h-[calc(100dvh-4rem)] min-h-0 pb-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]" : "w-full max-w-full gap-6 pb-10 pt-1 sm:pb-16 sm:pt-3 lg:grid-cols-[minmax(0,1fr)_360px] lg:pt-8"}`}>
        <div className={hostMode ? "flex min-h-0 min-w-0 flex-col" : "min-w-0"}>
          {!hostMode && <div className="mb-5 min-w-0 max-w-2xl sm:mb-7"><p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[.16em] text-[#64f5a4] sm:mb-3 sm:text-sm sm:tracking-[.18em]"><PartyPopper size={16}/> Jij bepaalt wat hierna komt</p><h1 className="text-[clamp(2rem,11vw,2.35rem)] font-black leading-[.96] tracking-[-.055em] sm:text-6xl">Zoek. Stem.<br/><span className="text-zinc-500">Zet de avond aan.</span></h1></div>}
          {!hostMode && playback.active && playback.item && <div className="mb-4 flex items-center gap-3 rounded-2xl border border-[#64f5a4]/20 bg-[#0d1d15] p-3 shadow-xl lg:hidden">{playback.item.imageUrl ? <img src={playback.item.imageUrl} alt="Albumhoes" className="h-14 w-14 shrink-0 rounded-xl object-cover"/> : <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-white/10"><Music2/></span>}<div className="min-w-0 flex-1"><div className="mb-1 flex items-center justify-between gap-2"><span className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-[#64f5a4]"><Volume2 size={12}/>Nu speelt</span><span className="text-[11px] text-zinc-600">{formatDuration(playback.progressMs || 0)} / {formatDuration(playback.item.durationMs)}</span></div><h2 className="truncate font-black">{playback.item.name}</h2><p className="truncate text-sm text-zinc-500">{playback.item.artist}</p><div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[#64f5a4] transition-all" style={{ width: `${Math.min(100, Math.max(0, ((playback.progressMs || 0) / Math.max(1, playback.item.durationMs)) * 100))}%` }}/></div></div></div>}
          {hostMode && <div className="relative mb-3 overflow-hidden rounded-2xl border border-[#64f5a4]/20 bg-[linear-gradient(110deg,rgba(100,245,164,.12),rgba(255,255,255,.025))] px-5 py-3"><div className="absolute -right-8 -top-16 h-40 w-40 rounded-full bg-[#64f5a4]/10 blur-3xl"/><div className="relative flex items-end justify-between gap-5"><div><p className="mb-1 flex items-center gap-2 text-xs font-black uppercase tracking-[.18em] text-[#64f5a4]"><PartyPopper size={14}/>Jij bepaalt wat hierna komt</p><h1 className="text-2xl font-black leading-none tracking-[-.04em] sm:text-3xl">Zoek. Stem. <span className="text-zinc-500">Zet de avond aan.</span></h1></div><div className="hidden shrink-0 items-end gap-1.5 sm:flex" aria-hidden="true"><span className="h-3 w-1.5 animate-pulse rounded-full bg-[#64f5a4]/35"/><span className="h-7 w-1.5 animate-pulse rounded-full bg-[#64f5a4]/55 [animation-delay:150ms]"/><span className="h-5 w-1.5 animate-pulse rounded-full bg-[#64f5a4]/75 [animation-delay:300ms]"/><span className="h-9 w-1.5 animate-pulse rounded-full bg-[#64f5a4] [animation-delay:450ms]"/><span className="h-4 w-1.5 animate-pulse rounded-full bg-[#64f5a4]/60 [animation-delay:600ms]"/></div></div></div>}
          {!hostMode && <div className="mb-4 grid min-w-0 gap-2 rounded-2xl border border-fuchsia-400/15 bg-fuchsia-400/[.06] p-2.5 min-[390px]:grid-cols-[minmax(0,1fr)_auto] min-[390px]:items-center sm:p-3"><div className="min-w-0 pl-1"><p className="text-sm font-black text-fuchsia-100">Reageer live</p><p className="hidden text-xs text-zinc-500 sm:block">Verschijnt in Party Mode</p></div><div className="grid min-w-0 grid-cols-4 gap-1.5">{["🔥", "❤️", "🎉", "🙌"].map((emoji) => <button key={emoji} onClick={() => sendReaction(emoji)} aria-label={`Stuur ${emoji}`} className="grid h-11 min-w-0 touch-manipulation place-items-center rounded-xl border border-white/10 bg-white/[.06] text-xl transition hover:-translate-y-1 hover:border-fuchsia-300/40 hover:bg-fuchsia-300/10 active:scale-90 min-[390px]:w-11 sm:h-12 sm:w-12 sm:text-2xl">{emoji}</button>)}</div></div>}
          <div className="relative z-30">
            <form onSubmit={search} className="relative mb-2 min-w-0"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 sm:left-5" size={hostMode ? 19 : 22}/><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={configured ? "Zoek een nummer of artiest" : "Spotify wordt zo gekoppeld door de host"} disabled={!configured} className={`${hostMode ? "h-12" : "h-16"} min-w-0 rounded-2xl border-white/10 bg-white/[.07] pl-12 pr-24 text-base text-white placeholder:text-zinc-500 focus-visible:border-[#64f5a4]/70 focus-visible:ring-[#64f5a4]/20 sm:pl-14 sm:pr-28`}/><Button type="submit" disabled={searching || !configured} className={`absolute right-2 rounded-xl bg-[#64f5a4] px-3 font-bold text-[#06100b] hover:bg-[#8affba] sm:px-5 ${hostMode ? "top-1.5 h-9" : "top-2 h-12"}`}>{searching ? <Loader2 className="animate-spin"/> : "Zoeken"}</Button></form>
            {results.length > 0 && <div className={`${hostMode ? "absolute left-0 right-0 top-14 max-h-[55vh] overflow-y-auto" : "mb-8"} max-w-full overflow-hidden rounded-2xl border border-white/10 bg-[#111d17] shadow-2xl`}><div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-sm text-zinc-400 sm:px-5"><span>Spotify-resultaten</span><button onClick={() => setResults([])} aria-label="Sluiten"><X size={18}/></button></div>{results.map((track) => <button key={track.spotifyId} onClick={() => add(track)} disabled={busyId === -1} className="flex w-full min-w-0 items-center gap-2.5 border-b border-white/[.06] p-3 text-left last:border-0 hover:bg-white/[.06] sm:gap-3">{track.imageUrl ? <img src={track.imageUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover"/> : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-white/10"><Music2/></span>}<span className="min-w-0 flex-1"><strong className="block truncate text-[15px]">{track.name}</strong><span className="block truncate text-sm text-zinc-400">{track.artist}</span></span><span className="hidden shrink-0 text-xs text-zinc-500 min-[390px]:inline">{formatDuration(track.durationMs)}</span><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#64f5a4] text-xl font-bold text-[#07110d]">+</span></button>)}</div>}
          </div>
          {notice && <div className={`${hostMode ? "mb-2 py-2" : "my-4 py-3"} flex items-center gap-2 rounded-xl border border-[#64f5a4]/20 bg-[#64f5a4]/10 px-4 text-sm text-[#b9ffd5]`}><Sparkles size={16}/><span className="truncate">{notice}</span></div>}
          <div className={`${hostMode ? "mt-1 pb-2" : "mt-6 pb-3 sm:mt-8 sm:pb-4"} flex items-end justify-between border-b border-white/10`}><div><p className="text-sm text-zinc-500">De gezamenlijke volgorde</p><h2 className={`${hostMode ? "text-xl" : "text-2xl"} font-bold tracking-tight`}>Hierna</h2></div><span className="flex items-center gap-2 text-sm text-zinc-400"><Users size={16}/>{candidateTracks.length} {candidateTracks.length === 1 ? "verzoek" : "verzoeken"}</span></div>
          <div className="min-h-0 min-w-0 divide-y divide-white/[.07] overflow-hidden">
            {shownTracks.map((track, index) => <article key={track.id} className={`group flex min-w-0 items-center gap-2.5 sm:gap-3 ${hostMode ? "py-2" : "py-4"}`}><span className={`w-5 shrink-0 text-center text-sm font-black sm:w-6 ${index === 0 ? "text-[#64f5a4]" : "text-zinc-600"}`}>{index + 1}</span>{track.imageUrl ? <img src={track.imageUrl} alt="" className={`${hostMode ? "h-11 w-11" : "h-12 w-12 sm:h-14 sm:w-14"} shrink-0 rounded-xl object-cover shadow-lg`}/> : <span className={`${hostMode ? "h-11 w-11" : "h-12 w-12 sm:h-14 sm:w-14"} grid shrink-0 place-items-center rounded-xl bg-white/10`}><Music2/></span>}<div className="min-w-0 flex-1"><h3 className="truncate font-bold">{track.name}</h3><p className="truncate text-sm text-zinc-500">{track.artist} · {formatDuration(track.durationMs)}</p></div>{hostMode ? <div className="flex items-center gap-2"><span className="flex min-w-20 items-center justify-center gap-1 rounded-xl border border-[#64f5a4]/25 bg-[#64f5a4]/10 px-3 py-2 text-sm font-black text-[#64f5a4]"><Users size={15}/>{track.votes}</span><Button size="sm" onClick={() => playNext(track.id)} disabled={busyId === track.id} className="rounded-xl bg-white/10 text-white hover:bg-[#64f5a4] hover:text-[#07110d]"><Play size={16}/><span className="hidden xl:inline">Speel nu</span></Button></div> : <button onClick={() => vote(track.id)} disabled={busyId === track.id || track.hasVoted} aria-label={`Stem op ${track.name}`} className={`flex min-w-14 shrink-0 items-center justify-center gap-1 rounded-xl border px-2.5 py-2 font-black transition sm:min-w-16 sm:px-3 ${track.hasVoted ? "border-[#64f5a4]/30 bg-[#64f5a4]/15 text-[#64f5a4]" : "border-white/10 bg-white/[.05] hover:-translate-y-0.5 hover:border-[#64f5a4]/50 hover:bg-[#64f5a4]/10"}`}>{track.hasVoted ? <Check size={17}/> : <ChevronUp size={18}/>} {track.votes}</button>}</article>)}
            {hostMode && candidateTracks.length > 5 && <div className="py-2 text-center text-sm text-zinc-500">+ {candidateTracks.length - 5} nummers volgen daarna</div>}
            {queueFillTracks.length > 0 && <div className={hostMode ? "py-2" : "py-5"}><div className="mb-2 flex items-center gap-2 text-sm font-bold text-[#64f5a4]"><Headphones size={17}/>{candidateTracks.length > 0 ? "Daarna uit Spotify" : "Spotify gaat automatisch verder"}</div><div className="grid gap-2">{queueFillTracks.map((track, index) => <div key={`${track.spotifyId}-${index}`} className="flex min-w-0 items-center gap-2.5 rounded-xl bg-white/[.04] p-2.5 sm:gap-3">{hostMode && <span className="w-6 text-center text-xs font-black text-zinc-600">{shownTracks.length + index + 1}</span>}{track.imageUrl ? <img src={track.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover"/> : <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white/10"><Music2 size={17}/></span>}<span className="min-w-0 flex-1"><strong className="block truncate text-sm">{track.name}</strong><span className="block truncate text-xs text-zinc-500">{track.artist}</span></span>{hostMode ? <span className="rounded-lg bg-white/[.04] px-2 py-1 text-[11px] font-bold text-zinc-600">Spotify</span> : <button onClick={() => add(track)} disabled={busyId === -1} aria-label={`Stem op ${track.name}`} className="flex min-w-0 shrink-0 items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/[.05] px-2.5 py-2 text-sm font-black transition hover:-translate-y-0.5 hover:border-[#64f5a4]/50 hover:bg-[#64f5a4]/10 disabled:opacity-50 sm:min-w-20 sm:px-3"><ChevronUp size={17}/>Stem</button>}</div>)}</div></div>}
            {candidateTracks.length === 0 && queueFillTracks.length === 0 && <div className={`grid place-items-center rounded-2xl border border-dashed border-white/10 text-center ${hostMode ? "min-h-40" : "min-h-52"}`}><div><Headphones className="mx-auto mb-3 text-zinc-600" size={32}/><p className="font-semibold text-zinc-300">De dansvloer wacht nog</p><p className="mt-1 text-sm text-zinc-600">Spotify speelt verder zodra daar een afspeellijst actief is.</p></div></div>}
          </div>
        </div>

        <aside className={hostMode ? "flex min-h-0 flex-col gap-3" : "hidden space-y-5 lg:block lg:self-start"}>
          {hostMode && <div className="relative min-h-0 flex-1 overflow-hidden rounded-[28px] border border-[#64f5a4]/25 bg-[#0e1914] shadow-[0_24px_70px_rgba(0,0,0,.45)]">
            <div className={`absolute inset-0 flex flex-col p-5 transition-all duration-700 ${showQrCard || !topTrack ? "translate-x-0 opacity-100" : "-translate-x-8 opacity-0 pointer-events-none"}`}><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-white/10"><Smartphone size={20}/></span><div className="min-w-0 flex-1"><h3 className="font-bold">Scan & stem</h3><p className="text-xs text-zinc-500">Open de lijst op je telefoon</p></div><span className="rounded-full bg-[#64f5a4]/15 px-3 py-1 text-sm font-black text-[#64f5a4]">{voterCount} {voterCount === 1 ? "stemmer" : "stemmers"}</span></div><div className="grid min-h-0 flex-1 place-items-center py-2"><div className="grid aspect-square w-[min(24vh,11rem)] place-items-center overflow-hidden rounded-2xl bg-white p-3">{shareUrl ? <img src={`https://quickchart.io/qr?text=${encodeURIComponent(shareUrl)}&size=260&margin=1`} alt="QR-code naar deze verzoeklijst" className="h-full w-full"/> : <Loader2 className="animate-spin text-[#07110d]"/>}</div></div>{partyAccess && <div className="mb-2 flex shrink-0 items-center justify-between rounded-xl border border-[#64f5a4]/20 bg-[#64f5a4]/10 px-3 py-2"><span className="text-xs font-bold uppercase tracking-wider text-[#8bd7aa]">Toegangscode</span><strong className="font-mono text-xl tracking-[.18em] text-[#baffd4]">{partyAccess.code}</strong><span className="text-xs tabular-nums text-[#79ba96]">{formatCountdown(partyAccess.expiresInSeconds)}</span></div>}<Button variant="outline" disabled={!shareUrl} onClick={() => { void navigator.clipboard.writeText(shareUrl); setNotice("Link gekopieerd."); }} className="w-full shrink-0 rounded-xl border-white/10 bg-white/[.04] text-white hover:bg-white/10 hover:text-white"><Copy size={16}/>Kopieer link</Button></div>
            {topTrack && <div className={`absolute inset-0 flex flex-col p-5 transition-all duration-700 ${showQrCard ? "translate-x-8 opacity-0 pointer-events-none" : "translate-x-0 opacity-100"}`}><div className="flex items-center justify-between"><span className="rounded-full bg-[#64f5a4] px-3 py-1 text-xs font-black uppercase tracking-wider text-[#07110d]">Hierna #1</span><span className="text-sm font-bold text-[#64f5a4]">{topTrack.votes} {topTrack.votes === 1 ? "stem" : "stemmen"}</span></div><div className="grid min-h-0 flex-1 place-items-center py-3">{topTrack.imageUrl ? <img src={topTrack.imageUrl} alt="Albumhoes" className="aspect-square h-full max-h-[27vh] rounded-2xl object-cover shadow-2xl"/> : <span className="grid aspect-square h-full max-h-[27vh] place-items-center rounded-2xl bg-white/10"><Music2 size={42}/></span>}</div><div className="shrink-0"><h2 className="truncate text-2xl font-black tracking-tight">{topTrack.name}</h2><p className="truncate text-zinc-400">{topTrack.artist}</p></div></div>}
            {topTrack && <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 gap-1.5"><button onClick={() => setShowQrCard(true)} aria-label="Toon QR-code" className={`h-1.5 rounded-full transition-all ${showQrCard ? "w-6 bg-[#64f5a4]" : "w-1.5 bg-white/25"}`}/><button onClick={() => setShowQrCard(false)} aria-label="Toon nummer één" className={`h-1.5 rounded-full transition-all ${!showQrCard ? "w-6 bg-[#64f5a4]" : "w-1.5 bg-white/25"}`}/></div>}
          </div>}
          {playback.active && playback.item && <div className={`shrink-0 overflow-hidden rounded-[24px] border border-[#64f5a4]/20 bg-[#0d1d15] shadow-[0_30px_80px_rgba(0,0,0,.35)] ${hostMode ? "p-4" : "p-5"}`}><div className="mb-3 flex items-center justify-between"><span className="flex items-center gap-2 rounded-full bg-[#64f5a4] px-3 py-1 text-xs font-black uppercase tracking-wider text-[#07110d]"><Volume2 size={13}/>Nu speelt</span><span className="text-xs text-zinc-500">{playback.isPlaying ? playback.device?.name || "Spotify" : "Gepauzeerd"}</span></div><div className="flex items-center gap-4">{playback.item.imageUrl ? <img src={playback.item.imageUrl} alt="Albumhoes" className={`${hostMode ? "h-16 w-16" : "h-20 w-20"} rounded-2xl object-cover`}/> : <span className={`${hostMode ? "h-16 w-16" : "h-20 w-20"} grid place-items-center rounded-2xl bg-white/10`}><Music2/></span>}<div className="min-w-0"><h2 className={`${hostMode ? "text-lg" : "text-xl"} truncate font-black tracking-tight`}>{playback.item.name}</h2><p className="truncate text-sm text-zinc-400">{playback.item.artist}</p><p className="mt-1 text-xs text-zinc-600">{formatDuration(playback.progressMs || 0)} / {formatDuration(playback.item.durationMs)}</p></div></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[#64f5a4] transition-all" style={{ width: `${Math.min(100, Math.max(0, ((playback.progressMs || 0) / Math.max(1, playback.item.durationMs)) * 100))}%` }}/></div></div>}
          {!hostMode && topTrack && <div className="overflow-hidden rounded-[28px] border border-white/10 bg-white/[.06] p-5 shadow-[0_30px_80px_rgba(0,0,0,.35)]"><div className="mb-4 flex items-center justify-between"><span className="rounded-full bg-[#64f5a4] px-3 py-1 text-xs font-black uppercase tracking-wider text-[#07110d]">Hierna #1</span><span className="text-sm font-bold text-[#64f5a4]">{topTrack.votes} stemmen</span></div>{topTrack.imageUrl && <img src={topTrack.imageUrl} alt="Albumhoes" className="aspect-square w-full rounded-2xl object-cover"/>}<h2 className="mt-4 truncate text-2xl font-black tracking-tight">{topTrack.name}</h2><p className="truncate text-zinc-400">{topTrack.artist}</p></div>}
        </aside>
      </section>

      {hostMode && partyMode && <section className="fixed inset-0 z-40 overflow-hidden text-white transition-[background] duration-[2000ms]" style={{ background: partyTheme.background }}>
        <div className="pointer-events-none absolute -left-[12vw] -top-[24vh] h-[70vh] w-[70vh] animate-pulse rounded-full opacity-20 blur-[120px] transition-colors duration-[2000ms]" style={{ backgroundColor: partyTheme.secondary }}/>
        <div className="pointer-events-none absolute -bottom-[30vh] right-[2vw] h-[75vh] w-[75vh] animate-pulse rounded-full opacity-15 blur-[130px] transition-colors duration-[2000ms] [animation-delay:900ms]" style={{ backgroundColor: partyTheme.primary }}/>
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">{["♪","♫","♪","♬","♫","♪"].map((note, index) => <span key={index} className="absolute animate-bounce font-black text-white/[.06]" style={{ left: `${8 + index * 17}%`, top: `${16 + (index % 3) * 25}%`, fontSize: `${28 + (index % 3) * 16}px`, animationDuration: `${3.8 + index * .55}s`, animationDelay: `${index * .45}s` }}>{note}</span>)}</div>
        {leaderCelebration && topTrack && <div className="pointer-events-none absolute left-1/2 top-20 z-[34] -translate-x-1/2 animate-bounce rounded-full border border-white/15 bg-black/75 px-6 py-3 text-center shadow-[0_0_60px_rgba(255,255,255,.2)] backdrop-blur-xl"><p className="text-xs font-black uppercase tracking-[.2em]" style={{ color: partyTheme.primary }}>Nieuwe nummer 1</p><p className="mt-1 max-w-sm truncate text-lg font-black">{topTrack.name}</p></div>}
        <PartyReactionLayer adminCode={adminCode} onCombo={handleReactionCombo}/>
        <PartyConfettiLayer burst={confettiBurst}/>
        {newRequestTrack && <div key={newRequestTrack.id} className="party-new-request pointer-events-none absolute bottom-16 left-6 z-[34] flex max-w-sm items-center gap-4 rounded-[24px] border border-white/15 bg-black/75 p-4 shadow-[0_24px_80px_rgba(0,0,0,.55)] backdrop-blur-xl">{newRequestTrack.imageUrl ? <img src={newRequestTrack.imageUrl} alt="" className="h-16 w-16 shrink-0 rounded-2xl object-cover"/> : <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-white/10"><Music2/></span>}<div className="min-w-0"><p className="text-xs font-black uppercase tracking-[.18em]" style={{ color: partyTheme.primary }}>Nieuw verzoek binnen</p><h2 className="mt-1 truncate text-xl font-black">{newRequestTrack.name}</h2><p className="truncate text-sm text-zinc-400">{newRequestTrack.artist}</p></div></div>}
        {reactionCombo && <div key={reactionCombo.id} className={`party-combo-layer party-combo-${comboVisual.kind} pointer-events-none fixed inset-0 z-[38] grid place-items-center overflow-hidden`}><span className="party-combo-flash absolute inset-0" style={{ background: `radial-gradient(circle at center, ${partyTheme.primary}88 0%, ${partyTheme.secondary}38 34%, transparent 72%)` }}/>{[0, 1, 2].map((ring) => <span key={ring} className="party-combo-shockwave absolute left-1/2 top-1/2 h-32 w-32 rounded-full border-8" style={{ borderColor: ring === 1 ? partyTheme.secondary : partyTheme.primary, animationDelay: `${ring * .18}s` }}/>) }{Array.from({ length: 36 }, (_, index) => <span key={index} className="party-combo-particle absolute" style={{ left: `${1 + (index * 47) % 98}%`, fontSize: `${34 + (index % 4) * 10}px`, animationDelay: `${(index % 12) * .055}s`, animationDuration: `${1.45 + (index % 5) * .12}s`, ["--party-drift" as string]: `${index % 2 === 0 ? 1 : -1}${18 + (index % 5) * 7}px` }}>{comboVisual.emoji}</span>)}<div className="party-combo-banner relative z-10 rounded-[32px] border-2 border-white/25 bg-black/85 px-10 py-7 text-center shadow-[0_0_120px_rgba(255,255,255,.28)] backdrop-blur-xl"><p className="text-6xl">{comboVisual.emoji}</p><h2 className="mt-2 whitespace-nowrap text-5xl font-black tracking-[-.04em]">{comboVisual.title}</h2><p className="mt-2 text-lg font-bold text-zinc-200">{reactionCombo.count} reacties in 3 seconden</p></div></div>}
        {transitionTrack && <div className="party-track-transition pointer-events-none absolute inset-0 z-[36] grid place-items-center bg-black/80 p-8 text-center backdrop-blur-xl"><div className="max-w-3xl">{transitionTrack.imageUrl && <img src={transitionTrack.imageUrl} alt="" className="mx-auto mb-6 h-40 w-40 rounded-[28px] object-cover shadow-2xl"/>}<p className="text-sm font-black uppercase tracking-[.28em]" style={{ color: partyTheme.primary }}>Nu begint</p><h2 className="mt-3 line-clamp-2 text-5xl font-black tracking-[-.05em] lg:text-7xl">{transitionTrack.name}</h2><p className="mt-3 text-2xl font-semibold text-zinc-400">{transitionTrack.artist}</p></div></div>}
        <div className="relative flex h-full flex-col px-5 pb-16 pt-5 lg:px-7 lg:pb-[4.5rem] lg:pt-7">
          <header className="flex shrink-0 items-center justify-between gap-5"><div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl text-[#07110d] transition-colors duration-[2000ms]" style={{ backgroundColor: partyTheme.primary, boxShadow: `0 0 32px ${partyTheme.primary}55` }}><Music2 size={23}/></span><div><p className="text-lg font-black tracking-tight">Stem de Hit</p><p className="text-xs font-bold uppercase tracking-[.22em] transition-colors duration-[2000ms]" style={{ color: partyTheme.secondary }}>Party Mode · {partyTheme.name}</p></div></div><div className="flex items-center gap-2"><span className="hidden rounded-full border border-white/10 bg-white/[.05] px-3 py-2 text-sm font-bold text-zinc-300 sm:flex sm:items-center sm:gap-2"><Users size={15}/>{voterCount} {voterCount === 1 ? "stemmer" : "stemmers"}</span><Button variant="outline" onClick={() => void document.documentElement.requestFullscreen?.().catch(() => undefined)} className="rounded-xl border-white/10 bg-white/[.05] text-white hover:bg-white/10 hover:text-white"><Maximize2 size={17}/><span className="hidden sm:inline">Volledig scherm</span></Button><Button variant="outline" onClick={() => setShowHost(true)} className="rounded-xl border-white/10 bg-white/[.05] text-white hover:bg-white/10 hover:text-white"><Settings2 size={17}/><span className="hidden sm:inline">Instellingen</span></Button></div></header>

          <div className="mt-5 grid min-h-0 flex-1 gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(310px,.72fr)]">
            <div className="relative flex min-h-0 overflow-hidden rounded-[32px] border border-white/10 bg-white/[.045] p-6 shadow-[0_30px_100px_rgba(0,0,0,.5)]">
              {remainingSeconds !== null && remainingSeconds > 0 && remainingSeconds <= 15 && <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-black/55 backdrop-blur-sm"><div className="text-center"><p className="text-sm font-black uppercase tracking-[.28em]" style={{ color: partyTheme.primary }}>Volgende nummer over</p><span key={remainingSeconds} className="party-countdown-number mt-2 block text-[clamp(7rem,22vw,14rem)] font-black leading-none tracking-[-.08em]">{remainingSeconds}</span></div></div>}
              {playback.active && playback.item ? <div className="grid min-h-0 w-full items-center gap-7 lg:grid-cols-[minmax(260px,.9fr)_minmax(0,1.1fr)]"><div className="grid min-h-0 place-items-center">{playback.item.imageUrl ? <img src={playback.item.imageUrl} alt="Albumhoes" className="party-album-pulse aspect-square max-h-[62vh] w-full max-w-[min(58vh,34rem)] rounded-[28px] object-contain shadow-[0_32px_90px_rgba(0,0,0,.65)]"/> : <span className="party-album-pulse grid aspect-square w-full max-w-[min(58vh,34rem)] place-items-center rounded-[28px] bg-white/10"><Music2 size={70}/></span>}</div><div className="min-w-0"><span className="mb-5 inline-flex items-center gap-2 rounded-full bg-[#64f5a4] px-4 py-2 text-xs font-black uppercase tracking-[.16em] text-[#07110d]"><Volume2 size={15}/>Nu speelt</span><h1 className="line-clamp-2 text-5xl font-black leading-[.92] tracking-[-.055em] xl:text-7xl">{playback.item.name}</h1><p className="mt-4 truncate text-2xl font-semibold text-zinc-400 xl:text-3xl">{playback.item.artist}</p><div className="mt-8"><div className="mb-2 flex justify-between text-sm font-bold text-zinc-500"><span>{formatDuration(playback.progressMs || 0)}</span><span>{formatDuration(playback.item.durationMs)}</span></div><div className="h-2.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-fuchsia-400 to-[#64f5a4] transition-all duration-700" style={{ width: `${Math.min(100, Math.max(0, ((playback.progressMs || 0) / Math.max(1, playback.item.durationMs)) * 100))}%` }}/></div></div><div className="mt-7 flex h-12 items-end gap-2" aria-hidden="true">{[42,72,54,92,64,38,80,58,96,48,70,40].map((height, index) => <span key={index} className="w-2 animate-pulse rounded-full bg-gradient-to-t from-fuchsia-500 to-[#64f5a4]" style={{ height: `${height}%`, animationDelay: `${index * 90}ms` }}/>)}</div></div></div> : <div className="m-auto text-center"><span className="mx-auto grid h-24 w-24 place-items-center rounded-[30px] bg-white/[.06] text-zinc-600"><Headphones size={48}/></span><h1 className="mt-6 text-4xl font-black">Start Spotify op de laptop</h1><p className="mt-2 text-lg text-zinc-500">Party Mode springt vanzelf aan zodra de muziek speelt.</p></div>}
            </div>

            <aside className="flex min-h-0 flex-col gap-4"><div className="min-h-0 flex-1 overflow-hidden rounded-[28px] border border-white/10 bg-white/[.045] p-5"><div className="mb-4 flex items-center justify-between"><div><p className="text-xs font-black uppercase tracking-[.18em] text-[#64f5a4]">Live ranglijst</p><h2 className="mt-1 text-2xl font-black">Hierna</h2></div><span className="rounded-full bg-white/[.06] px-3 py-1.5 text-sm font-bold text-zinc-400">Top 5</span></div><div className="grid gap-3">{candidateTracks.slice(0, 5).map((track, index) => <div key={track.id} className={`flex items-center gap-3 rounded-2xl border p-3 ${index === 0 ? "border-[#64f5a4]/30 bg-[#64f5a4]/10" : "border-white/[.06] bg-white/[.035]"} ${voteFlashId === track.id ? "party-vote-flash" : ""}`}><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl text-sm font-black ${index === 0 ? "bg-[#64f5a4] text-[#07110d]" : "bg-white/10 text-zinc-400"}`}>{index + 1}</span>{track.imageUrl ? <img src={track.imageUrl} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover"/> : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white/10"><Music2 size={18}/></span>}<div className="min-w-0 flex-1"><h3 className="truncate font-black">{track.name}</h3><p className="truncate text-sm text-zinc-500">{track.artist}</p></div><span className="flex items-center gap-1 rounded-xl bg-black/20 px-2.5 py-2 text-sm font-black text-[#64f5a4]"><ChevronUp size={15}/>{track.votes}</span></div>)}{candidateTracks.length === 0 && playback.queue?.slice(0, 5).map((track, index) => <div key={`${track.spotifyId}-${index}`} className="flex items-center gap-3 rounded-2xl border border-white/[.06] bg-white/[.035] p-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white/10 text-sm font-black text-zinc-500">{index + 1}</span>{track.imageUrl ? <img src={track.imageUrl} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover"/> : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white/10"><Music2 size={18}/></span>}<div className="min-w-0"><h3 className="truncate font-bold">{track.name}</h3><p className="truncate text-sm text-zinc-500">{track.artist}</p></div></div>)}{candidateTracks.length === 0 && !playback.queue?.length && <div className="grid min-h-40 place-items-center rounded-2xl border border-dashed border-white/10 text-center text-zinc-600"><div><Music2 className="mx-auto mb-2"/><p>Nog geen nummers klaar</p></div></div>}</div></div>
              <button onClick={() => setPartyQrOpen(true)} className="flex shrink-0 items-center gap-4 rounded-[24px] border border-[#64f5a4]/20 bg-[#64f5a4]/10 p-4 text-left transition hover:bg-[#64f5a4]/15"><div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-xl bg-white p-1.5">{shareUrl ? <img src={`https://quickchart.io/qr?text=${encodeURIComponent(shareUrl)}&size=160&margin=1`} alt="QR-code" className="h-full w-full"/> : <QrCode className="text-[#07110d]"/>}</div><div className="min-w-0 flex-1"><p className="font-black text-[#baffd4]">Nog iemand laten stemmen?</p>{partyAccess ? <p className="mt-1 font-mono text-lg font-black tracking-[.15em] text-white">{partyAccess.code}</p> : <p className="mt-1 text-sm text-[#79ba96]">Klik om de QR-code groot te tonen</p>}</div><QrCode className="shrink-0 text-[#64f5a4]"/></button></aside>
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 z-[35] h-12 overflow-hidden border-t border-white/10 bg-black/65 backdrop-blur-xl"><div className="party-ticker-track flex h-full items-center">{[...tickerItems, ...tickerItems].map((item, index) => <span key={`${item}-${index}`} className="flex shrink-0 items-center gap-6 px-7 text-sm font-black tracking-wide text-white/90"><span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: partyTheme.primary }}/>{item}</span>)}</div></div>
      </section>}

      {hostMode && partyMode && partyQrOpen && <div className="fixed inset-0 z-[45] grid place-items-center bg-black/85 p-6 backdrop-blur-xl" onClick={() => setPartyQrOpen(false)}><div className="w-full max-w-md rounded-[32px] border border-white/10 bg-[#101914] p-7 text-center shadow-2xl" onClick={(event) => event.stopPropagation()}><div className="mb-5 flex items-center justify-between"><div className="text-left"><p className="text-xs font-black uppercase tracking-[.18em] text-[#64f5a4]">Scan & stem</p><h2 className="mt-1 text-2xl font-black">Doe mee met de muziek</h2></div><button onClick={() => setPartyQrOpen(false)} aria-label="Sluiten" className="grid h-10 w-10 place-items-center rounded-full bg-white/10"><X/></button></div><div className="mx-auto aspect-square w-full rounded-[24px] bg-white p-5">{shareUrl ? <img src={`https://quickchart.io/qr?text=${encodeURIComponent(shareUrl)}&size=520&margin=1`} alt="QR-code naar de verzoeklijst" className="h-full w-full"/> : <Loader2 className="m-auto animate-spin text-[#07110d]"/>}</div>{partyAccess && <div className="mt-4 rounded-2xl border border-[#64f5a4]/25 bg-[#64f5a4]/10 p-3"><p className="text-xs font-black uppercase tracking-[.18em] text-[#79ba96]">Vul deze code in</p><p className="mt-1 font-mono text-3xl font-black tracking-[.2em] text-[#baffd4]">{partyAccess.code}</p><p className="mt-1 text-xs tabular-nums text-[#79ba96]">Nieuwe code over {formatCountdown(partyAccess.expiresInSeconds)}</p></div>}<p className="mt-4 text-lg font-black text-[#64f5a4]">{voterCount} {voterCount === 1 ? "stemmer doet" : "stemmers doen"} al mee</p></div></div>}

      {showHost && <div className="fixed inset-0 z-50 grid place-items-end bg-black/70 p-0 backdrop-blur-sm sm:place-items-center sm:p-5" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowHost(false); }}>
        <section className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-[28px] border border-white/10 bg-[#101914] p-6 shadow-2xl sm:rounded-[28px] sm:p-8">
          <div className="mb-6 flex items-start justify-between"><div><p className="mb-2 flex items-center gap-2 text-sm font-bold text-[#64f5a4]"><LockKeyhole size={16}/>Alleen voor de host</p><h2 className="text-3xl font-black tracking-tight">Bedien de avond</h2></div><button onClick={() => setShowHost(false)} aria-label="Sluiten"><X/></button></div>
          <div className="mb-5 flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[.04] p-4"><div><label htmlFor="auto-dj" className="font-bold">Auto-DJ</label><p className="mt-1 text-sm text-zinc-500">Speel automatisch het nummer met de meeste stemmen.</p></div><Switch id="auto-dj" checked={autoDj} onCheckedChange={(next) => { setAutoDj(next); localStorage.setItem("stem-de-hit-auto-dj", String(next)); }}/></div>
          {hostMode && <div className="mb-5 flex items-center justify-between gap-4 rounded-2xl border border-fuchsia-400/20 bg-fuchsia-400/[.07] p-4"><div><label htmlFor="party-mode" className="font-bold text-fuchsia-100">Party Mode</label><p className="mt-1 text-sm text-zinc-500">Grote albumhoes, top drie, animaties en compacte QR-code.</p></div><Switch id="party-mode" checked={partyMode} onCheckedChange={(next) => { setPartyMode(next); setPartyQrOpen(false); localStorage.setItem("stem-de-hit-party-mode", String(next)); }}/></div>}
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
            <AlertDialog><AlertDialogTrigger asChild><Button variant="outline" className="w-full rounded-xl border-red-400/25 bg-red-400/5 text-red-200 hover:bg-red-400/15 hover:text-red-100"><RotateCcw size={16}/>Nieuwe sessie</Button></AlertDialogTrigger><AlertDialogContent className="border-white/10 bg-[#101914] text-white"><AlertDialogHeader><AlertDialogTitle>Nieuwe muzieksessie starten?</AlertDialogTitle><AlertDialogDescription className="text-zinc-400">Alle oude verzoeken en stemmen worden definitief gewist. De Spotify-koppeling blijft bewaard.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="border-white/10 bg-white/[.04] text-white hover:bg-white/10 hover:text-white">Annuleren</AlertDialogCancel><AlertDialogAction onClick={() => void startNewParty()} disabled={busyId === -3} className="bg-red-500 font-bold text-white hover:bg-red-400">Wis lijst en start opnieuw</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
            <Button onClick={() => setShowHost(false)} variant="outline" className="w-full border-white/10 bg-white/[.04] text-white hover:bg-white/10">Terug naar de hostlijst</Button>
          </div>}
        </section>
      </div>}
    </main>
  );
}
