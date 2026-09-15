import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useVariant } from "./variant";

/** Tempo da saída da linha (.row-leave em index.css). Mantenha os dois iguais. */
const LEAVE_MS = 180;

/** Check desenhado + anel que se expande (index.css .success-burst). Só na C. */
function SuccessBurst() {
  return (
    <span className="success-burst size-5 rounded-full bg-success text-black" aria-hidden>
      <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    </span>
  );
}

interface Decision {
  kind: "success" | "neutral";
  title: string;
  description: string;
}

/**
 * Feedback de decisão da staff (aprovar/recusar). Gate do `animate`: ação ocasional (dezenas por dia no
 * máximo), propósito = feedback + evitar que a linha "teleporte" pra fora da fila.
 * A/B: toast padrão e a linha sai na hora. C: toast com check animado e a linha desliza 12px e some
 * (180ms ease-out) antes de sair da lista. Reduced-motion: sem deslize, sem desenho do check.
 */
export function useDecisionFeedback() {
  const { rewardMotion } = useVariant();
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const finish = useCallback(
    (d: Decision, remove: () => void) => {
      if (d.kind === "success") toast.success(d.title, { description: d.description, icon: rewardMotion ? <SuccessBurst /> : undefined });
      else toast(d.title, { description: d.description });
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!rewardMotion || reduce) return remove();
      setLeaving(true);
      timer.current = window.setTimeout(remove, LEAVE_MS);
    },
    [rewardMotion],
  );

  return { leaving, finish };
}
