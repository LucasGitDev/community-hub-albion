import { ButtonStyle, ComponentType } from "discord.js";
import { buttonRows, type EmbedButtonStyle, type EmbedView } from "../domain/embed-view.js";

const STYLES: Record<EmbedButtonStyle, ButtonStyle> = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
};

/** Payload da API do Discord a partir da view pura. Menções nunca notificam (allowed_mentions vazio). */
export function toMessagePayload(view: EmbedView) {
  return {
    embeds: [
      {
        title: view.title,
        ...(view.description ? { description: view.description } : {}),
        color: view.color,
        fields: view.fields.map((f) => ({ name: f.name, value: f.value, inline: f.inline ?? false })),
      },
    ],
    components: buttonRows(view.buttons).map((row) => ({
      type: ComponentType.ActionRow,
      components: row.map((b) => ({
        type: ComponentType.Button,
        custom_id: b.customId,
        label: b.label,
        style: STYLES[b.style],
        ...(b.disabled ? { disabled: true } : {}),
      })),
    })),
    allowedMentions: { parse: [] },
  };
}

export type MessagePayload = ReturnType<typeof toMessagePayload>;

/** Canal onde o bot publica e edita um embed (canal da staff, canal de eventos). Testes usam fake. */
export interface EmbedChannelGateway {
  post(view: EmbedView): Promise<string>;
  edit(messageId: string, view: EmbedView): Promise<void>;
}
