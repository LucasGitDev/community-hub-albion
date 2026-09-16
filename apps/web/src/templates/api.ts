import type { EventRoleDto, EventTemplateDto, EventTemplateImportResult, EventTemplateInput } from "@albion-hub/shared";
import { api } from "@/api/http";

/** API do catálogo de roles e templates (TASK-020). Mensagem PT-BR da API vira o texto do toast. */

export const fetchEventRoles = () => api<{ roles: EventRoleDto[] }>("/api/event-roles").then((r) => r.roles);
export const fetchEventTemplates = () => api<{ templates: EventTemplateDto[] }>("/api/event-templates").then((r) => r.templates);

export const createEventRole = (body: { name: string; description: string | null }) => api<EventRoleDto>("/api/event-roles", { method: "POST", body: JSON.stringify(body) });
export const updateEventRole = (id: string, body: { name?: string; description?: string | null }) =>
  api<EventRoleDto>(`/api/event-roles/${id}`, { method: "PATCH", body: JSON.stringify(body) });
export const deleteEventRole = (id: string) => api<void>(`/api/event-roles/${id}`, { method: "DELETE" });

export const createEventTemplate = (body: EventTemplateInput) => api<EventTemplateDto>("/api/event-templates", { method: "POST", body: JSON.stringify(body) });
export const updateEventTemplate = (id: string, body: EventTemplateInput) => api<EventTemplateDto>(`/api/event-templates/${id}`, { method: "PATCH", body: JSON.stringify(body) });
export const deleteEventTemplate = (id: string) => api<void>(`/api/event-templates/${id}`, { method: "DELETE" });

/**
 * Export/import em YAML (TASK-038). O export volta como texto (não JSON), então não passa pelo
 * helper `api`: a mensagem de erro da API ainda é lida do corpo pra virar toast.
 */
export async function exportEventTemplateYaml(id: string): Promise<{ yaml: string; filename: string }> {
  const res = await fetch(`/api/event-templates/${id}/export`, { credentials: "same-origin", headers: { Accept: "text/yaml" } });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
    throw new Error(typeof body?.message === "string" ? body.message : `Falha ao exportar (HTTP ${res.status})`);
  }
  const match = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "");
  return { yaml: await res.text(), filename: match?.[1] ?? "template.yaml" };
}

export const importEventTemplateYaml = (yaml: string) => api<EventTemplateImportResult>("/api/event-templates/import", { method: "POST", body: JSON.stringify({ yaml }) });
