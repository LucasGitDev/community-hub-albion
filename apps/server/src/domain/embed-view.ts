/**
 * Forma neutra de um embed com botões (sem discord.js): os builders puros montam isto e o gateway
 * converte em payload da API. Nasceu com o embed de nick (TASK-015) e virou compartilhado quando o
 * embed de evento (TASK-022) precisou dos mesmos campos com mais estilos de botão.
 */

export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export type EmbedButtonStyle = "primary" | "secondary" | "success" | "danger";

export interface EmbedButton {
  customId: string;
  label: string;
  style: EmbedButtonStyle;
  /** Botão visível mas sem clique (ex.: inscrição fechada). */
  disabled?: boolean;
}

export interface EmbedView {
  title: string;
  description?: string;
  color: number;
  fields: EmbedField[];
  buttons: EmbedButton[];
}

/** Limites do Discord: 5 botões por linha, 5 linhas por mensagem. */
const BUTTONS_PER_ROW = 5;
const MAX_BUTTON_ROWS = 5;

/** Quebra os botões em linhas e descarta o que não cabe (o embed continua legível em vez de a mensagem ser recusada). */
export function buttonRows(buttons: readonly EmbedButton[]): EmbedButton[][] {
  const rows: EmbedButton[][] = [];
  for (let i = 0; i < buttons.length && rows.length < MAX_BUTTON_ROWS; i += BUTTONS_PER_ROW) rows.push(buttons.slice(i, i + BUTTONS_PER_ROW));
  return rows;
}
