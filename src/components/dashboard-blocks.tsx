"use client";

import { GripVertical } from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

export interface DashboardBlock {
  id: string;
  label: string;
  content: ReactNode;
}

const STORAGE_KEY = "treadlogger.dashboardOrder.v1";

/** Keeps the saved relative order of blocks that still exist, and appends
 * any block the caller passes that wasn't in the saved list (a block added
 * in a later release, or the very first load with nothing saved yet) at the
 * end in its default position — so a code change can't corrupt or silently
 * drop the user's custom layout. */
function reconcileOrder(saved: string[], defaultIds: string[]): string[] {
  const known = new Set(defaultIds);
  const kept = saved.filter((id) => known.has(id));
  const seen = new Set(kept);
  const missing = defaultIds.filter((id) => !seen.has(id));
  return [...kept, ...missing];
}

function loadSavedOrder(): string[] | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const ids = parsed.filter((id): id is string => typeof id === "string");
    return ids.length > 0 ? ids : null;
  } catch {
    return null;
  }
}

function persistOrder(order: string[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
  } catch {
    // Best-effort only — a private-browsing/quota error just means the
    // custom order resets to default next load, nothing worse.
  }
}

interface DragContext {
  pointerId: number;
  blockId: string;
  el: HTMLElement;
  placeholder: HTMLDivElement;
  offsetX: number;
  offsetY: number;
}

const DRAGGING_CLASSES = ["shadow-2xl", "cursor-grabbing", "pointer-events-none", "scale-[1.01]"];

/**
 * Renders `blocks` as a vertical stack, each one preceded by a small
 * drag-handle strip. Press-and-drag the handle with a mouse, or long-press
 * it (400ms) on touch, to pick a block up and drop it elsewhere in the
 * stack — the rest of the list makes room live, and the dropped block
 * animates ("snaps") into its new slot rather than jumping there. The
 * chosen order is remembered in localStorage, per browser/device.
 *
 * Mechanically this reuses the same pointer-driven drag/placeholder/snap
 * pattern already used for reordering blocks inside the interval workout
 * builder (public/interval-builder-mockup.html): direct DOM manipulation
 * during the drag itself, for smooth tracking without a React re-render on
 * every pointermove, with the result only committed back to React state
 * (and localStorage) once the drop animation finishes. Each block's content
 * is a stable React element the caller passes in, so dragging never
 * unmounts/remounts it — a chart mid-render, a live BLE connection, focused
 * form input, etc. all survive being picked up and moved.
 */
