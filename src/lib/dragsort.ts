// Long-press drag & drop reordering and selection for note cards.
export const dragState = { block: false, selecting: false };

export function moveNote<T extends { id: string }>(ns: T[], from: string, to: string, insertAfter = false): T[] {
  const a = ns.findIndex((n) => n.id === from);
  let b = ns.findIndex((n) => n.id === to);
  if (a < 0 || b < 0 || a === b) return ns;
  const arr = [...ns];
  const [item] = arr.splice(a, 1);
  if (insertAfter) {
    b = arr.findIndex((n) => n.id === to);
    arr.splice(b + 1, 0, item);
  } else {
    b = arr.findIndex((n) => n.id === to);
    arr.splice(b, 0, item);
  }
  return arr;
}

export function startNoteDrag(
  e: React.PointerEvent<HTMLElement>,
  ids: string[],
  onReorder: (from: string, to: string, insertAfter?: boolean) => void,
  onLongPressSelect?: (id: string) => void,
  isSelectionActive = false
) {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  const el = e.currentTarget as HTMLElement;
  const id = el.dataset.noteId as string;
  const sx = e.clientX, sy = e.clientY;
  let x = sx, y = sy, active = false, over: HTMLElement | null = null, raf = 0;
  let placeholder: HTMLElement | null = null;
  let offsetX = 0, offsetY = 0;
  let hasMoved = false;

  const updatePlaceholderPosition = (targetEl: HTMLElement | null) => {
    if (!placeholder) return;
    if (!targetEl || targetEl === el) return;

    const rect = targetEl.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const parent = targetEl.parentNode;
    if (!parent) return;

    if (y < midY) {
      if (placeholder.nextSibling !== targetEl) {
        parent.insertBefore(placeholder, targetEl);
      }
    } else {
      if (placeholder.previousSibling !== targetEl) {
        parent.insertBefore(placeholder, targetEl.nextSibling);
      }
    }
  };

  const findOver = () => {
    const prev = el.style.pointerEvents;
    el.style.pointerEvents = "none";
    if (placeholder) placeholder.style.pointerEvents = "none";
    const t = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-note-id]") ?? null;
    el.style.pointerEvents = prev;
    if (placeholder) placeholder.style.pointerEvents = "";

    const tid = t?.dataset.noteId;
    const next = t && tid !== id && ids.includes(tid as string) ? t : null;
    over = next;
    if (over) {
      updatePlaceholderPosition(over);
    }
  };

  const tick = () => {
    if (!active) return;
    if (y < 90) window.scrollBy(0, -12);
    else if (y > window.innerHeight - 100) window.scrollBy(0, 12);
    el.style.left = `${x - offsetX}px`;
    el.style.top = `${y - offsetY}px`;
    findOver();
    raf = requestAnimationFrame(tick);
  };

  const startDraggingVisuals = () => {
    active = true;
    const rect = el.getBoundingClientRect();
    offsetX = sx - rect.left;
    offsetY = sy - rect.top;

    placeholder = document.createElement("div");
    placeholder.className = "note-drag-placeholder mb-2 w-full break-inside-avoid rounded-xl border-2 border-dashed border-primary/50 bg-primary/10 transition-all duration-150";
    placeholder.style.height = `${rect.height}px`;

    el.parentNode?.insertBefore(placeholder, el);

    el.style.position = "fixed";
    el.style.width = `${rect.width}px`;
    el.style.left = `${rect.left}px`;
    el.style.top = `${rect.top}px`;
    el.style.margin = "0";
    el.classList.add("note-dragging");

    el.style.touchAction = "none";
    navigator.vibrate?.(15);
    tick();
  };

  // Timer:
  // If selection is NOT active: long press initiates selection ONLY (no drag)!
  // If selection IS active: long press initiates drag & drop!
  const timer = window.setTimeout(() => {
    if (hasMoved) return;

    if (!isSelectionActive) {
      if (onLongPressSelect) {
        navigator.vibrate?.(25);
        onLongPressSelect(id);
        dragState.block = true;
        window.setTimeout(() => {
          dragState.block = false;
        }, 140);
      }
      cleanListeners();
      return;
    }

    if (isSelectionActive) {
      startDraggingVisuals();
    }
  }, 320);

  const onMove = (m: PointerEvent) => {
    x = m.clientX;
    y = m.clientY;
    if (Math.hypot(x - sx, y - sy) > 8) {
      hasMoved = true;
      // Moving before long-press timer fired means scrolling, so cancel drag/select
      if (!active) {
        window.clearTimeout(timer);
      }
    }
  };

  const onTouchMove = (t: TouchEvent) => {
    if (active && t.cancelable) t.preventDefault();
  };

  const onUp = () => end(true);
  const onCancel = () => end(false);

  function cleanListeners() {
    window.clearTimeout(timer);
    cancelAnimationFrame(raf);
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onCancel);
    document.removeEventListener("touchmove", onTouchMove);
  }

  function end(commit: boolean) {
    cleanListeners();

    if (!active) return;
    active = false;
    el.classList.remove("note-dragging");
    el.style.removeProperty("position");
    el.style.removeProperty("width");
    el.style.removeProperty("left");
    el.style.removeProperty("top");
    el.style.removeProperty("margin");
    el.style.removeProperty("touch-action");

    let targetId: string | undefined = undefined;
    let insertAfter = false;

    if (placeholder && placeholder.parentNode) {
      let nextCard = placeholder.nextElementSibling as HTMLElement | null;
      while (nextCard && (!nextCard.dataset.noteId || nextCard.dataset.noteId === id)) {
        nextCard = nextCard.nextElementSibling as HTMLElement | null;
      }

      if (nextCard?.dataset.noteId) {
        targetId = nextCard.dataset.noteId;
        insertAfter = false;
      } else {
        let prevCard = placeholder.previousElementSibling as HTMLElement | null;
        while (prevCard && (!prevCard.dataset.noteId || prevCard.dataset.noteId === id)) {
          prevCard = prevCard.previousElementSibling as HTMLElement | null;
        }
        if (prevCard?.dataset.noteId) {
          targetId = prevCard.dataset.noteId;
          insertAfter = true;
        }
      }

      placeholder.parentNode.removeChild(placeholder);
    }

    placeholder = null;
    over = null;

    dragState.block = true;
    window.setTimeout(() => {
      dragState.block = false;
    }, 80);

    if (commit && targetId && targetId !== id) {
      onReorder(id, targetId, insertAfter);
    }
  }

  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
  document.addEventListener("pointercancel", onCancel);
  document.addEventListener("touchmove", onTouchMove, { passive: false });
}
