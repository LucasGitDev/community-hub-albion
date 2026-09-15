const dateTimeFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export const formatDateTime = (iso: string) => dateTimeFmt.format(new Date(iso)).replace(".", "");
