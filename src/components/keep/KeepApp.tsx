import { useEffect, useMemo, useState } from "react";
import {
  Menu, Search, LayoutGrid, Rows3, Plus, CheckSquare, Pin, PinOff, Archive, ArchiveRestore,
  Trash2, RotateCcw, Palette, Tag, Lightbulb, ArrowLeft, X, Square, Copy, StickyNote,
  Sun, Moon, Settings, Type, Bold, Italic, Underline, Strikethrough, Check, Eye, EyeOff,
} from "lucide-react";
import { renderMarkdown } from "@/lib/markdown";
import { processFileAttachment, Attachment } from "@/lib/fileThumb";
import { dragState, moveNote, startNoteDrag } from "@/lib/dragsort";

type Item = { id: string; text: string; done: boolean };
type TextSize = "small" | "medium" | "large";
type TextColor = "default" | "red" | "blue" | "green" | "purple";
type Note = {
  id: string; title: string; body: string; type: "text" | "list"; items: Item[];
  attachment?: Attachment;
  color: string; pinned: boolean; archived: boolean; trashed: boolean; labels: string[]; updated: number;
  textSize?: TextSize; textColor?: TextColor; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; md?: boolean; dir?: "rtl" | "ltr";
};
type View = { kind: "notes" | "archive" | "trash" } | { kind: "label"; label: string };
type Theme = "light" | "dark";
type ThemeColor = "amber" | "emerald" | "blue" | "purple" | "rose" | "orange";
type Font = "manrope" | "serif" | "mono";

const THEME_COLORS: { id: ThemeColor; name: string; bg: string }[] = [
  { id: "amber", name: "Amber", bg: "#f59e0b" },
  { id: "emerald", name: "Emerald", bg: "#10b981" },
  { id: "blue", name: "Ocean", bg: "#3b82f6" },
  { id: "purple", name: "Violet", bg: "#8b5cf6" },
  { id: "rose", name: "Rose", bg: "#f43f5e" },
  { id: "orange", name: "Sunset", bg: "#f97316" },
];

const COLORS: Record<string, string> = {
  default: "bg-note-default", red: "bg-note-red", orange: "bg-note-orange", yellow: "bg-note-yellow",
  green: "bg-note-green", teal: "bg-note-teal", blue: "bg-note-blue", pink: "bg-note-pink", gray: "bg-note-gray",
};
const TEXT_COLORS: Record<TextColor, string> = {
  default: "text-foreground", red: "text-ink-red", blue: "text-ink-blue", green: "text-ink-green", purple: "text-ink-purple",
};
const TEXT_SIZES: Record<TextSize, string> = { small: "text-sm", medium: "text-base", large: "text-xl" };
const uid = () => Math.random().toString(36).slice(2, 10);
const KEY = "keep-notes-v1";
const LKEY = "keep-labels-v1";
const SETTINGS_KEY = "keep-settings-v1";

const blank = (type: "text" | "list"): Note => ({
  id: uid(), title: "", body: "", type, items: type === "list" ? [{ id: uid(), text: "", done: false }] : [],
  color: "default", pinned: false, archived: false, trashed: false, labels: [], updated: Date.now(),
  textSize: "medium", textColor: "default", bold: false, italic: false, underline: false, strike: false,
});

function noteTextClass(note: Note) {
  return [TEXT_SIZES[note.textSize ?? "medium"], TEXT_COLORS[note.textColor ?? "default"], note.bold && "font-bold", note.italic && "italic", note.underline && "underline", note.strike && "line-through"].filter(Boolean).join(" ");
}

function safeSaveNotes(ns: Note[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ns));
  } catch (err) {
    console.warn("Storage quota exceeded, stripping large base64 thumbnails:", err);
    try {
      const lightweight = ns.map((n) => {
        if (n.attachment?.thumb?.startsWith("data:")) {
          const { thumb, ...rest } = n.attachment;
          return { ...n, attachment: rest };
        }
        return n;
      });
      localStorage.setItem(KEY, JSON.stringify(lightweight));
    } catch (e2) {
      console.error("Failed to save notes:", e2);
    }
  }
}