export function DashboardBlocks({ blocks }: { blocks: DashboardBlock[] }) {
  const defaultIds = blocks.map((b) => b.id);
  const defaultOrderKey = defaultIds.join("|");

  const [order, setOrder] = useState<string[]>(defaultIds);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragCtxRef = useRef<DragContext | null>(null);

  // The saved order is only read after mount: the server (and the first
  // client render, before hydration) has no localStorage to read, so both
  // always render the default order. This effect then reconciles to
  // whatever was actually saved — a one-time reflow on load rather than a
  // hydration mismatch.
  useEffect(() => {
    const saved = loadSavedOrder();
    if (saved) setOrder(reconcileOrder(saved, defaultIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If the set of blocks this page passes in ever changes (a block added or
  // removed in a later release), reconcile rather than let a stale saved
  // order silently drop the new one or point at one that no longer exists.
  useEffect(() => {
    setOrder((prev) => {
      const next = reconcileOrder(prev, defaultIds);
      const unchanged = next.length === prev.length && next.every((id, i) => id === prev[i]);
      return unchanged ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultOrderKey]);

  function commitOrder(next: string[]) {
    setOrder(next);
    persistOrder(next);
  }

  function getDragAfterElement(container: HTMLElement, y: number, placeholder: HTMLElement) {
    let closestOffset = -Infinity;
    let closestEl: HTMLElement | null = null;
    for (const child of Array.from(container.children) as HTMLElement[]) {
      if (child === placeholder) continue;
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closestOffset) {
        closestOffset = offset;
        closestEl = child;
      }
    }
    return closestEl;
  }

  function onDragMove(e: PointerEvent) {
    const ctx = dragCtxRef.current;
    const container = containerRef.current;
    if (!ctx || !container || e.pointerId !== ctx.pointerId) return;
    e.preventDefault();
    ctx.el.style.left = `${e.clientX - ctx.offsetX}px`;
    ctx.el.style.top = `${e.clientY - ctx.offsetY}px`;

    const after = getDragAfterElement(container, e.clientY, ctx.placeholder);
    if (after == null) container.appendChild(ctx.placeholder);
    else if (after !== ctx.placeholder) container.insertBefore(ctx.placeholder, after);
  }

  function onDragEnd(e: PointerEvent) {
    const ctx = dragCtxRef.current;
    const container = containerRef.current;
    if (!ctx || e.pointerId !== ctx.pointerId) return;
    document.removeEventListener("pointermove", onDragMove);
    document.removeEventListener("pointerup", onDragEnd);
    document.removeEventListener("pointercancel", onDragEnd);
    document.documentElement.classList.remove("overscroll-none", "touch-none");

    const { el, placeholder } = ctx;
    const target = placeholder.getBoundingClientRect();

    el.style.transition = "left .18s ease, top .18s ease, box-shadow .18s ease";
    el.style.left = `${target.left}px`;
    el.style.top = `${target.top}px`;

    let finished = false;
    const fallback = window.setTimeout(finish, 240);
    el.addEventListener("transitionend", finish, { once: true });

    function finish() {
      if (finished) return;
      finished = true;
      window.clearTimeout(fallback);

      // Put the real block back where the placeholder was standing in for
      // it — this both restores it to the container (it was reparented to
      // <body> for the duration of the drag, see startDrag) at the correct
      // slot, and removes the placeholder in the same step.
      placeholder.replaceWith(el);

      el.style.position = "";
      el.style.left = "";
      el.style.top = "";
      el.style.width = "";
      el.style.margin = "";
      el.style.zIndex = "";
      el.style.transition = "";
      el.classList.remove(...DRAGGING_CLASSES);
      dragCtxRef.current = null;

      // Now every child of the container is a real block in its final
      // dropped order — read it straight off the DOM.
      const nextOrder = container
        ? (Array.from(container.children) as HTMLElement[])
            .map((child) => child.dataset.blockId ?? "")
            .filter((id): id is string => id.length > 0)
        : null;

      if (nextOrder && nextOrder.length === defaultIds.length) commitOrder(nextOrder);
    }
  }

  function startDrag(id: string, pointerId: number, clientX: number, clientY: number) {
    const container = containerRef.current;
    const wrapper = container?.querySelector<HTMLElement>(`[data-block-id="${id}"]`);
    if (!container || !wrapper) return;
    const rect = wrapper.getBoundingClientRect();

    const placeholder = document.createElement("div");
    placeholder.className = "rounded-xl border-2 border-dashed border-border bg-foreground/[0.03]";
    placeholder.style.height = `${rect.height}px`;
    wrapper.before(placeholder);

    // Move the dragged block out of the container entirely (mirrors the
    // interval builder mockup's own `document.body.appendChild(card)`) so
    // the placeholder alone represents its slot in the list while it's
    // being dragged — otherwise the block would count twice (once as
    // itself, still sitting in its original spot, and once via the
    // placeholder) when the final order is read back off the DOM on drop.
    document.body.appendChild(wrapper);

    wrapper.style.position = "fixed";
    wrapper.style.left = `${rect.left}px`;
    wrapper.style.top = `${rect.top}px`;
    wrapper.style.width = `${rect.width}px`;
    wrapper.style.margin = "0";
    wrapper.style.zIndex = "50";
    wrapper.classList.add(...DRAGGING_CLASSES);

    dragCtxRef.current = {
      pointerId,
      blockId: id,
      el: wrapper,
      placeholder,
      offsetX: clientX - rect.left,
      offsetY: clientY - rect.top,
    };

    document.documentElement.classList.add("overscroll-none", "touch-none");
    document.addEventListener("pointermove", onDragMove);
    document.addEventListener("pointerup", onDragEnd);
    document.addEventListener("pointercancel", onDragEnd);
  }

  // Mirrors the interval builder's own handle logic: a mouse can start
  // dragging as soon as it moves past a small threshold, but a touch/pen
  // pointer needs to hold still for a beat first (400ms), so an ordinary
  // scroll-by-touch through the dashboard doesn't get mistaken for a drag.
  function handlePointerDown(e: ReactPointerEvent<HTMLButtonElement>, id: string) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    const pointerId = e.pointerId;
    const pointerType = e.pointerType;
    const startX = e.clientX;
    const startY = e.clientY;
    let longPressTimer: number | undefined;

    function cleanup() {
      window.clearTimeout(longPressTimer);
      document.removeEventListener("pointermove", onPendingMove);
      document.removeEventListener("pointerup", onPendingUp);
      document.removeEventListener("pointercancel", onPendingUp);
    }
    function onPendingMove(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (Math.hypot(dx, dy) > 6) {
        cleanup();
        if (pointerType === "mouse") startDrag(id, pointerId, ev.clientX, ev.clientY);
      }
    }
    function onPendingUp(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return;
      cleanup();
    }

    document.addEventListener("pointermove", onPendingMove);
    document.addEventListener("pointerup", onPendingUp);
    document.addEventListener("pointercancel", onPendingUp);

    if (pointerType !== "mouse") {
      longPressTimer = window.setTimeout(() => {
        cleanup();
        startDrag(id, pointerId, e.clientX, e.clientY);
      }, 400);
    }
  }

  const byId = new Map(blocks.map((b) => [b.id, b]));

  return (
    <div ref={containerRef} className="space-y-4">
      {order.map((id) => {
        const block = byId.get(id);
        if (!block) return null;
        return (
          <div key={id} data-block-id={id}>
            <div className="mb-1.5 flex items-center gap-1">
              <button
                type="button"
                aria-label={`Drag to reorder ${block.label}`}
                onPointerDown={(e) => handlePointerDown(e, id)}
                className="text-muted-foreground hover:text-foreground hover:bg-muted -ml-1.5 flex h-10.5 w-9 shrink-0 touch-none cursor-grab items-center justify-center rounded-md transition-colors active:cursor-grabbing"
              >
                <GripVertical className="size-4" />
              </button>
              <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase select-none">
                {block.label}
              </span>
            </div>
            {block.content}
          </div>
        );
      })}
    </div>
  );
}
