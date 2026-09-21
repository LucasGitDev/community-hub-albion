import { Inject, Injectable, Logger } from "@nestjs/common";
import { findRunningEventByVoiceChannelId, listEventSignupMembers, type DbHandle } from "@albion-hub/db";
import { randomUUID } from "node:crypto";
import { DB_HANDLE } from "../db/db.module.js";
import { describeDiscordError } from "../domain/discord-errors.js";
import { lateSignupQuestionView, QUESTION_MAX_PEOPLE, type LatePerson } from "../domain/event-late-signup.js";
import { EVENT_VOICE_GATEWAY, type EventVoiceGateway } from "./event-voice.gateway.js";

/** Quanto tempo as entradas esperam antes de virar pergunta. Provider para o teste zerar. */
export const LATE_SIGNUP_BATCH_MS = Symbol("LATE_SIGNUP_BATCH_MS");
/** Três segundos: o bastante para um squad inteiro cair na call junto, curto para não parecer travado. */
export const DEFAULT_LATE_SIGNUP_BATCH_MS = 3_000;

/** Quantas perguntas o bot lembra. Passou disso, a mais antiga expira e o clique diz que não vale mais. */
const MAX_TICKETS = 200;

/** Uma pergunta publicada, do jeito que os botões dela precisam consultar depois. */
export interface LateSignupTicket {
  id: string;
  eventId: string;
  eventName: string;
  people: LatePerson[];
  /** Quem deste lote já foi inscrito por um clique anterior nesta mesma pergunta. */
  readonly accepted: Set<string>;
  /** Já foi ignorada (ou o evento saiu do ar): novos cliques recebem "não vale mais". */
  resolved: boolean;
}

/**
 * Pergunta do bot para quem entrou na call sem estar inscrito (TASK-086, PE7/PE8).
 *
 * **Como não vira enxurrada de perguntas** — cinco pessoas entrando não podem virar cinco mensagens.
 * São três travas, e cada uma cobre um caso diferente:
 * 1. **Lote com janela curta**: a entrada não pergunta na hora; entra numa lista e o bot espera
 *    `LATE_SIGNUP_BATCH_MS`. Todo mundo que caiu na call nesse intervalo sai numa pergunta só, com até
 *    `QUESTION_MAX_PEOPLE` pessoas por mensagem — que é o que cabe na linha de botões do Discord.
 * 2. **Memória por evento**: quem já foi perguntado (ou ignorado) não gera pergunta nova, por mais que
 *    entre e saia da call. Entrar e sair é normal em call de guilda; perguntar de novo a cada re-entrada
 *    é que seria spam.
 * 3. **Confere quem ainda está lá** no momento de publicar: quem entrou e saiu dentro da janela some do
 *    lote, e um lote que esvaziou não publica mensagem nenhuma.
 *
 * A memória é de processo, não de banco: reiniciar o bot pergunta de novo, e isso é melhor que perder
 * alguém que entrou durante a queda. O que o reinício apaga são os tickets, e clicar num botão velho
 * responde "não vale mais" em vez de inscrever alguém pelo motivo errado.
 *
 * O serviço **não inscreve ninguém**: ele só pergunta. Quem inscreve é o clique, nas interações, onde a
 * permissão é checada (PE11, igual à TASK-085).
 */
@Injectable()
export class EventLateSignupService {
  private readonly logger = new Logger("EventLateSignup");
  /** Entradas esperando a janela fechar: canal de voz → quem entrou. */
  private readonly arrivals = new Map<string, Map<string, string>>();
  /** Quem já foi perguntado ou ignorado, por evento (trava 2). */
  private readonly handled = new Map<string, Set<string>>();
  private readonly tickets = new Map<string, LateSignupTicket>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(EVENT_VOICE_GATEWAY) private readonly gateway: EventVoiceGateway,
    @Inject(LATE_SIGNUP_BATCH_MS) private readonly batchMs: number,
  ) {}

  /**
   * Alguém entrou num canal de voz. Nada de banco aqui: só anota e agenda o lote, porque a entrada de
   * voz é evento quente e a pergunta pode esperar três segundos.
   */
  noteArrival(input: { discordUserId: string; channelId: string; displayName: string }): void {
    const channel = this.arrivals.get(input.channelId) ?? new Map<string, string>();
    channel.set(input.discordUserId, input.displayName);
    this.arrivals.set(input.channelId, channel);
    this.schedule();
  }

  /** Ticket de uma pergunta publicada; `undefined` = reiniciou o bot ou caiu do limite. */
  ticket(id: string): LateSignupTicket | undefined {
    return this.tickets.get(id);
  }

  /** Encerra a pergunta: os botões dela param de valer (AC#3). */
  resolveTicket(id: string): void {
    const ticket = this.tickets.get(id);
    if (ticket) ticket.resolved = true;
  }

  /** Marca que essa pessoa já teve a decisão dela tomada neste evento — não se pergunta de novo. */
  markHandled(eventId: string, discordUserId: string): void {
    const set = this.handled.get(eventId) ?? new Set<string>();
    set.add(discordUserId);
    this.handled.set(eventId, set);
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.batchMs);
    // Um lote pendente não segura o processo no encerramento.
    this.timer.unref?.();
  }

  /**
   * Fecha a janela: vira perguntas o que estava anotado. Nunca lança — pergunta não publicada é aviso
   * no log, e a entrada na call não pode quebrar por causa disso.
   */
  async flush(): Promise<void> {
    const batch = [...this.arrivals.entries()];
    this.arrivals.clear();
    for (const [channelId, people] of batch) {
      try {
        await this.askForChannel(channelId, people);
      } catch (error) {
        this.logger.warn(`Canal ${channelId}: não consegui perguntar sobre quem entrou no meio. ${describeDiscordError(error)}`);
      }
    }
  }

  private async askForChannel(channelId: string, arrived: Map<string, string>): Promise<void> {
    // Canal que não é call de evento em andamento não pergunta nada (AC: evento não iniciado ou
    // finalizado fica em silêncio) — e é a consulta mais barata, então vem primeiro.
    const event = await findRunningEventByVoiceChannelId(this.handle.db, channelId);
    if (!event) return;

    const signups = await listEventSignupMembers(this.handle.db, event.id);
    const signedUp = new Set(signups.map((s) => s.discordId));
    const already = this.handled.get(event.id) ?? new Set<string>();
    // Trava 3: quem entrou e já saiu dentro da janela não vira pergunta.
    const present = new Set(await this.gateway.listMembersInChannel(channelId));

    const people: LatePerson[] = [...arrived]
      .filter(([id]) => present.has(id) && !signedUp.has(id) && !already.has(id))
      .map(([discordUserId, displayName]) => ({ discordUserId, displayName }));
    if (people.length === 0) return;

    for (let i = 0; i < people.length; i += QUESTION_MAX_PEOPLE) {
      const chunk = people.slice(i, i + QUESTION_MAX_PEOPLE);
      const ticket: LateSignupTicket = { id: randomUUID(), eventId: event.id, eventName: event.name, people: chunk, accepted: new Set(), resolved: false };
      await this.gateway.postToChannel(channelId, lateSignupQuestionView(event, ticket.id, chunk));
      // Só depois do Discord aceitar: mensagem que não saiu não pode calar a próxima entrada da pessoa.
      this.remember(ticket);
      for (const person of chunk) this.markHandled(event.id, person.discordUserId);
    }
  }

  private remember(ticket: LateSignupTicket): void {
    this.tickets.set(ticket.id, ticket);
    while (this.tickets.size > MAX_TICKETS) {
      const oldest = this.tickets.keys().next();
      if (oldest.done) break;
      this.tickets.delete(oldest.value);
    }
  }
}