export function KeepApp() {
  const [notes, setNotes] = useState<Note[]>(() => {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [labels, setLabels] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(LKEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
      return ["light", "dark"].includes(s.theme) ? s.theme : "light";
    } catch {
      return "light";
    }
  });
  const [themeColor, setThemeColor] = useState<ThemeColor>(() => {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
      return ["amber", "emerald", "blue", "purple", "rose", "orange"].includes(s.themeColor) ? s.themeColor : "amber";
    } catch {
      return "amber";
    }
  });
  const [font, setFont] = useState<Font>(() => {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
      return ["manrope", "serif", "mono"].includes(s.font) ? s.font : "manrope";
    } catch {
      return "manrope";
    }
  });
  const [view, setView] = useState<View>({ kind: "notes" });
  const [drawer, setDrawer] = useState(false);
  const [settings, setSettings] = useState(false);
  const [grid, setGrid] = useState(true);
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [editing, setEditing] = useState<Note | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [serverLoaded, setServerLoaded] = useState(false);

  // Initial sync with backend server (survives any port change or new device)
  useEffect(() => {
    fetch("/api/data")
      .then((r) => (r.ok ? r.json() : null))
      .then((serverData) => {
        if (!serverData) {
          setServerLoaded(true);
          return;
        }
        const serverNotes = Array.isArray(serverData.notes) ? serverData.notes : [];
        const serverLabels = Array.isArray(serverData.labels) ? serverData.labels : [];
        const serverSettings = serverData.settings && typeof serverData.settings === "object" ? serverData.settings : {};

        if (serverNotes.length > 0 || serverLabels.length > 0 || Object.keys(serverSettings).length > 0) {
          setNotes(serverNotes);
          safeSaveNotes(serverNotes);
          if (serverLabels.length > 0) {
            setLabels(serverLabels);
            try { localStorage.setItem(LKEY, JSON.stringify(serverLabels)); } catch {}
          }
          if (["light", "dark"].includes(serverSettings.theme)) setTheme(serverSettings.theme);
          if (["amber", "emerald", "blue", "purple", "rose", "orange"].includes(serverSettings.themeColor)) setThemeColor(serverSettings.themeColor);
          if (["manrope", "serif", "mono"].includes(serverSettings.font)) setFont(serverSettings.font);
        } else {
          // If server data.json is genuinely empty, migrate current browser notes/settings to server
          const localRaw = localStorage.getItem(KEY);
          if (localRaw) {
            try {
              const localNotes = JSON.parse(localRaw);
              if (Array.isArray(localNotes) && localNotes.length > 0) {
                setNotes(localNotes);
                fetch("/api/data", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ notes: localNotes, labels, settings: { theme, font, themeColor } }),
                }).catch(() => {});
              }
            } catch {}
          }
        }
        setServerLoaded(true);
      })
      .catch(() => {
        setServerLoaded(true);
      });
  }, []);

  useEffect(() => {
    if (!serverLoaded) return; // Prevent overwriting data.json with empty state before initial fetch!

    safeSaveNotes(notes);
    try {
      localStorage.setItem(LKEY, JSON.stringify(labels));
    } catch {}
    const timer = setTimeout(() => {
      fetch("/api/data", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes, labels, settings: { theme, font, themeColor } }),
      }).catch(() => {});
    }, 400);
    return () => clearTimeout(timer);
  }, [notes, labels, theme, font, themeColor, serverLoaded]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.dataset["font"] = font;
    document.documentElement.dataset["themeColor"] = themeColor;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme, font, themeColor }));
    } catch {}
  }, [theme, font, themeColor]);

  // Handle hardware / gesture back button
  useEffect(() => {
    if (!editing && !settings && !drawer) return;
    const onPopState = () => {
      if (editing) setEditing(null);
      else if (settings) setSettings(false);
      else if (drawer) setDrawer(false);
    };
    window.history.pushState({ modal: true }, "");
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [Boolean(editing), settings, drawer]);

  const isNoteEmpty = (n: Note) =>
    !n.attachment && !n.title.trim() && !n.body.trim() && !n.items.some((i) => i.text.trim());

  const saveEditing = (n: Note) => {
    const empty = isNoteEmpty(n);
    setNotes((ns) => {
      const exists = ns.some((x) => x.id === n.id);
      if (empty) return ns.filter((x) => x.id !== n.id);
      return exists ? ns.map((x) => (x.id === n.id ? n : x)) : [n, ...ns];
    });
    setEditing(null);
  };

  const updateEditingNote = (n: Note) => {
    const empty = isNoteEmpty(n);
    setNotes((ns) => {
      const exists = ns.some((x) => x.id === n.id);
      if (exists) {
        return empty ? ns.filter((x) => x.id !== n.id) : ns.map((x) => (x.id === n.id ? n : x));
      }
      return empty ? ns : [n, ...ns];
    });
  };

  const reorder = (from: string, to: string, insertAfter?: boolean) => setNotes((ns) => moveNote(ns, from, to, insertAfter));

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const clearSelection = () => setSelectedIds([]);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((curr) => (curr === msg ? null : curr)), 2200);
  };

  const deleteSelected = () => {
    if (view.kind === "trash") {
      setNotes((ns) => ns.filter((n) => !selectedIds.includes(n.id)));
    } else {
      setNotes((ns) => ns.map((n) => (selectedIds.includes(n.id) ? { ...n, trashed: true, pinned: false } : n)));
    }
    clearSelection();
  };
  const pinSelected = () => {
    const anyUnpinned = notes.some((n) => selectedIds.includes(n.id) && !n.pinned);
    setNotes((ns) => ns.map((n) => (selectedIds.includes(n.id) ? { ...n, pinned: anyUnpinned } : n)));
    clearSelection();
  };
  const archiveSelected = () => {
    const anyUnarchived = notes.some((n) => selectedIds.includes(n.id) && !n.archived);
    setNotes((ns) => ns.map((n) => (selectedIds.includes(n.id) ? { ...n, archived: anyUnarchived, pinned: false } : n)));
    clearSelection();
    showToast(anyUnarchived ? "Archived" : "Unarchived");
  };


  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return notes.filter((n) => {
      if (view.kind === "trash") return n.trashed;
      if (n.trashed) return false;
      if (view.kind === "archive") return n.archived;
      if (view.kind === "label") return n.labels.includes(view.label);
      return !n.archived;
    }).filter((n) => !s || [n.title, n.body, ...n.items.map((i) => i.text)].join(" ").toLowerCase().includes(s))
  }, [notes, view, q]);

  const pinned = visible.filter((n) => n.pinned && view.kind !== "trash");
  const others = visible.filter((n) => !n.pinned || view.kind === "trash");
  const title = view.kind === "label" ? view.label : view.kind === "notes" ? "Notes" : view.kind === "archive" ? "Archive" : "Trash";
  const isDark = theme === "dark";
  const cycleTheme = () => setTheme(isDark ? "light" : "dark");
  const ThemeIcon = isDark ? Moon : Sun;

  return (
    <div className="mx-auto min-h-screen max-w-xl bg-background pb-28 text-foreground transition-colors duration-500">
      <header className="sticky top-0 z-20 px-3 pt-3 pb-2 pointer-events-none">
        {selectedIds.length > 0 ? (
          <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-primary/40 bg-card/95 px-3 py-1.5 shadow-lg backdrop-blur-xl animate-in fade-in duration-200">
            <IconBtn label="Clear selection" onClick={clearSelection}><X className="size-5 text-foreground" /></IconBtn>
            <span className="min-w-0 flex-1 font-bold text-foreground text-sm pl-1">{selectedIds.length} selected</span>
            {view.kind !== "trash" && (
              <>
                <IconBtn label="Pin" onClick={pinSelected}><Pin className="size-5" /></IconBtn>
                <IconBtn label="Archive" onClick={archiveSelected}><Archive className="size-5" /></IconBtn>
              </>
            )}
            <IconBtn label="Delete" onClick={deleteSelected}><Trash2 className="size-5 text-destructive" /></IconBtn>
          </div>
        ) : (
          <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-border/60 bg-muted/95 px-2 py-1.5 shadow-md backdrop-blur-xl transition-all duration-300">
            <IconBtn label="Menu" onClick={() => setDrawer(true)}><Menu className="size-5" /></IconBtn>
            {searching ? (
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your notes"
                className="min-w-0 flex-1 bg-transparent px-1 text-base outline-none animate-in fade-in" />
            ) : (
              <button onClick={() => setSearching(true)} className="min-w-0 flex-1 truncate text-start text-base text-muted-foreground transition-colors hover:text-foreground">
                {title === "Notes" ? "Search your notes" : title}
              </button>
            )}
            {searching ? <IconBtn label="Close search" onClick={() => { setSearching(false); setQ(""); }}><X className="size-5" /></IconBtn>
              : <IconBtn label="Search" onClick={() => setSearching(true)}><Search className="size-5" /></IconBtn>}
            <IconBtn label={`Theme: ${theme}`} onClick={cycleTheme}><ThemeIcon className="size-5 transition-transform duration-500" /></IconBtn>
            <IconBtn label="Switch layout" onClick={() => setGrid(!grid)}>{grid ? <Rows3 className="size-5" /> : <LayoutGrid className="size-5" />}</IconBtn>
            <IconBtn label="Settings" onClick={() => setSettings(true)}><Settings className="size-5" /></IconBtn>
          </div>
        )}
      </header>

      {view.kind === "trash" && notes.some((n) => n.trashed) && (
        <div className="flex items-center justify-between px-4 py-2 text-sm text-muted-foreground animate-in slide-in-from-top-2">
          <span>Notes stay here until you empty the trash.</span>
          <button className="font-bold text-destructive transition-transform active:scale-95" onClick={() => setNotes((ns) => ns.filter((n) => !n.trashed))}>Empty</button>
        </div>
      )}

      <main key={view.kind + (view.kind === "label" ? view.label : "")} className="view-transition px-2 pb-28">
        {visible.length === 0 ? <Empty view={view} /> : <>
          {pinned.length > 0 && <Section label="PINNED" notes={pinned} grid={grid} onOpen={setEditing} onReorder={reorder} selectedIds={selectedIds} onSelect={toggleSelect} />}
          {others.length > 0 && <Section label={pinned.length ? "OTHERS" : ""} notes={others} grid={grid} onOpen={setEditing} onReorder={reorder} selectedIds={selectedIds} onSelect={toggleSelect} />}
        </>}
      </main>

      {view.kind !== "trash" && selectedIds.length === 0 && (
        <>
          {fabOpen && (
            <>
              <div
                className="fixed inset-0 z-30 bg-background/50 backdrop-blur-sm animate-in fade-in duration-200"
                onClick={() => setFabOpen(false)}
              />
              <div className="fab-menu">
                <button
                  onClick={() => { setFabOpen(false); setEditing(withLabel(blank("list"), view)); }}
                  style={{ animationDelay: "60ms" }}
                  className="fab-item"
                >
                  <CheckSquare className="size-4 text-primary" /> List
                </button>
                <button
                  onClick={() => { setFabOpen(false); setEditing(withLabel(blank("text"), view)); }}
                  style={{ animationDelay: "0ms" }}
                  className="fab-item"
                >
                  <StickyNote className="size-4 text-primary" /> Text
                </button>
              </div>
            </>
          )}

          <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-xl">
            <button
              aria-label="Add note"
              onClick={() => setFabOpen(!fabOpen)}
              className="absolute -top-7 right-4 z-20 grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg transition-all duration-300 hover:scale-105 active:scale-95"
            >
              <Plus
                className={`size-8 transition-transform duration-300 ${fabOpen ? "rotate-45" : "rotate-0"}`}
              />
            </button>

            <div className="relative flex h-16 items-center gap-2 border-t bg-card/95 px-4 shadow-[0_-2px_10px_-4px_var(--color-border)] backdrop-blur-xl">
              <IconBtn label="New checklist" onClick={() => setEditing(withLabel(blank("list"), view))}><CheckSquare className="size-6" /></IconBtn>
              <IconBtn label="New note" onClick={() => setEditing(withLabel(blank("text"), view))}><StickyNote className="size-6" /></IconBtn>
            </div>
          </div>
        </>
      )}

      {drawer && <Drawer view={view} labels={labels} onClose={() => setDrawer(false)} onSettings={() => { setDrawer(false); setSettings(true); }}
        onPick={(v) => { setView(v); setDrawer(false); }} onAddLabel={(l) => !labels.includes(l) && setLabels([...labels, l])}
        onDeleteLabel={(l) => { setLabels(labels.filter((x) => x !== l)); setNotes((ns) => ns.map((n) => ({ ...n, labels: n.labels.filter((x) => x !== l) }))); if (view.kind === "label" && view.label === l) setView({ kind: "notes" }); }} />}

      {settings && <SettingsSheet theme={theme} themeColor={themeColor} font={font} onTheme={setTheme} onThemeColor={setThemeColor} onFont={setFont} onClose={() => setSettings(false)} />}

      {editing && <Editor key={editing.id} initial={editing} labels={labels} onChange={updateEditingNote} onClose={(n) => { if (n.archived !== editing.archived) showToast(n.archived ? "Archived" : "Unarchived"); saveEditing(n); }}
        onDelete={(n) => { setNotes((ns) => ns.filter((x) => x.id !== n.id)); setEditing(null); }}
        onTrash={(n) => saveEditing({ ...n, trashed: true, pinned: false })} onRestore={(n) => saveEditing({ ...n, trashed: false })} />}

      {toast && (
        <div className="fixed bottom-20 inset-x-0 z-50 mx-auto flex justify-center pointer-events-none animate-in fade-in slide-in-from-bottom-4 duration-200">
          <div className="rounded-full bg-foreground text-background px-5 py-2 text-sm font-semibold shadow-2xl backdrop-blur-md">
            {toast}
          </div>
        </div>
      )}
    </div>
  );

  function withLabel(n: Note, v: View): Note { return v.kind === "label" ? { ...n, labels: [v.label] } : n; }
}

