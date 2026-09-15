import { PageHeader } from "@/components/display";

export function Placeholder({ title, description, task }: { title: string; description: string; task: string }) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <div className="rounded-xl border border-dashed p-8 text-muted-foreground">
        Tela ainda não desenhada. Entra com a {task} do backlog.
      </div>
    </>
  );
}
