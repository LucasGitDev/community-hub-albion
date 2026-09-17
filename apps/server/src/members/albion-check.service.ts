import { BadRequestException, Inject, Injectable, NotFoundException, Optional, ServiceUnavailableException } from "@nestjs/common";
import { getAdminMemberProfile, setAlbionCheck, type DbHandle } from "@albion-hub/db";
import { DB_HANDLE } from "../db/db.module.js";
import type { AlbionPlayerLookup } from "../domain/albion-lookup.js";
import { ALBION_PLAYER_LOOKUP } from "./albion-lookup.token.js";

/** O bloco `albion` do membro, no mesmo formato da listagem: a tela troca a linha sem recarregar nada. */
export interface AlbionCheckDto {
  status: string | null;
  playerId: string | null;
  guildName: string | null;
  checkedAt: string | null;
}

/**
 * Revalidação de nick na API do Albion (TASK-045, AC#1), agora com duas portas: o painel do admin e o
 * namespace de manutenção (TASK-048). Um comportamento, um lugar — se a regra mudar, muda para os dois.
 *
 * A consulta nunca derruba a requisição: o cliente já devolve `unavailable` no lugar de lançar (timeout de
 * 5s, sem retry). `disabled` (sem `ALBION_REGION`) é 503 com texto em PT-BR, porque aí não há nada para
 * gravar e mostrar "não encontrado" seria mentira — Q14/Q15: a conferência é ajuda, nunca bloqueio.
 */
@Injectable()
export class AlbionCheckService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Optional() @Inject(ALBION_PLAYER_LOOKUP) private readonly albion: AlbionPlayerLookup | null = null,
  ) {}

  async recheck(userId: string): Promise<AlbionCheckDto> {
    const member = await getAdminMemberProfile(this.handle.db, userId);
    if (!member) throw new NotFoundException("Usuário não encontrado.");
    if (!member.gameNick) throw new BadRequestException("Esse membro ainda não tem nick registrado: não há o que conferir no Albion.");
    if (!this.albion) throw new ServiceUnavailableException("Consulta ao Albion indisponível neste servidor.");

    const result = await this.albion.lookup(member.gameNick);
    if (result.status === "disabled") throw new ServiceUnavailableException("Conferência no Albion desligada neste servidor (ALBION_REGION não configurado).");

    const checkedAt = new Date(result.checkedAt);
    const check = {
      status: result.status,
      playerId: result.status === "found" ? result.playerId : null,
      guildName: result.status === "found" ? result.guildName : null,
      checkedAt,
    };
    await setAlbionCheck(this.handle.db, userId, check);
    return { ...check, checkedAt: checkedAt.toISOString() };
  }
}