function IconBtn({ children, label, onClick, active }: { children: React.ReactNode; label: string; onClick?: () => void; active?: boolean }) {
  return <button aria-label={label} title={label} onClick={onClick}
    className={`grid size-10 shrink-0 place-items-center rounded-full transition-all duration-200 hover:scale-105 hover:bg-foreground/8 active:scale-85 ${active ? "bg-foreground/10 text-foreground" : "text-foreground/75"}`}>{children}</button>;
}

function Section({ label, notes, grid, onOpen, onReorder, selectedIds, onSelect }: { label: string; notes: Note[]; grid: boolean; onOpen: (n: Note) => void; onReorder: (from: string, to: string, insertAfter?: boolean) => void; selectedIds: string[]; onSelect: (id: string) => void }) {
  const ids = notes.map((n) => n.id);
  const isSelecting = selectedIds.length > 0;
  return <section className="mb-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
    {label && <h2 className="px-3 pt-2 pb-2 text-xs font-bold tracking-wide text-muted-foreground">{label}</h2>}
    <div className={grid ? "masonry" : "flex flex-col gap-2"}>{notes.map((n, index) => (
      <Card
        key={n.id}
        note={n}
        index={index}
        selected={selectedIds.includes(n.id)}
        onOpen={() => {
          if (dragState.block) return;
          if (isSelecting) onSelect(n.id);
          else onOpen(n);
        }}
        onDrag={(ev) => startNoteDrag(ev, ids, onReorder, onSelect, isSelecting)}
      />
    ))}</div>
  </section>;
}

