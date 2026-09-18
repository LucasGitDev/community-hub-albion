import { Inject, Injectable, Logger } from "@nestjs/common";
import { requestNick, type DbHandle, type NickRequest } from "@albion-hub/db";
import { DB_HANDLE } from "../db/db.module.js";
import { TIMELINE_PUBLISHER, type TimelinePublisher } from "../domain/timeline.js";
import { loadTimelinePeople, publishAfterCommit } from "../timeline/timeline-people.js";
import { ListenerSet, type Listener } from "./listener-set.js";

/** Emitido depois que o pedido de nick foi gravado (TASK-015 publica/atualiza o embed da staff). */
export interface NickRequestedEvent {
  request: NickRequest;
  /** false = pendente já existia e teve o nick corrigido. */
  created: boolean;
}

/**
 * Criação/correção do pedido de nick do membro (TASK-012) com hook `onRequested` (TASK-015).
 * Sem Discord aqui: o bot assina o hook. Listener que falha é logado e não quebra o pedido.
 */
@Injectable()
export class NickRequestService {
  private readonly logger = new Logger(NickRequestService.name);
  private readonly listeners = new ListenerSet<NickRequestedEvent>(this.logger, "Listener de pedido de nick");

  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(TIMELINE_PUBLISHER) private readonly timeline: TimelinePublisher,
  ) {}

  onRequested(listener: Listener<NickRequestedEvent>): () => void {
    return this.listeners.add(listener);
  }

  async request(userId: string, nick: string): Promise<NickRequestedEvent> {
    const result = await requestNick(this.handle.db, userId, nick);
    await publishAfterCommit(this.timeline, this.logger, async () => {
      const people = await loadTimelinePeople(this.handle.db, [userId]);
      return {
        action: "account.nick_requested",
        summary: `${result.created ? "Nick pedido" : "Pedido de nick corrigido"}: ${result.request.nick}`,
        actor: people.actor(userId),
        target: people.target(userId),
        recordId: result.request.id,
        details: [{ name: "Nick pedido", value: result.request.nick }],
      };
    });
    await this.listeners.emit(result, `request ${result.request.id}`);
    return result;
  }
}
