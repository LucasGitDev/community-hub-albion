import { Injectable, Logger } from "@nestjs/common";
import { Context, type ContextOf, On, Once } from "necord";
import { describeDiscordError } from "../domain/discord-errors.js";

@Injectable()
export class ReadyListener {
  private readonly logger = new Logger("Bot");

  @Once("clientReady")
  onReady(@Context() [client]: ContextOf<"clientReady">) {
    this.logger.log(`Bot online como ${client.user.tag}`);
  }

  /**
   * Sem listener de "error", o EventEmitter do discord.js lança e derruba o processo
   * (ex: falha ao registrar slash commands). Loga e mantém API e bot no ar.
   */
  @On("error")
  onError(@Context() [error]: ContextOf<"error">) {
    this.logger.error(describeDiscordError(error));
  }
}