function Card({ note, onOpen, index, onDrag, selected }: { note: Note; onOpen: () => void; index: number; onDrag: (e: React.PointerEvent<HTMLElement>) => void; selected: boolean }) {
  const open = note.items.filter((i) => !i.done && i.text.trim());
  const done = note.items.filter((i) => i.done && i.text.trim());
  return <button onClick={onOpen} data-note-id={note.id} dir={note.dir} onPointerDown={onDrag} onContextMenu={(e) => e.preventDefault()} style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
    className={`note-card mb-2 block w-full break-inside-avoid rounded-xl border p-3 text-start opacity-0 ${COLORS[note.color]} ${note.color !== "default" ? "border-transparent" : ""} ${selected ? "note-selected" : ""}`}>
    {note.attachment?.thumb ? (
      <div className="mb-2 -mx-3 -mt-3 overflow-hidden rounded-t-xl bg-black/10">
        <img src={note.attachment.thumb} alt="thumbnail" className="max-h-52 w-full object-cover" />
      </div>
    ) : note.attachment ? (
      <div className="mb-2 -mx-3 -mt-3 flex items-center gap-2 border-b bg-foreground/5 p-2.5 rounded-t-xl text-xs font-medium">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4 shrink-0 text-primary"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
        <span className="truncate">{note.attachment.name}</span>
      </div>
    ) : null}
    {note.pinned && <Pin className="float-right ml-2 size-4 opacity-55" />}
    {note.title && <h3 className="mb-1 line-clamp-2 font-bold">{note.title}</h3>}
    {note.type === "text" ? note.body && <p className={`line-clamp-[10] whitespace-pre-wrap leading-relaxed ${noteTextClass(note)}`}>{note.body}</p> :
      <ul className={`space-y-1 ${noteTextClass(note)}`}>{open.slice(0, 8).map((i) => <li key={i.id} className="flex items-start gap-2"><Square className="mt-0.5 size-4 shrink-0 opacity-60" /><span className="min-w-0 break-words">{i.text}</span></li>)}
        {done.length > 0 && <li className="pt-1 text-xs text-muted-foreground">+ {done.length} completed</li>}</ul>}
    {note.labels.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{note.labels.map((l) => <span key={l} className="rounded-full bg-foreground/10 px-2 py-0.5 text-[11px]">{l}</span>)}</div>}
  </button>;
}

