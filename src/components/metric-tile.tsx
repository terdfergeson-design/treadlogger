import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** One reading in the live dashboard grid. */
export function MetricTile({
  label,
  value,
  unit,
  icon: Icon,
  emphasis = false,
  valueClassName,
}: {
  label: string;
  value: string;
  unit?: string;
  icon?: LucideIcon;
  /** Marks the headline metrics, which get a larger readout. */
  emphasis?: boolean;
  valueClassName?: string;
}) {
  return (
    <div className="bg-card flex flex-col justify-between rounded-xl border p-3 sm:p-4">
      <div className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide">
        {Icon ? <Icon className="size-3.5" /> : null}
        {label}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span
          className={cn(
            "font-mono font-bold tabular-nums leading-none",
            emphasis ? "text-3xl sm:text-4xl" : "text-2xl sm:text-3xl",
            valueClassName,
          )}
        >
          {value}
        </span>
        {unit ? <span className="text-muted-foreground text-xs sm:text-sm">{unit}</span> : null}
      </div>
    </div>
  );
}
