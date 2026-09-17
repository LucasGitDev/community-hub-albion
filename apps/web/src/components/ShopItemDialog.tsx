import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { SHOP_ITEM_DESCRIPTION_MAX, SHOP_ITEM_NAME_MAX, shopItemCreateSchema } from "@albion-hub/shared";
import { errorText } from "@/api/http";
import { createShopItem, updateShopItem, type ShopItem, type ShopItemForm } from "@/api/shop";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/**
 * Cadastro e edição de item pela staff (AC#1, `shop:manage`). Um formulário só para os dois casos: os
 * campos são os mesmos, e ter duas telas faria a edição divergir do cadastro na primeira mudança.
 *
 * A validação local é a **mesma função do servidor** (`shopItemCreateSchema`), só para não gastar um
 * round-trip óbvio; quem decide continua sendo a API, e é a frase dela que vai pro toast.
 */
export function ShopItemDialog({ trigger, item, onSaved }: { trigger: ReactNode; item?: ShopItem; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ShopItemForm>(() => toForm(item));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    const parsed = shopItemCreateSchema.safeParse({ name: form.name, description: form.description, price: form.price, stock: form.stock === "" ? null : form.stock });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Confira os campos.");
    setSaving(true);
    try {
      const saved = item ? await updateShopItem(item.id, form) : await createShopItem(form);
      toast.success(item ? "Item atualizado" : "Item publicado", { description: saved.name });
      onSaved();
      setOpen(false);
      setError(null);
    } catch (err) {
      const message = errorText(err, "Não foi possível salvar o item agora. Tente de novo em instantes.");
      setError(message);
      toast.error("Item não salvo", { description: message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setForm(toForm(item));
        else setError(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogTitle className="text-xl">{item ? "Editar item" : "Novo item da loja"}</DialogTitle>
        <DialogDescription>
          O item é texto livre: escreva o que a guilda entrega. Preço em Buffunfa, estoque opcional — em branco, o item nunca esgota.
        </DialogDescription>

        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <div>
            <label htmlFor="shop-name" className="text-sm font-medium">
              Nome
            </label>
            <Input
              id="shop-name"
              autoFocus
              maxLength={SHOP_ITEM_NAME_MAX}
              placeholder="Ping de evento"
              value={form.name}
              onChange={(e) => {
                setForm((f) => ({ ...f, name: e.target.value }));
                setError(null);
              }}
              className="mt-1.5"
            />
          </div>

          <div>
            <label htmlFor="shop-description" className="text-sm font-medium">
              Descrição <span className="font-normal text-muted-foreground">(opcional)</span>
            </label>
            <Textarea
              id="shop-description"
              rows={3}
              maxLength={SHOP_ITEM_DESCRIPTION_MAX}
              placeholder="O que o membro recebe, e o que a staff precisa saber para entregar."
              value={form.description ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="mt-1.5"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="shop-price" className="text-sm font-medium">
                Preço
              </label>
              <div className="mt-1.5 flex items-center gap-2">
                <Input
                  id="shop-price"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="340"
                  value={form.price}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, price: e.target.value }));
                    setError(null);
                  }}
                  className="num font-semibold"
                />
                <span className="text-sm text-muted-foreground">BUF</span>
              </div>
            </div>
            <div>
              <label htmlFor="shop-stock" className="text-sm font-medium">
                Estoque
              </label>
              <Input
                id="shop-stock"
                inputMode="numeric"
                autoComplete="off"
                placeholder="ilimitado"
                value={form.stock}
                onChange={(e) => {
                  setForm((f) => ({ ...f, stock: e.target.value }));
                  setError(null);
                }}
                className="num mt-1.5"
              />
            </div>
          </div>

          <p className="min-h-5 text-xs" aria-live="polite">
            {error ? <span className="text-destructive">{error}</span> : <span className="text-muted-foreground">Estoque em branco = item sem limite de unidades.</span>}
          </p>

          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancelar
              </Button>
            </DialogClose>
            <Button type="submit" disabled={saving}>
              {saving ? "Salvando…" : item ? "Salvar" : "Publicar item"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const toForm = (item?: ShopItem): ShopItemForm => ({
  name: item?.name ?? "",
  description: item?.description ?? "",
  price: item ? item.price.toString() : "",
  stock: item?.stock === null || item?.stock === undefined ? "" : String(item.stock),
});