function Empty({ view }: { view: View }) {
  const map = { notes: [Lightbulb, "Notes you add appear here"], archive: [Archive, "Archived notes appear here"], trash: [Trash2, "Your trash is empty"], label: [Tag, "No notes with this label yet"] } as const;
  const [Icon, text] = map[view.kind];
  return <div className="flex flex-col items-center justify-center gap-4 pt-32 text-center text-muted-foreground animate-in zoom-in-95 duration-500"><Icon className="empty-icon size-24 text-primary" strokeWidth={1.2} /><p className="text-lg">{text}</p></div>;
}

function Drawer({ view, labels, onClose, onPick, onAddLabel, onDeleteLabel, onSettings }: {
  view: View; labels: string[]; onClose: () => void; onPick: (v: View) => void; onAddLabel: (l: string) => void; onDeleteLabel: (l: string) => void; onSettings: () => void;
}) {
  const [newL, setNewL] = useState("");
  const isActive = (v: View) => v.kind === view.kind && (v.kind !== "label" || (view.kind === "label" && view.label === v.label));
  const Row = ({ v, icon: Icon, text }: { v: View; icon: typeof Lightbulb; text: string }) => <button onClick={() => onPick(v)} className={`flex w-full items-center gap-5 rounded-r-full px-6 py-3.5 text-start font-medium transition-all duration-200 hover:translate-x-1 ${isActive(v) ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}><Icon className="size-5 shrink-0" /><span className="truncate">{text}</span></button>;
  return <div className="fixed inset-0 z-40">
    <div className="absolute inset-0 bg-foreground/30 backdrop-blur-[2px] animate-in fade-in" onClick={onClose} />
    <aside className="absolute inset-y-0 left-0 w-[82%] max-w-xs overflow-y-auto bg-card py-4 shadow-xl animate-in slide-in-from-left duration-300">
      <div className="mb-3 flex items-center gap-2 px-6 text-2xl font-extrabold"><span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground"><Lightbulb className="size-5" /></span>Keeply</div>
      <Row v={{ kind: "notes" }} icon={Lightbulb} text="Notes" />
      <div className="mt-3 px-6 pb-1 text-xs font-bold text-muted-foreground">LABELS</div>
      {labels.map((l) => <div key={l} className="flex items-center"><div className="min-w-0 flex-1"><Row v={{ kind: "label", label: l }} icon={Tag} text={l} /></div><button aria-label="Delete label" onClick={() => onDeleteLabel(l)} className="px-3 text-muted-foreground transition-transform hover:rotate-90"><X className="size-4" /></button></div>)}
      <form className="flex items-center gap-2 px-6 py-2" onSubmit={(e) => { e.preventDefault(); if (newL.trim()) { onAddLabel(newL.trim()); setNewL(""); } }}><Plus className="size-5 shrink-0 text-muted-foreground" /><input value={newL} onChange={(e) => setNewL(e.target.value)} placeholder="Create new label" className="min-w-0 flex-1 border-b bg-transparent py-1 outline-none transition-colors focus:border-primary" /></form>
      <div className="my-2 border-t" /><Row v={{ kind: "archive" }} icon={Archive} text="Archive" /><Row v={{ kind: "trash" }} icon={Trash2} text="Trash" />
      <button onClick={onSettings} className="flex w-full items-center gap-5 px-6 py-3.5 text-start font-medium transition-all hover:translate-x-1 hover:bg-muted"><Settings className="size-5" />Settings</button>
    </aside>
  </div>;
}

function SettingsSheet({ theme, themeColor, font, onTheme, onThemeColor, onFont, onClose }: {
  theme: Theme; themeColor: ThemeColor; font: Font; onTheme: (t: Theme) => void; onThemeColor: (c: ThemeColor) => void; onFont: (f: Font) => void; onClose: () => void;
}) {
  return <div className="fixed inset-0 z-50 flex items-end justify-center">
    <div className="absolute inset-0 bg-foreground/30 backdrop-blur-[2px] animate-in fade-in" onClick={onClose} />
    <section className="relative w-full max-w-xl rounded-t-3xl bg-card px-5 pt-3 pb-8 shadow-2xl animate-in slide-in-from-bottom duration-300">
      <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-border" />
      <div className="mb-6 flex items-center justify-between"><h2 className="text-xl font-bold">Settings</h2><IconBtn label="Close settings" onClick={onClose}><X className="size-5" /></IconBtn></div>
      <SettingGroup title="Theme"><div className="grid grid-cols-2 gap-2">{(["light", "dark"] as Theme[]).map((t) => { const Icon = t === "light" ? Sun : Moon; return <Choice key={t} active={theme === t} onClick={() => onTheme(t)}><Icon className="size-5" />{t.charAt(0).toUpperCase() + t.slice(1)}</Choice>; })}</div></SettingGroup>
      <SettingGroup title="Theme Color">
        <div className="grid grid-cols-3 gap-2">
          {THEME_COLORS.map(({ id, name, bg }) => (
            <button
              key={id}
              onClick={() => onThemeColor(id)}
              className={`relative flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-xl border p-2.5 text-xs font-semibold transition-all duration-200 active:scale-95 ${
                themeColor === id
                  ? "border-primary bg-accent text-accent-foreground shadow-sm"
                  : "bg-background hover:-translate-y-0.5 hover:border-foreground/30 text-foreground"
              }`}
            >
              <span className="flex size-6 items-center justify-center rounded-full shadow-sm" style={{ backgroundColor: bg }}>
                {themeColor === id && <Check className="size-3.5 text-white drop-shadow" />}
              </span>
              <span>{name}</span>
            </button>
          ))}
        </div>
      </SettingGroup>
      <SettingGroup title="Font"><div className="grid grid-cols-3 gap-2">{(["manrope", "serif", "mono"] as Font[]).map((f) => <Choice key={f} active={font === f} onClick={() => onFont(f)}><Type className="size-5" /><span className={`font-preview-${f}`}>{f === "manrope" ? "Modern" : f === "serif" ? "Classic" : "Mono"}</span></Choice>)}</div></SettingGroup>
    </section>
  </div>;
}

function SettingGroup({ title, children }: { title: string; children: React.ReactNode }) { return <div className="mb-6"><h3 className="mb-2 text-xs font-bold tracking-wide text-muted-foreground">{title.toUpperCase()}</h3>{children}</div>; }
function Choice({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button onClick={onClick} className={`relative flex min-h-20 flex-col items-center justify-center gap-2 rounded-lg border text-sm font-medium transition-all duration-200 active:scale-95 ${active ? "border-primary bg-accent" : "bg-background hover:-translate-y-0.5 hover:border-foreground/30"}`}>{children}{active && <Check className="absolute right-2 top-2 size-3.5" />}</button>; }

function Editor({ initial, labels, onClose, onDelete, onTrash, onRestore, onChange }: {
  initial: Note; labels: string[]; onClose: (n: Note) => void; onDelete: (n: Note) => void; onTrash: (n: Note) => void; onRestore: (n: Note) => void; onChange?: (n: Note) => void;
}) {
  const [preview, setPreview] = useState(false);
  const [n, setN] = useState<Note>(initial);
  const [panel, setPanel] = useState<"none" | "color" | "label" | "format">("none");
  const set = (p: Partial<Note>) => {
    setN((prev) => {
      const updated = { ...prev, ...p, updated: Date.now() };
      onChange?.(updated);
      return updated;
    });
  };
  const setItem = (id: string, p: Partial<Item>) => set({ items: n.items.map((i) => i.id === id ? { ...i, ...p } : i) });
  const handleEnter = (currentId: string) => {
    const idx = n.items.findIndex((x) => x.id === currentId);
    const ni = { id: uid(), text: "", done: false };
    const items = [...n.items];
    items.splice(idx + 1, 0, ni);
    set({ items });
    setTimeout(() => (document.querySelector(`[data-item="${ni.id}"]`) as HTMLInputElement)?.focus(), 0);
  };
  const handleDeleteItem = (id: string) => set({ items: n.items.filter((x) => x.id !== id) });
  const ro = n.trashed;
  const openItems = n.items.filter((i) => !i.done), doneItems = n.items.filter((i) => i.done);


  return <div className={`fixed inset-0 z-50 mx-auto flex max-w-xl flex-col ${COLORS[n.color] ?? COLORS["default"]} editor-transition`}>
    <div className="flex items-center gap-1 px-2 py-2"><IconBtn label="Back" onClick={() => onClose(n)}><ArrowLeft className="size-6" /></IconBtn><div className="flex-1" />{ro ? <><IconBtn label="Restore" onClick={() => onRestore(n)}><RotateCcw className="size-5" /></IconBtn><IconBtn label="Delete forever" onClick={() => onDelete(n)}><Trash2 className="size-5" /></IconBtn></> : <>{n.md && n.type === "text" && <IconBtn label={preview ? "Show raw text" : "Show markdown"} active={preview} onClick={() => setPreview(!preview)}>{preview ? <EyeOff className="size-5" /> : <Eye className="size-5" />}</IconBtn>}<IconBtn label={n.pinned ? "Unpin" : "Pin"} onClick={() => set({ pinned: !n.pinned })}>{n.pinned ? <PinOff className="size-5" /> : <Pin className="size-5" />}</IconBtn><IconBtn label={n.archived ? "Unarchive" : "Archive"} onClick={() => onClose({ ...n, archived: !n.archived, pinned: false })}>{n.archived ? <ArchiveRestore className="size-5" /> : <Archive className="size-5" />}</IconBtn></>}</div>
    <div dir={n.dir} className="flex-1 overflow-y-auto px-5 pb-6">
      {n.attachment && (
        <div className="relative mb-3 overflow-hidden rounded-2xl border border-border/80 bg-foreground/5">
          {n.attachment.thumb ? (
            <img src={n.attachment.thumb} alt="attachment thumbnail" className="max-h-72 w-full object-cover" />
          ) : (
            <div className="flex items-center gap-3 p-4">
              <span className="grid size-11 place-items-center rounded-xl bg-primary/15 text-primary">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-6"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-foreground text-sm">{n.attachment.name}</p>
                <p className="text-xs text-muted-foreground">{Math.round(n.attachment.size / 1024)} KB</p>
              </div>
            </div>
          )}
          {!ro && (
            <button
              onClick={() => set({ attachment: undefined })}
              className="absolute right-2 top-2 grid size-8 place-items-center rounded-full bg-black/60 text-white backdrop-blur-md transition-transform hover:scale-110 active:scale-90"
              aria-label="Remove attachment"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      )}<input value={n.title} readOnly={ro} onChange={(e) => set({ title: e.target.value })} placeholder="Title" className="w-full bg-transparent py-2 text-2xl font-bold outline-none placeholder:text-foreground/40" />
      {n.type === "text" && n.md && preview ? <div className={`md-view ${noteTextClass(n)}`} dangerouslySetInnerHTML={{ __html: renderMarkdown(n.body) || "<p class=\"opacity-50\">Nothing to preview</p>" }} /> : n.type === "text" ? <textarea value={n.body} readOnly={ro} autoFocus={!initial.title && !initial.body} onChange={(e) => set({ body: e.target.value })} placeholder="Note" rows={12} className={`w-full resize-none bg-transparent leading-relaxed outline-none placeholder:text-foreground/40 ${noteTextClass(n)}`} /> : <div>{openItems.map((i) => <TodoItemRow key={i.id} i={i} ro={ro} note={n} setItem={setItem} onDelete={handleDeleteItem} onEnter={handleEnter} />)}{!ro && <button onClick={() => set({ items: [...n.items, { id: uid(), text: "", done: false }] })} className="flex items-center gap-2 py-2 text-muted-foreground transition-transform active:scale-95"><Plus className="size-5" />Add item</button>}{doneItems.length > 0 && <div className="mt-3 border-t pt-2"><div className="mb-1 text-sm text-muted-foreground">{doneItems.length} completed</div>{doneItems.map((i) => <TodoItemRow key={i.id} i={i} ro={ro} note={n} setItem={setItem} onDelete={handleDeleteItem} onEnter={handleEnter} />)}</div>}</div>}
      {n.labels.length > 0 && <div className="mt-4 flex flex-wrap gap-1.5">{n.labels.map((l) => <span key={l} className="rounded-full bg-foreground/10 px-3 py-1 text-xs">{l}</span>)}</div>}
    </div>

    {panel === "color" && <div className="flex gap-2 overflow-x-auto border-t bg-card px-4 py-3 animate-in slide-in-from-bottom-2">{Object.entries(COLORS).map(([k, cls]) => <button key={k} aria-label={`${k} note color`} onClick={() => set({ color: k })} className={`size-10 shrink-0 rounded-full border-2 transition-all hover:scale-110 ${cls} ${n.color === k ? "scale-110 border-foreground" : "border-border"}`} />)}</div>}
    {panel === "label" && <div className="max-h-48 overflow-y-auto border-t bg-card px-4 py-2 animate-in slide-in-from-bottom-2">{labels.length === 0 && <p className="py-2 text-sm text-muted-foreground">Create labels from the side menu first.</p>}{labels.map((l) => <label key={l} className="flex items-center gap-3 py-2"><input type="checkbox" className="size-5 accent-[var(--color-foreground)]" checked={n.labels.includes(l)} onChange={(e) => set({ labels: e.target.checked ? [...n.labels, l] : n.labels.filter((x) => x !== l) })} />{l}</label>)}</div>}
    {panel === "format" && <FormatPanel note={n} set={set} />}

    {!ro && <div className="flex items-center gap-0.5 border-t px-2 py-1.5">
      <label aria-label="Attach file" title="Attach file" className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-full text-foreground/75 transition-all duration-200 hover:scale-105 hover:bg-foreground/8 active:scale-85">
        <input
          type="file"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) {
              const att = await processFileAttachment(f);
              set({ attachment: att });
            }
          }}
        />
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-5"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
      </label>
      <IconBtn label="Note color" active={panel === "color"} onClick={() => setPanel(panel === "color" ? "none" : "color")}><Palette className="size-5" /></IconBtn><IconBtn label="Text formatting" active={panel === "format"} onClick={() => setPanel(panel === "format" ? "none" : "format")}><Type className="size-5" /></IconBtn><IconBtn label="Labels" active={panel === "label"} onClick={() => setPanel(panel === "label" ? "none" : "label")}><Tag className="size-5" /></IconBtn>{n.type === "text" && <IconBtn label="Markdown" active={Boolean(n.md)} onClick={() => { if (n.md) setPreview(false); set({ md: !n.md }); }}><span className="text-xs font-extrabold">MD</span></IconBtn>}<IconBtn label={n.dir === "rtl" ? "Right to left" : "Left to right"} active={n.dir === "rtl"} onClick={() => set({ dir: n.dir === "rtl" ? "ltr" : "rtl" })}><span className="text-[11px] font-extrabold">{n.dir === "rtl" ? "RTL" : "LTR"}</span></IconBtn><div className="flex-1" /><IconBtn label="Move to trash" onClick={() => onTrash(n)}><Trash2 className="size-5" /></IconBtn></div>}
  </div>;
}

function FormatPanel({ note, set }: { note: Note; set: (p: Partial<Note>) => void }) {
  return <div className="space-y-3 border-t bg-card px-4 py-3 animate-in slide-in-from-bottom-2">
    <div className="flex items-center gap-2"><span className="w-12 text-xs font-bold text-muted-foreground">SIZE</span><div className="flex flex-1 rounded-lg bg-muted p-1">{(["small", "medium", "large"] as TextSize[]).map((size) => <button key={size} onClick={() => set({ textSize: size })} className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-all ${note.textSize === size || (!note.textSize && size === "medium") ? "bg-card shadow-sm" : "text-muted-foreground"}`}>{size.charAt(0).toUpperCase()}</button>)}</div></div>
    <div className="flex items-center gap-2"><span className="w-12 text-xs font-bold text-muted-foreground">STYLE</span><div className="flex gap-1"><FormatButton label="Bold" active={Boolean(note.bold)} onClick={() => set({ bold: !note.bold })}><Bold className="size-4" /></FormatButton><FormatButton label="Italic" active={Boolean(note.italic)} onClick={() => set({ italic: !note.italic })}><Italic className="size-4" /></FormatButton><FormatButton label="Underline" active={Boolean(note.underline)} onClick={() => set({ underline: !note.underline })}><Underline className="size-4" /></FormatButton><FormatButton label="Strikethrough" active={Boolean(note.strike)} onClick={() => set({ strike: !note.strike })}><Strikethrough className="size-4" /></FormatButton></div></div>
    <div className="flex items-center gap-2"><span className="w-12 text-xs font-bold text-muted-foreground">COLOR</span><div className="flex gap-2">{(["default", "red", "blue", "green", "purple"] as TextColor[]).map((color) => <button key={color} aria-label={`${color} text`} onClick={() => set({ textColor: color })} className={`grid size-8 place-items-center rounded-full border transition-all hover:scale-110 ${TEXT_COLORS[color]} ${note.textColor === color || (!note.textColor && color === "default") ? "border-foreground scale-110" : "border-border"}`}><span className="text-base font-black">A</span></button>)}</div></div>
  </div>;
}
function FormatButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) { return <button aria-label={label} title={label} onClick={onClick} className={`grid size-9 place-items-center rounded-lg transition-all active:scale-90 ${active ? "bg-foreground text-background" : "bg-muted hover:bg-foreground/10"}`}>{children}</button>; }

function TodoItemRow({ i, ro, note, setItem, onDelete, onEnter }: { i: Item; ro: boolean; note: Note; setItem: (id: string, p: Partial<Item>) => void; onDelete: (id: string) => void; onEnter: (id: string) => void }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <input type="checkbox" checked={i.done} disabled={ro} onChange={(e) => setItem(i.id, { done: e.target.checked })} className="size-5 shrink-0 accent-[var(--color-foreground)]" />
      <input
        value={i.text}
        readOnly={ro}
        placeholder="List item"
        onChange={(e) => setItem(i.id, { text: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onEnter(i.id);
          }
        }}
        data-item={i.id}
        className={`min-w-0 flex-1 bg-transparent py-1 outline-none ${noteTextClass(note)} ${i.done ? "text-muted-foreground line-through" : ""}`}
      />
      {!ro && (
        <button aria-label="Delete item" onClick={() => onDelete(i.id)} className="p-1 text-muted-foreground transition-transform hover:rotate-90">
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}