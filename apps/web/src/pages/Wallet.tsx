import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Silver, StatusBadge } from "@/components/display";
import { WithdrawDialog } from "@/components/WithdrawDialog";
import { cn } from "@/lib/utils";
import { formatDateTime, formatDayHeading } from "@/lib/format";
import { formatSilverShort } from "@albion-hub/shared";
import { useCurrentUser } from "@/auth/AuthProvider";
import { useMyNick } from "@/nick/api";
import { MIN_WITHDRAWAL, useStore } from "@/mock/store";
import type { LedgerEntry } from "@/mock/types";

export function Wallet() {
  const { user } = useCurrentUser();
  const { balanceFor, ledgerFor, withdrawalsFor } = useStore();
  const { total, reserved, available } = balanceFor(user.discordId);
  const entries = ledgerFor(user.discordId);
  const pending = withdrawalsFor(user.discordId).filter((w) => w.status === "pending" || w.status === "approved");

  const negative = total < 0n;
  const reservedPct = total > 0n ? Number((reserved * 1000n) / total) / 10 : 0;

  return (
    <>
      <section aria-labelledby="balance-label" className="pb-10">
        <p id="balance-label" className="text-muted">
          Disponível pra saque
        </p>
        <p className={cn("num mt-1 text-[clamp(3rem,11vw,5.5rem)] leading-[0.95] font-medium tracking-tight", negative ? "text-oxblood" : "text-silver")}>
          <Silver value={available} />
        </p>
        <p className="mt-2 text-sm text-faint">prata</p>

        {/* barra: fatia disponível vs reservada por saques em análise */}
        {total > 0n && (
          <div className="mt-8 max-w-xl">
            <div className="flex h-2 overflow-hidden rounded-full bg-rule" aria-hidden>
              <div className="bg-silver" style={{ width: `${100 - reservedPct}%` }} />
              {reserved > 0n && (
                <div
                  className="bg-brass/70"
                  style={{
                    width: `${reservedPct}%`,
                    backgroundImage: "repeating-linear-gradient(135deg, transparent 0 4px, rgba(19,23,28,.45) 4px 6px)",
                  }}
                />
              )}
            </div>
            <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-silver" />
                <dt className="text-muted">Saldo total</dt>
                <dd><Silver value={total} className="text-parchment" /></dd>
              </div>
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-brass/70" />
                <dt className="text-muted">Reservado em saques</dt>
                <dd><Silver value={reserved} className="text-parchment" /></dd>
              </div>
            </dl>
          </div>
        )}

        {negative && (
          <p className="mt-6 max-w-xl rounded-md border border-oxblood/40 bg-oxblood/10 p-4 text-sm">
            Seu saldo ficou negativo por um estorno. Novos saques ficam bloqueados até ele voltar a zero.
          </p>
        )}

        {/* Sem nenhum lançamento, o próximo passo é o guia do extrato, não um botão desabilitado. */}
        {entries.length > 0 && (
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <WithdrawDialog trigger={<Button disabled={available < MIN_WITHDRAWAL}>Pedir saque</Button>} />
          {available >= 0n && available < MIN_WITHDRAWAL && (
            <span className="text-sm text-muted">Saque mínimo de {formatSilverShort(MIN_WITHDRAWAL)}.</span>
          )}
        </div>
        )}
      </section>

      {pending.length > 0 && (
        <section className="mb-12 border-t border-rule pt-8">
          <h2 className="font-display text-xl font-medium">Saques em andamento</h2>
          <ul className="mt-4 divide-y divide-rule">
            {pending.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="flex items-center gap-4">
                  <Silver value={w.amount} className="text-xl text-parchment" />
                  <StatusBadge status={w.status} />
                </div>
                <span className="text-sm text-faint">Pedido em {formatDateTime(w.requestedAt)}</span>
              </li>
            ))}
          </ul>
          <Link to="/saques" className="mt-2 inline-block text-sm text-brass hover:underline">
            Ver todos os saques
          </Link>
        </section>
      )}

      <section className="border-t border-rule pt-8">
        <h2 className="font-display text-xl font-medium">Extrato</h2>
        {entries.length === 0 ? (
          <FirstSteps />
        ) : (
          <Statement entries={entries} />
        )}
      </section>
    </>
  );
}

