"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ElementType,
} from "react";
import { useRouter } from "next/navigation";
import {
  CaretRight,
  MagnifyingGlass,
  SignOut,
} from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useAppAuth } from "@/context/auth-context";
import {
  getVisibleGroups,
  getVisibleNavItems,
  mainNavGroups,
  settingsSubItems,
} from "@/app/(app)/navigation";
import { useHaptics } from "@/hooks/use-haptics";

type PaletteItem = {
  key: string;
  label: string;
  hint: string;
  icon: ElementType;
  href?: string;
  action?: () => void;
  group: string;
  keywords: string;
};

/**
 * ⌘K command palette — keyboard-driven navigation across every role's
 * visible pages plus quick actions. Opens with ⌘K / Ctrl+K, filters as you
 * type, navigates with ↑/↓ + Enter, closes with Esc.
 */
export function CommandPalette({
  open,
  onOpenChange,
  onLogout,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLogout?: () => void;
}) {
  const router = useRouter();
  const { haptic } = useHaptics();
  const { userRole, isSuperAdmin, clientInfo } = useAppAuth();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global ⌘K / Ctrl+K toggle
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  // Reset query and focus the input each time the palette opens
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      const id = window.setTimeout(() => inputRef.current?.focus(), 30);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const nav: PaletteItem[] = getVisibleGroups(mainNavGroups, userRole, isSuperAdmin, clientInfo)
      .flatMap((group) =>
        group.items.map((item) => ({
          key: `nav:${item.href}`,
          label: item.label,
          hint: item.href,
          icon: item.icon,
          href: item.href,
          group: group.label,
          keywords: [item.label, item.shortLabel, item.fieldOfficerLabel, item.href, group.label]
            .filter(Boolean)
            .join(" ")
            .toLowerCase(),
        })),
      );

    const settings: PaletteItem[] = getVisibleNavItems(settingsSubItems, userRole, isSuperAdmin, clientInfo)
      .map((item) => ({
        key: `settings:${item.href}`,
        label: item.label,
        hint: item.href,
        icon: item.icon,
        href: item.href,
        group: "Settings",
        keywords: `${item.label} ${item.href} settings`.toLowerCase(),
      }));

    const actions: PaletteItem[] = [
      ...(onLogout
        ? [{
            key: "action:logout",
            label: "Sign out",
            hint: "End this session",
            icon: SignOut,
            action: onLogout,
            group: "Actions",
            keywords: "sign out logout exit session".toLowerCase(),
          }]
        : []),
    ];

    return [...nav, ...settings, ...actions];
  }, [userRole, isSuperAdmin, clientInfo, onLogout]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => item.keywords.includes(q));
  }, [items, query]);

  // Keep the active index inside the filtered list
  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  const runItem = useCallback(
    (item: PaletteItem) => {
      if (item.action) {
        onOpenChange(false);
        item.action();
        return;
      }
      if (item.href) {
        haptic("light");
        onOpenChange(false);
        router.push(item.href);
      }
    },
    [onOpenChange, router, haptic],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % Math.max(filtered.length, 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + filtered.length) % Math.max(filtered.length, 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = filtered[activeIndex];
        if (item) runItem(item);
      }
    },
    [filtered, activeIndex, runItem],
  );

  const groups = useMemo(() => {
    const order = [...new Set(filtered.map((i) => i.group))];
    return order.map((group) => ({
      group,
      items: filtered.filter((i) => i.group === group),
    }));
  }, [filtered]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        noPadding
        className="overflow-hidden rounded-2xl border-border/80 shadow-brand-lg"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>

        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-border/70 px-4">
          <MagnifyingGlass className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search pages, settings, actions…"
            className="h-14 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-list"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="hidden shrink-0 rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground sm:inline">
            esc
          </kbd>
        </div>

        {/* Results */}
        <div
          id="command-palette-list"
          className="max-h-[52vh] overflow-y-auto overscroll-contain p-2"
          role="listbox"
        >
          {groups.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <MagnifyingGlass className="h-5 w-5 text-muted-foreground/50" />
              <p className="text-sm font-medium text-muted-foreground">No matching pages</p>
              <p className="text-xs text-muted-foreground/70">Try a different search term.</p>
            </div>
          ) : (
            groups.map(({ group, items: groupItems }, gi) => (
              <div key={group} className={cn(gi > 0 && "mt-1 border-t border-border/50 pt-1")}>
                <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">
                  {group}
                </p>
                {groupItems.map((item, ii) => {
                  const index = groups
                    .slice(0, gi)
                    .reduce((acc, g) => acc + g.items.length, 0) + ii;
                  const active = index === activeIndex;
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => runItem(item)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-100",
                        active ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                      )}
                    >
                      <Icon
                        className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "text-muted-foreground/60")}
                        weight={active ? "fill" : "regular"}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.label}</span>
                      <span className="hidden font-mono text-[10px] text-muted-foreground/60 sm:inline">
                        {item.hint}
                      </span>
                      {active && <CaretRight className="h-3.5 w-3.5 shrink-0 text-primary" />}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hints */}
        <div className="flex items-center gap-4 border-t border-border/70 bg-muted/30 px-4 py-2.5 text-[10px] font-medium text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <kbd className="rounded border border-border bg-card px-1 py-0.5 font-mono">↑</kbd>
            <kbd className="rounded border border-border bg-card px-1 py-0.5 font-mono">↓</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="rounded border border-border bg-card px-1 py-0.5 font-mono">↵</kbd>
            open
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            <kbd className="rounded border border-border bg-card px-1 py-0.5 font-mono">⌘K</kbd>
            toggle
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
