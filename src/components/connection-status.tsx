import { cn } from "@/lib/utils";
import type { ConnectionState } from "@/lib/ble/types";

const LABELS: Record<ConnectionState, string> = {
  unsupported: "Not supported",
  idle: "Not connected",
  requesting: "Choose a device",
  connecting: "Connecting",
  connected: "Connected",
  disconnected: "Disconnected",
  error: "Error",
};

const DOT_CLASSES: Record<ConnectionState, string> = {
  unsupported: "bg-muted-foreground",
  idle: "bg-muted-foreground",
  requesting: "bg-amber-500 animate-pulse",
  connecting: "bg-amber-500 animate-pulse",
  connected: "bg-primary",
  disconnected: "bg-destructive",
  error: "bg-destructive",
};

/** Compact status dot and label shared by both device cards. */
export function ConnectionStatus({
  state,
  className,
}: {
  state: ConnectionState;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-xs font-medium", className)}>
      <span
        aria-hidden
        className={cn("size-2 shrink-0 rounded-full", DOT_CLASSES[state])}
      />
      <span className={state === "connected" ? "text-foreground" : "text-muted-foreground"}>
        {LABELS[state]}
      </span>
    </span>
  );
}

export function connectionLabel(state: ConnectionState): string {
  return LABELS[state];
}
