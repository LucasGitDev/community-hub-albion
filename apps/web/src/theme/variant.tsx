import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { parseVariant, VARIANTS, type Variant } from "@/lib/variant";

/**
 * TASK-036: três direções visuais alternáveis em runtime (skill `prototype`).
 * `?v=a|b|c` escolhe e persiste no localStorage; o picker só aparece em dev ou depois que alguém
 * abriu uma URL com `?v=` (preview). Sem nada disso, vale a variação A e nenhum chrome extra.
 * Removido quando o usuário escolher a direção (TASK-036 AC#4).
 */

const STORAGE_KEY = "albion-hub:ui-variant";

interface VariantContextValue {
  variant: Variant;
  /** Movimento de recompensa (count-up, check animado, saída de linha): só na C. */
  rewardMotion: boolean;
  setVariant: (v: Variant) => void;
  /** Muda a cada "replay" do picker: usado como key pra remontar a página. */
  replayKey: number;
  replay: () => void;
  showPicker: boolean;
}

const VariantContext = createContext<VariantContextValue | null>(null);

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function initial(): { variant: Variant; preview: boolean } {
  const fromUrl = new URLSearchParams(location.search).get("v");
  const stored = readStored();
  if (fromUrl) return { variant: parseVariant(fromUrl), preview: true };
  return { variant: parseVariant(stored), preview: stored !== null };
}

function applyToDocument(v: Variant) {
  const root = document.documentElement;
  root.dataset.variant = v;
  root.classList.toggle("dark", v !== "a");
}

export function VariantProvider({ children }: { children: ReactNode }) {
  const [{ variant, preview }, setState] = useState(initial);
  const [replayKey, setReplayKey] = useState(0);

  useLayoutEffect(() => applyToDocument(variant), [variant]);

  useEffect(() => {
    if (!preview) return;
    try {
      localStorage.setItem(STORAGE_KEY, variant);
    } catch {
      /* storage bloqueado: segue só na URL */
    }
  }, [variant, preview]);

  const setVariant = useCallback((v: Variant) => {
    setState({ variant: v, preview: true });
    const url = new URL(location.href);
    url.searchParams.set("v", v);
    history.replaceState(history.state, "", url);
    setReplayKey((k) => k + 1);
  }, []);

  const value = useMemo<VariantContextValue>(
    () => ({
      variant,
      rewardMotion: variant === "c",
      setVariant,
      replayKey,
      replay: () => setReplayKey((k) => k + 1),
      showPicker: import.meta.env.DEV || preview,
    }),
    [variant, setVariant, replayKey, preview],
  );

  return <VariantContext.Provider value={value}>{children}</VariantContext.Provider>;
}

export function useVariant() {
  const ctx = useContext(VariantContext);
  if (!ctx) throw new Error("useVariant fora de VariantProvider");
  return ctx;
}

const LABELS: Record<Variant, string> = { a: "A · Papel", b: "B · Ouro", c: "C · Arena" };

/** Picker da skill `prototype` (PICKER.md), verbatim: pílula escura, 1–3 / ←→ trocam, R repete. */
export function VariantPicker() {
  const { variant, setVariant, replay, showPicker } = useVariant();
  const navRef = useRef<HTMLElement>(null);
  const highlightRef = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    if (!showPicker) return;
    const move = () => {
      const el = navRef.current?.querySelector<HTMLElement>(`[data-key="${variant}"]`);
      const hl = highlightRef.current;
      if (!el || !hl) return;
      hl.style.width = `${el.offsetWidth}px`;
      hl.style.transform = `translateX(${el.offsetLeft}px)`;
    };
    move();
    window.addEventListener("resize", move);
    return () => window.removeEventListener("resize", move);
  }, [variant, showPicker]);

  useEffect(() => {
    if (!showPicker) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setReady(true)));
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const i = VARIANTS.indexOf(variant);
      const num = Number.parseInt(e.key, 10);
      if (num >= 1 && num <= VARIANTS.length) setVariant(VARIANTS[num - 1]);
      else if (e.key === "ArrowRight") setVariant(VARIANTS[(i + 1) % VARIANTS.length]);
      else if (e.key === "ArrowLeft") setVariant(VARIANTS[(i - 1 + VARIANTS.length) % VARIANTS.length]);
      else if (e.key === "r" || e.key === "R") replay();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener("keydown", onKey);
    };
  }, [variant, setVariant, replay, showPicker]);

  if (!showPicker) return null;
  return (
    <nav ref={navRef} className="proto-picker" aria-label="Prototype variants" data-position="top" data-ready={ready ? "" : undefined}>
      <span ref={highlightRef} className="proto-picker-highlight" aria-hidden="true" />
      {VARIANTS.map((v) => (
        <button
          key={v}
          type="button"
          data-key={v}
          className="proto-picker-item"
          data-active={v === variant ? "" : undefined}
          aria-current={v === variant ? "true" : undefined}
          onClick={() => setVariant(v)}
        >
          {LABELS[v]}
        </button>
      ))}
      <span className="proto-picker-divider" aria-hidden="true" />
      <button type="button" className="proto-picker-item proto-picker-replay" aria-label="Replay animation (R)" onClick={replay}>
        ↻
      </button>
    </nav>
  );
}
