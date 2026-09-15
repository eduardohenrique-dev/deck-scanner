import { ChevronRight } from "lucide-react";
import { relativeDay } from "../../lib/format";
import { Link } from "../../lib/router";
import type { Session } from "../../lib/types";
import { Lens, Scales } from "../icons";
import { Tag, type Tone } from "../ui";

const STATUS: Record<Session["status"], { label: string; tone: Tone }> = {
  capturing: { label: "capturando", tone: "info" },
  processing: { label: "lendo cartas", tone: "info" },
  review: { label: "para revisar", tone: "warn" },
  saved: { label: "guardado", tone: "ok" },
  error: { label: "com erro", tone: "bad" },
};

export default function SessionRow({ session }: { session: Session }) {
  const status = STATUS[session.status] ?? STATUS.review;
  const isCheck = session.purpose === "check";
  return (
    <li>
      <Link
        to={`/s/${session.id}`}
        className="group flex items-center gap-3 rounded-[5px] px-3 py-2.5 transition-colors hover:bg-oak-750/70"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-full border border-oak-600 bg-oak-900 text-brass-300">
          {isCheck ? <Scales size={20} /> : <Lens size={20} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-serif text-[17px] font-semibold text-cream group-hover:text-brass-200">
            {session.name || (isCheck ? `Conferência de ${session.target_deck_name ?? "deck"}` : "Scan sem nome")}
          </span>
          <span className="block truncate text-[14px] text-cream-faint">
            {isCheck ? "conferência" : session.mode === "video" ? "vídeo" : "fotos"} · {session.card_count ?? 0} cartas · {relativeDay(session.updated_at)}
            {session.saved_deck_name ? ` · no deck ${session.saved_deck_name}` : ""}
          </span>
        </span>
        <Tag tone={status.tone}>{status.label}</Tag>
        <ChevronRight className="size-4 text-cream-faint group-hover:text-brass-300" />
      </Link>
    </li>
  );
}
