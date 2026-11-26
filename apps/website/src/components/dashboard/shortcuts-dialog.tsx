"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@modelstill/ui/components/dialog";
import { Kbd, KbdGroup } from "@modelstill/ui/components/kbd";
import { SHORTCUT_GROUPS } from "@/lib/shortcuts";

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] gap-0 overflow-y-auto p-0 sm:max-w-[560px]">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="text-[15px]">Keyboard shortcuts</DialogTitle>
          <DialogDescription className="text-[12.5px]">Press the keys one after the other. They do nothing while you type in a field.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 px-5 py-4 sm:grid-cols-2">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.label} aria-label={group.label} className="min-w-0">
              <h3 className="mb-1.5 type-label text-muted-foreground">{group.label}</h3>
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={`${group.label}-${item.keys.join("")}`} className="flex h-7 items-center justify-between gap-3 text-[13px]">
                    <span className="truncate">{item.label}</span>
                    <KbdGroup>
                      {item.keys.map((key, index) => (
                        <Kbd key={`${key}-${index}`}>{key}</Kbd>
                      ))}
                    </KbdGroup>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