function Statement({ entries }: { entries: LedgerEntry[] }) {
  const groups = new Map<string, LedgerEntry[]>();
  for (const e of entries) {
    const key = new Date(e.createdAt).toLocaleDateString("pt-BR");
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const reversed = new Set(entries.map((e) => e.reversesId).filter(Boolean));

  return (
    <div className="mt-2">
      {[...groups.entries()].map(([day, items]) => (
        <div key={day} className="mt-6">
          <h3 className="text-sm text-faint">{formatDayHeading(items[0].createdAt)}</h3>
          <ul className="mt-2">
            {items.map((e) => {
              const credit = e.amount > 0n;
              const isReversed = reversed.has(e.id);
              return (
                <li key={e.id} className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 border-b border-rule/60 py-3 last:border-0">
                  <div className="min-w-0">
                    <p className={cn("truncate", isReversed && "text-muted line-through decoration-faint")}>
                      {e.eventName ?? e.description}
                    </p>
                    <p className={cn("truncate text-sm", e.kind === "reversal" ? "text-oxblood" : "text-muted")}>
                      {e.eventName ? e.description : null}
                      {isReversed && " (estornado)"}
                    </p>
                  </div>
                  <Silver
                    value={e.amount}
                    signed
                    className={cn("text-lg", isReversed ? "text-faint line-through" : credit ? "text-parchment" : "text-muted")}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * Estado vazio com um próximo passo (revenue-centric-design: empty state que direciona,
 * progresso visível desde o primeiro passo). Conta ativada já conta como feito.
 */
function FirstSteps() {
  const { state } = useMyNick();
  const nick = state.status === "ready" ? state.data : null;
  const nickStep = nick?.gameNick
    ? { done: true, title: "Nick aprovado", detail: `A staff aprovou ${nick.gameNick}.` }
    : nick?.pending
      ? { done: false, title: "Nick aguardando a staff", detail: `${nick.pending.nick} está em análise.`, link: { to: "/nick", label: "Ver solicitação" } }
      : { done: false, title: "Registre seu nick do Albion", detail: "A staff confere o nick do personagem pra liberar sua entrada.", link: { to: "/nick", label: "Registrar nick" } };
  const steps: { done: boolean; title: string; detail: string; link?: { to: string; label: string } }[] = [
    { done: true, title: "Conta ativada", detail: "Você entrou com o Discord e já pode receber prata." },
    nickStep,
    { done: false, title: "Participe de um evento com loot split", detail: "Entre na call do evento pelo Discord quando o caller chamar. Seu tempo na call define sua parte." },
    { done: false, title: "Receba sua parte aqui", detail: "Quando a staff confirmar a divisão, o valor aparece neste extrato e pode ser sacado." },
  ];
  return (
    <ol className="mt-6 max-w-xl space-y-4" aria-label="Como receber sua primeira prata">
      {steps.map((step, i) => (
        <li key={step.title} className="flex gap-4">
          <span
            className={cn(
              "num grid size-7 shrink-0 place-items-center rounded-full border text-sm",
              step.done ? "border-verdigris/50 bg-verdigris/10 text-verdigris" : "border-rule text-muted",
            )}
            aria-hidden
          >
            {step.done ? "✓" : i + 1}
          </span>
          <div>
            <p className={step.done ? "text-muted" : "text-parchment"}>
              {step.title}
              {step.done && <span className="sr-only"> (feito)</span>}
            </p>
            <p className="text-sm text-faint">{step.detail}</p>
            {step.link && (
              <Link to={step.link.to} className="mt-1 inline-block text-sm text-brass hover:underline">
                {step.link.label}
              </Link>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

