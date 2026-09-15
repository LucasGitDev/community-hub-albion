import { Injectable, Logger } from "@nestjs/common";
import { Context, type ContextOf, Once } from "necord";

@Injectable()
export class ReadyListener {
  private readonly logger = new Logger("Bot");

  @Once("clientReady")
  onReady(@Context() [client]: ContextOf<"clientReady">) {
    this.logger.log(`Bot online como ${client.user.tag}`);
  }
}
