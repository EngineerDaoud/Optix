import {
  Children,
  isValidElement,
  ReactElement,
  ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";

type Opt = { value: string; label: string; disabled?: boolean };

// plain text of any React children (option labels can be "Up to {n} pages")
const textOf = (n: ReactNode): string =>
  Children.toArray(n)
    .map((c) =>
      typeof c === "string" || typeof c === "number"
        ? String(c)
        : isValidElement(c)
          ? textOf((c.props as { children?: ReactNode }).children)
          : "",
    )
    .join("");

// reads <option> elements (also inside fragments, arrays and .map) so the old <select> markup keeps working
function readOptions(children: ReactNode): Opt[] {
  const out: Opt[] = [];
  const walk = (nodes: ReactNode) =>
    Children.forEach(nodes, (c) => {
      if (!isValidElement(c)) return;
      const el = c as ReactElement<{
        value?: string | number;
        disabled?: boolean;
        children?: ReactNode;
      }>;
      if (el.type === "option") {
        const label = textOf(el.props.children);
        out.push({
          value: String(el.props.value ?? label),
          label,
          disabled: el.props.disabled,
        });
      } else if (el.props?.children) walk(el.props.children);
    });
  walk(children);
  return out;
}

type Props = {
  value?: string | number | null;
  onChange?: (e: { target: { value: string }; currentTarget: { value: string } }) => void;
  children?: ReactNode;
  className?: string;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
  "aria-label"?: string;
  /** show a search box; by default it appears when the list has more than 8 items */
  searchable?: boolean;
  /** optional icon shown inside the button, left side */
  icon?: ReactNode;
  /** width of the open list; defaults to the button width (min 200px) */
  panelWidth?: number;
};

/** Drop-in replacement for <select>. Same props (value, onChange, className, <option> children) but with a styled, searchable,
 *  keyboard-friendly list that works in light and dark mode and is never clipped by a card. */
export default function Select({
  value,
  onChange,
  children,
  className,
  id,
  disabled,
  placeholder = "Select",
  searchable,
  icon,
  panelWidth,
  ...rest
}: Props) {
  const options = useMemo(() => readOptions(children), [children]);
  const cur = String(value ?? "");
  const selected = options.find((o) => o.value === cur);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    width: number;
    up: boolean;
    max: number;
  } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const showSearch = searchable ?? options.length > 8;

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? options.filter((o) => o.label.toLowerCase().includes(s)) : options;
  }, [options, q]);

  const place = () => {
    const el = btn.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.max(panelWidth ?? r.width, 200);
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const up = below < 240 && above > below;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
    setPos({
      left,
      top: up ? r.top - 6 : r.bottom + 6,
      width,
      up,
      max: Math.max(160, Math.min(340, up ? above : below)),
    });
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const t = e.target as Node;
      if (btn.current?.contains(t) || panel.current?.contains(t)) return;
      setOpen(false);
    };
    const reflow = (e: Event) => {
      // scrolling inside the list itself must not close it
      if (panel.current?.contains(e.target as Node)) return;
      place();
    };
    document.addEventListener("pointerdown", close);
    window.addEventListener("resize", reflow);
    window.addEventListener("scroll", reflow, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", reflow);
      window.removeEventListener("scroll", reflow, true);
    };
  }, [open]);

  // when opening: start on the selected item and scroll to it
  useEffect(() => {
    if (!open) return;
    setQ("");
    const i = Math.max(
      0,
      options.findIndex((o) => o.value === cur),
    );
    setActive(i);
    requestAnimationFrame(() =>
      listRef.current
        ?.querySelector<HTMLElement>(`[data-i="${i}"]`)
        ?.scrollIntoView({ block: "nearest" }),
    );
  }, [open]);

  useEffect(() => {
    if (open)
      listRef.current
        ?.querySelector<HTMLElement>(`[data-i="${active}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const pick = (o?: Opt) => {
    if (!o || o.disabled) return;
    setOpen(false);
    btn.current?.focus();
    if (o.value !== cur)
      onChange?.({ target: { value: o.value }, currentTarget: { value: o.value } });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      btn.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(shown.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(shown[active]);
    } else if (e.key === "Tab") setOpen(false);
  };

  const base =
    className ??
    "input";

  return (
    <>
      <button
        ref={btn}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={rest["aria-label"]}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKey}
        className={`${base} flex min-w-0 cursor-pointer items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-50 ${open ? "!border-brand-500 !ring-4 !ring-brand-500/15" : ""}`}
      >
        <span className="flex min-w-0 items-center gap-2">
          {icon}
          <span
            className={`truncate ${selected ? "" : "text-slate-400"}`}
          >
            {selected ? selected.label : placeholder}
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180 text-brand-600" : ""}`}
          aria-hidden="true"
        />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={panel}
            onKeyDown={onKey}
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.up ? undefined : pos.top,
              bottom: pos.up ? window.innerHeight - pos.top : undefined,
              width: pos.width,
              zIndex: 1000,
            }}
            className="menu-in overflow-hidden rounded-2xl border border-brand-100 bg-white p-1.5 shadow-pop ring-1 ring-black/5 dark:border-slate-700 dark:bg-slate-900"
          >
            {showSearch && (
              <div className="relative mb-1.5">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setActive(0);
                  }}
                  onKeyDown={onKey}
                  placeholder="Search…"
                  className="h-9 w-full rounded-xl border border-line bg-brand-50/50 pl-8 pr-3 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
            )}
            <div
              ref={listRef}
              role="listbox"
              style={{ maxHeight: pos.max - (showSearch ? 48 : 0) }}
              className="scroll-thin overflow-auto"
            >
              {shown.length === 0 && (
                <div className="px-3 py-3 text-center text-xs text-slate-400">
                  Nothing found
                </div>
              )}
              {shown.map((o, i) => {
                const on = o.value === cur;
                return (
                  <button
                    key={o.value + i}
                    type="button"
                    role="option"
                    aria-selected={on}
                    data-i={i}
                    disabled={o.disabled}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(o)}
                    className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm transition disabled:opacity-40 ${
                      on
                        ? "bg-brand-600 font-medium text-white"
                        : i === active
                          ? "bg-brand-50 text-brand-800 dark:bg-slate-800 dark:text-brand-200"
                          : "text-slate-700 dark:text-slate-200"
                    }`}
                  >
                    <span className="truncate">{o.label}</span>
                    {on && <Check className="h-4 w-4 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}