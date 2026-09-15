import { Injectable } from "@nestjs/common";
import { Context, SlashCommand, type SlashCommandContext } from "necord";
import { buildPingReply } from "../domain/ping.js";

@Injectable()
export class PingCommand {
  @SlashCommand({ name: "ping", description: "Verifica se o bot está respondendo" })
  async onPing(@Context() [interaction]: SlashCommandContext) {
    return interaction.reply({ content: buildPingReply(interaction.client.ws.ping) });
  }
}
