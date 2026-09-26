import { ChevronRight } from "lucide-react";
import { relativeDay } from "../../lib/format";
import { Link } from "../../lib/router";
import type { Session } from "../../lib/types";
import { Lens, Scales } from "../icons";
import { Tag, type Tone } from "../ui";

const STATUS: Record<Session["status"], { label: string; tone: Tone }> = {
  capturing: { label: "Capturando", tone: "info" },
  processing: { label: "Lendo cartas", tone: "info" },
  review: { label: "Para revisar", tone: "warn" },
  saved: { label: "Guardado", tone: "ok" },
  error: { label: "Com erro", tone: "bad" },
};

export default function SessionRow({ session }: { session: Session }) {
  const status = STATUS[session.status] ?? STATUS.review;
  const isCheck = session.purpose === "check";
  return (
    <li>
      <Link
        to={`/s/${session.id}`}
        className="group flex min-h-16 items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-mist/5"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-arcane-300/10 text-arcane-300 shadow-[inset_0_0_0_1px_rgb(185_164_255/0.18)]">
          {isCheck ? <Scales size={20} /> : <Lens size={20} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-serif text-headline font-semibold text-mist group-hover:text-arcane-100">
            {session.name || (isCheck ? `Conferência de ${session.target_deck_name ?? "deck"}` : "Scan sem nome")}
          </span>
          <span className="block truncate text-footnote text-mist-faint">
            <span className="sm:hidden">{status.label} · </span>
            {isCheck ? "conferência" : session.mode === "video" ? "vídeo" : "fotos"} · {session.card_count ?? 0} cartas · {relativeDay(session.updated_at)}
            {session.saved_deck_name ? ` · no deck ${session.saved_deck_name}` : ""}
          </span>
        </span>
        <Tag tone={status.tone} className="max-sm:hidden">{status.label}</Tag>
        <ChevronRight className="size-4 shrink-0 text-mist-faint group-hover:text-arcane-300" />
      </Link>
    </li>
  );
}
