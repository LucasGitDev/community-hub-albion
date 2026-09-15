import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const dateTimeFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const dayHeadingFmt = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" });

export const formatDateTime = (iso: string) => dateTimeFmt.format(new Date(iso)).replace(".", "");
export const formatDayHeading = (iso: string) => {
  const s = dayHeadingFmt.format(new Date(iso));
  return s.charAt(0).toUpperCase() + s.slice(1);
};
