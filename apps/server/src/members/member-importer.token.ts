import type { MemberImportSummary } from "../domain/member-import.js";

/**
 * Porta do import de membros do Discord (TASK-042/043).
 *
 * O serviço real (`DiscordMemberImportService`) mora no BotModule, que só sobe com o bot ligado. O endpoint de
 * admin injeta este token como **opcional**: sem bot (e2e, testes HTTP) ele não existe e a API responde 503 com
 * texto claro em vez de quebrar na subida. O teste injeta um dublê por `AppModule.register(env, { memberImporter })`.
 */
export interface MemberImporter {
  import(): Promise<MemberImportSummary>;
}

export const MEMBER_IMPORTER = Symbol("MEMBER_IMPORTER");
