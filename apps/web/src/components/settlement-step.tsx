import type { ReactNode } from "react";

/**
 * Passo do acerto do evento, compartilhado entre o loot split (TASK-029) e a Buffunfa por presença
 * (TASK-057): os dois são etapas da **mesma** sequência de fechamento, então precisam ter o mesmo
 * cabeçalho, a mesma numeração e o mesmo respiro — dois desenhos parecidos seriam pior que um igual.
 *
 * O número é informação, não enfeite: isto é uma sequência, e ela tem ordem.
 */
export function Step({ n, title, hint, action, children }: { n: number; title: string; hint?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="border-b last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pt-4">
        <h3 className="flex min-w-0 items-center gap-2.5 text-lg font-semibold">
          <span className="num grid size-6 shrink-0 place-items-center rounded-md border bg-muted text-xs font-semibold text-muted-foreground">{n}</span>
          <span className="truncate">{title}</span>
        </h3>
        {action}
      </div>
      {hint && <p className="mt-1 px-4 pl-[3.125rem] text-sm text-muted-foreground">{hint}</p>}
      <div className="px-4 py-4">{children}</div>
    </section>
  );
}

