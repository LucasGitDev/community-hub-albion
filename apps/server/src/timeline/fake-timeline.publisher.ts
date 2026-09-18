import type { TimelineAction, TimelineEntry, TimelinePublisher } from "../domain/timeline.js";

/**
 * Publicador falso para testes (TASK-076, T14). Guarda cada registro na ordem, para o teste afirmar o
 * que a operação publicou. Como o real, nunca lança. Para provar "depois do commit" (T5), afirme o
 * registro só depois de a operação resolver e confira que operação recusada/desfeita não publicou nada
 * (`expect(timeline.entries).toEqual([])`).
 *
 * Uso num teste de serviço:
 *   const timeline = new FakeTimelinePublisher();
 *   const service = new WithdrawalService(db, timeline);
 *   await service.approve(...);
 *   expect(timeline.only("economy.withdrawal_approved")).toMatchObject({ recordId, amounts: [{ value: 1_000_000n, currency: "silver" }] });
 */
export class FakeTimelinePublisher implements TimelinePublisher {
  readonly entries: TimelineEntry[] = [];

  publish(entry: TimelineEntry): void {
    this.entries.push(entry);
  }

  /** Ações publicadas, na ordem. Bom para `toEqual([...])`. */
  actions(): TimelineAction[] {
    return this.entries.map((e) => e.action);
  }

  ofAction(action: TimelineAction): TimelineEntry[] {
    return this.entries.filter((e) => e.action === action);
  }

  /** O único registro com essa ação. Falha se houver zero ou mais de um: publicar em dobro é defeito. */
  only(action: TimelineAction): TimelineEntry {
    const found = this.ofAction(action);
    if (found.length !== 1) throw new Error(`esperava 1 registro ${action}, veio ${found.length} (publicados: ${this.actions().join(", ") || "nenhum"})`);
    return found[0];
  }

  last(): TimelineEntry | undefined {
    return this.entries.at(-1);
  }

  clear(): void {
    this.entries.length = 0;
  }
}
