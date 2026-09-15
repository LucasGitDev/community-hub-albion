import type { EventRoleDto, EventTemplateDto, EventTemplateInput } from "@albion-hub/shared";

/** API do catálogo de roles e templates (TASK-020). Mensagem PT-BR da API vira o texto do toast. */
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { Accept: "application/json", "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
    throw new Error(typeof body?.message === "string" ? body.message : `Falha na requisição (HTTP ${res.status})`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const fetchEventRoles = () => api<{ roles: EventRoleDto[] }>("/api/event-roles").then((r) => r.roles);
export const fetchEventTemplates = () => api<{ templates: EventTemplateDto[] }>("/api/event-templates").then((r) => r.templates);

export const createEventRole = (body: { name: string; description: string | null }) => api<EventRoleDto>("/api/event-roles", { method: "POST", body: JSON.stringify(body) });
export const updateEventRole = (id: string, body: { name?: string; description?: string | null }) =>
  api<EventRoleDto>(`/api/event-roles/${id}`, { method: "PATCH", body: JSON.stringify(body) });
export const deleteEventRole = (id: string) => api<void>(`/api/event-roles/${id}`, { method: "DELETE" });

export const createEventTemplate = (body: EventTemplateInput) => api<EventTemplateDto>("/api/event-templates", { method: "POST", body: JSON.stringify(body) });
export const updateEventTemplate = (id: string, body: EventTemplateInput) => api<EventTemplateDto>(`/api/event-templates/${id}`, { method: "PATCH", body: JSON.stringify(body) });
export const deleteEventTemplate = (id: string) => api<void>(`/api/event-templates/${id}`, { method: "DELETE" });
