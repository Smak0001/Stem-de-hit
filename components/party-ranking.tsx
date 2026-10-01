import { ChevronUp, Music2 } from "lucide-react";
import { fillPartyQueue } from "@/lib/auto-dj";

type Entry = { spotifyId: string; name: string; artist: string; imageUrl: string | null; id?: number; votes?: number };
export function PartyRanking({ candidates, queue, flashId }: { candidates: Entry[]; queue: Entry[]; flashId: number | null }) {
  const entries = fillPartyQueue(candidates, queue);
  return <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px] border border-white/10 bg-white/[.045] p-4">
    <div className="mb-3 flex shrink-0 items-center justify-between"><div><p className="text-xs font-black uppercase tracking-[.18em] text-[#64f5a4]">Live ranglijst</p><h2 className="mt-1 text-2xl font-black">Hierna</h2></div><span className="rounded-full bg-white/[.06] px-3 py-1.5 text-sm font-bold text-zinc-400">Top 5</span></div>
    <ol className="grid min-h-0 flex-1 gap-2" style={{ gridTemplateRows: `repeat(${Math.max(1, entries.length)}, minmax(0, 1fr))` }}>
      {entries.map((track, index) => <li key={track.spotifyId} className={`flex min-h-0 items-center gap-2 overflow-hidden rounded-xl border px-3 py-1 ${index === 0 ? "border-[#64f5a4]/30 bg-[#64f5a4]/10" : "border-white/[.06] bg-white/[.035]"} ${track.id !== undefined && flashId === track.id ? "party-vote-flash" : ""}`}>
        <span className="shrink-0 text-sm font-black text-[#64f5a4]">{index + 1}</span>
        {track.imageUrl ? <img src={track.imageUrl} alt="" className="aspect-square max-h-full w-10 shrink-0 rounded-lg object-cover"/> : <Music2 className="h-8 w-8 shrink-0 text-zinc-500"/>}
        <div className="min-w-0 flex-1"><h3 className="truncate font-bold">{track.name}</h3><p className="truncate text-sm text-zinc-400">{track.artist}</p></div>
        <span aria-label={`${track.votes || 0} stemmen`} className="flex shrink-0 items-center text-sm font-black text-[#64f5a4]"><ChevronUp size={15}/>{track.votes || 0}</span>
      </li>)}
      {!entries.length && <li className="grid place-items-center text-sm text-zinc-400">Nog geen nummers klaar</li>}
    </ol>
  </section>;
}
