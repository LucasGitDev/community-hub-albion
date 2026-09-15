import type { ComponentProps } from "react";
import { XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

// shadcn/ui dialog com tokens do albion-hub e transições via @starting-style (index.css).
const Dialog = (props: ComponentProps<typeof DialogPrimitive.Root>) => <DialogPrimitive.Root data-slot="dialog" {...props} />;
const DialogTrigger = (props: ComponentProps<typeof DialogPrimitive.Trigger>) => <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
const DialogClose = (props: ComponentProps<typeof DialogPrimitive.Close>) => <DialogPrimitive.Close data-slot="dialog-close" {...props} />;

function DialogContent({ className, children, ...props }: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay data-slot="dialog-overlay" className="dialog-overlay fixed inset-0 z-20 bg-black/60" />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "dialog-panel fixed top-1/2 left-1/2 z-30 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-popover p-6 text-popover-foreground shadow-2xl",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="press absolute top-4 right-4 rounded-md p-1 text-muted hover:text-foreground" aria-label="Fechar">
          <XIcon className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

const DialogTitle = ({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) => (
  <DialogPrimitive.Title data-slot="dialog-title" className={cn("font-display text-2xl font-medium", className)} {...props} />
);

const DialogDescription = ({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>) => (
  <DialogPrimitive.Description data-slot="dialog-description" className={cn("mt-1 text-sm text-muted", className)} {...props} />
);

export { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger };
