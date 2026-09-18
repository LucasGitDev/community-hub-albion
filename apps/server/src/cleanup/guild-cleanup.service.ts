import { Inject, Injectable, Logger } from "@nestjs/common";
import { addUserNote, runGuildCleanup, type DbHandle } from "@albion-hub/db";
import { guildCleanupNote } from "@albion-hub/shared";
import { DISCORD_GUILD_MEMBERS_GATEWAY, type DiscordGuildMembersGateway } from "../bot/discord-guild-members.gateway.js";
import { DB_HANDLE } from "../db/db.module.js";
import { describeDiscordError } from "../domain/discord-errors.js";
import { TIMELINE_PUBLISHER, type TimelinePublisher } from "../domain/timeline.js";
import { loadTimelinePeople, publishAfterCommit } from "../timeline/timeline-people.js";
import type { MaintenanceCleanup, MaintenanceCleanupResult } from "../maintenance/maintenance.tokens.js";

export const GUILD_CLEANUP_CLOCK = Symbol("GUILD_CLEANUP_CLOCK");
export type Clock = () => Date;

/**
 * Limpeza diária de quem saiu do servidor (TASK-049, G6). Implementa o `MaintenanceCleanup` da
 * TASK-048, então a mesma passada roda pelo agendador de madrugada e por `POST /api/maintenance/cleanup`.
 *
 * Ordem de propósito — **primeiro perguntar ao Discord, depois escrever**:
 *
 * 1. se a leitura da guild falhar (erro, timeout, 403 de intent), a passada aborta aqui mesmo e **ninguém**
 *    é alterado. Um job que trata "não consegui perguntar" como "todo mundo saiu" limparia a comunidade
 *    inteira numa madrugada — é o pior bug possível nesta task, e por isso a falha nunca vira ação;
 * 2. se a leitura vier, mas vier estranha (vazia ou pequena demais), quem recusa é o disjuntor dentro da
 *    transação (`runGuildCleanup` + `assessGuildCleanup`), antes de qualquer escrita.
 *
 * Em nenhum dos caminhos este serviço toca saldo, lançamento do ledger ou saque: prata é dívida da
 * comunidade com a pessoa mesmo depois de ela sair (G6).
 */
@Injectable()
export class GuildCleanupService implements MaintenanceCleanup {
  private readonly logger = new Logger("GuildCleanup");
  /** Passada em voo. Disparo manual junto com o agendador espera a mesma, em vez de rodar duas. */
  private inFlight: Promise<MaintenanceCleanupResult> | null = null;

  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(DISCORD_GUILD_MEMBERS_GATEWAY) private readonly members: DiscordGuildMembersGateway,
    @Inject(GUILD_CLEANUP_CLOCK) private readonly clock: Clock,
    @Inject(TIMELINE_PUBLISHER) private readonly timeline: TimelinePublisher,
  ) {}

  /** Uma passada. Nunca lança: erro esperado vira log e contador `aborted`, como manda o contrato do token. */
  async run(): Promise<MaintenanceCleanupResult> {
    this.inFlight ??= this.sweep().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async sweep(): Promise<MaintenanceCleanupResult> {
    let present: string[];
    try {
      present = (await this.members.listMembers()).map((m) => m.discordId);
    } catch (error) {
      // O motivo fica registrado, e é só isso que acontece: consulta falha não desativa ninguém (AC#5).
      this.logger.error(`Limpeza abortada: não consegui ler os membros do Discord (${describeDiscordError(error)}). Nenhuma conta foi alterada.`);
      return { ...ZERO, aborted: 1 };
    }

    const result = await runGuildCleanup(this.handle.db, { presentDiscordIds: present, now: this.clock() });
    if (!result.ok) {
      this.logger.error(`Limpeza abortada: ${result.reason}.`);
      return { ...ZERO, aborted: 1 };
    }

    for (const member of result.deactivated) {
      // Autoria do job: sem sessão e sem pessoa, `authorId` é null e a frase diz quem agiu (segurança).
      await addUserNote(this.handle.db, {
        userId: member.userId,
        authorId: null,
        kind: "system",
        body: guildCleanupNote(member.sessionsRevoked, member.rolesRemoved),
      });
    }

    // Uma linha por conta inativada (T4), depois do commit da passada (T5). O ator é sempre o job, inclusive
    // quando a passada veio de `POST /api/maintenance/cleanup`: quem decide quem saiu é o Discord, não quem disparou.
    if (result.deactivated.length > 0) {
      await publishAfterCommit(this.timeline, this.logger, async () => {
        const people = await loadTimelinePeople(this.handle.db, result.deactivated.map((m) => m.userId));
        return result.deactivated.map((member) => {
          const target = people.target(member.userId);
          return {
            action: "account.left_guild" as const,
            summary: `Saiu do servidor: ${target.name}`,
            actor: { kind: "system" as const, name: "Limpeza diária" },
            target,
            details: [
              { name: "Sessões revogadas", value: String(member.sessionsRevoked) },
              { name: "Papéis removidos", value: member.rolesRemoved.length > 0 ? member.rolesRemoved.join(", ") : "nenhum" },
            ],
          };
        });
      });
    }

    const counters: MaintenanceCleanupResult = {
      aborted: 0,
      checked: result.known,
      present: result.present,
      deactivated: result.deactivated.length,
      sessionsRevoked: result.deactivated.reduce((sum, m) => sum + m.sessionsRevoked, 0),
      rolesRemoved: result.deactivated.reduce((sum, m) => sum + m.rolesRemoved.length, 0),
      reactivated: result.reactivated,
      alreadyInactive: result.alreadyInactive,
      skippedLastAdmin: result.skippedLastAdmin.length,
    };
    if (result.skippedLastAdmin.length > 0) {
      this.logger.warn(`Limpeza preservou ${result.skippedLastAdmin.length} admin(s) que saíram do Discord: desativá-los deixaria a comunidade sem nenhum admin ativo.`);
    }
    if (counters.deactivated > 0 || counters.reactivated > 0) {
      this.logger.log(`Limpeza diária: ${counters.deactivated} conta(s) inativada(s), ${counters.sessionsRevoked} sessão(ões) derrubada(s), ${counters.rolesRemoved} papel(éis) removido(s), ${counters.reactivated} de volta. Saldo e ledger intocados.`);
    }
    return counters;
  }
}

/** Contadores de uma passada que não alterou nada. Resposta explícita é melhor que objeto vazio. */
const ZERO = {
  checked: 0,
  present: 0,
  deactivated: 0,
  sessionsRevoked: 0,
  rolesRemoved: 0,
  reactivated: 0,
  alreadyInactive: 0,
  skippedLastAdmin: 0,
} as const;
