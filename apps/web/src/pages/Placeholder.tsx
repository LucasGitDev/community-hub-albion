import { PageHeader } from "@/components/ui";

export function Placeholder({ title, description, task }: { title: string; description: string; task: string }) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <div className="rounded-lg border border-dashed border-rule p-8 text-muted">
        Tela ainda não desenhada. Entra com a {task} do backlog.
      </div>
    </>
  );
}
