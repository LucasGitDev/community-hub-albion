import "reflect-metadata";
import { ButtonStyle, ComponentType } from "discord.js";
import { MessageComponentDiscovery, ModalDiscovery } from "necord";
import { describe, expect, it, vi } from "vitest";
import { BotModule } from "./bot.module.js";
import { approveButtonId, buildNickEmbed, NICK_APPROVE_BUTTON, NICK_REJECT_BUTTON, NICK_REJECT_MODAL, rejectButtonId, rejectModalId } from "../domain/nick-embed.js";
import { DiscordJsStaffChannelGateway, toMessagePayload, type ChannelClientLike } from "./staff-channel.gateway.js";

const CHANNEL = "423456789012345678";
const view = buildNickEmbed({
  requestId: "0f8fad5b-d9cb-469f-a165-70867728950e",
  requesterDiscordId: "400000000000000001",
  currentNick: null,
  nick: "Novo",
  status: "pending",
  createdAt: new Date(0),
  decidedAt: null,
  deciderDiscordId: null,
  decisionNote: null,
});

describe("DiscordJsStaffChannelGateway (TASK-015, client falso)", () => {
  it("payload: embed, botões verde/vermelho com customId e menções sem notificar", () => {
    const payload = toMessagePayload(view);
    expect(payload.embeds[0]).toMatchObject({ title: "Novo pedido de nick", color: view.color });
    expect(payload.allowedMentions).toEqual({ parse: [] });
    expect(payload.components).toEqual([
      {
        type: ComponentType.ActionRow,
        components: [
          { type: ComponentType.Button, custom_id: view.buttons[0]!.customId, label: "Aprovar nick", style: ButtonStyle.Success },
          { type: ComponentType.Button, custom_id: view.buttons[1]!.customId, label: "Recusar", style: ButtonStyle.Danger },
        ],
      },
    ]);
    expect(toMessagePayload({ ...view, buttons: [] }).components).toEqual([]);
  });

  it("publica no canal configurado e edita pela id da mensagem", async () => {
    const send = vi.fn().mockResolvedValue({ id: "777" });
    const edit = vi.fn().mockResolvedValue(undefined);
    const fetch = vi.fn().mockResolvedValue({ send, messages: { edit } });
    const gateway = new DiscordJsStaffChannelGateway({ channels: { fetch } }, CHANNEL);
    expect(await gateway.postNickRequest(view)).toBe("777");
    expect(fetch).toHaveBeenCalledWith(CHANNEL);
    await gateway.editNickRequest("777", view);
    expect(edit).toHaveBeenCalledWith("777", toMessagePayload(view));
  });

  it("canal inexistente ou sem texto: erro com código claro", async () => {
    for (const channel of [null, { messages: { edit: vi.fn() } }]) {
      const client: ChannelClientLike = { channels: { fetch: vi.fn().mockResolvedValue(channel) } };
      await expect(new DiscordJsStaffChannelGateway(client, CHANNEL).postNickRequest(view)).rejects.toMatchObject({ code: "STAFF_CHANNEL_NOT_TEXT" });
    }
  });

  it("roteamento Necord: cada customId cai só no handler certo e extrai o id (sem ':' que o path-to-regexp leria como parâmetro)", () => {
    const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
    const button = (customId: string) => new MessageComponentDiscovery({ type: ComponentType.Button, customId } as never);
    const name = (customId: string) => `${ComponentType.Button}_${customId}`;
    const approve = button(NICK_APPROVE_BUTTON);
    const reject = button(NICK_REJECT_BUTTON);
    expect(approve.matcher(name(approveButtonId(id)))).toMatchObject({ params: { id } });
    expect(approve.matcher(name(rejectButtonId(id)))).toBe(false);
    expect(reject.matcher(name(approveButtonId(id)))).toBe(false);
    expect(reject.matcher(name(rejectButtonId(id)))).toMatchObject({ params: { id } });
    const modal = new ModalDiscovery({ customId: NICK_REJECT_MODAL } as never);
    expect(modal.matcher(rejectModalId(id))).toMatchObject({ params: { id } });
    expect(modal.matcher(rejectButtonId(id))).toBe(false);
  });

  it("BotModule exige DISCORD_STAFF_CHANNEL_ID", () => {
    expect(() => BotModule.register({ DISCORD_TOKEN: "a.b.c", GUILD_ID: "123456789012345678", DISCORD_MEMBER_ROLE_ID: "323456789012345678", DISCORD_STAFF_CHANNEL_ID: undefined })).toThrow(
      "DISCORD_STAFF_CHANNEL_ID",
    );
  });
});
