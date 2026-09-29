import { Award, BadgeCheck, Users } from "lucide-react";

import { type Maturity, MATURITY, type Owner, initials } from "@/lib/solutions";
import { cn } from "@/lib/utils";

const MATURITY_STYLE: Record<Maturity, { className: string; Icon: typeof Award }> = {
  community: { className: "border-border bg-muted text-muted-foreground", Icon: Users },
  validated: { className: "border-success/30 bg-success/10 text-success", Icon: BadgeCheck },
  featured: { className: "border-warning/40 bg-warning/10 text-warning", Icon: Award },
};

export function MaturityBadge({ maturity, className }: { maturity: Maturity; className?: string }) {
  const { className: tone, Icon } = MATURITY_STYLE[maturity];
  return (
    <span
      title={MATURITY[maturity].body}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold whitespace-nowrap",
        tone,
        className,
      )}
    >
      <Icon className="size-3" />
      {MATURITY[maturity].label}
    </span>
  );
}

const AVATAR_COLORS = ["#2f7c83", "#c46a26", "#2f5f9e", "#8a5a2b", "#6b4fa0", "#3f7d4e"];
const colorFor = (name: string) =>
  AVATAR_COLORS[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % AVATAR_COLORS.length]!;

export function OwnerAvatar({ owner, size = 24 }: { owner: Owner; size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full border-2 border-card font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: owner.role === "Sample" ? "#8a8070" : colorFor(owner.name),
      }}
      title={[owner.name, owner.role, owner.team].filter(Boolean).join(" · ")}
    >
      {owner.role === "Sample" ? "S" : initials(owner.name)}
    </span>
  );
}

export function OwnerLine({ owners }: { owners: Owner[] }) {
  const [first, ...rest] = owners;
  if (!first) return <span className="text-[11.5px] text-danger">No owner</span>;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="flex -space-x-1.5">
        {owners.slice(0, 3).map((o) => (
          <OwnerAvatar key={`${o.email}${o.name}`} owner={o} />
        ))}
      </span>
      <span className="min-w-0 truncate text-[11.5px]">
        <b className="font-semibold text-foreground">{first.name}</b>
        {first.role && <span className="text-muted-foreground"> · {first.role}</span>}
        {rest.length > 0 && <span className="text-muted-foreground"> +{rest.length}</span>}
      </span>
    </span>
  );
}
