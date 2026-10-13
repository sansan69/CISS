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
  SpinnerGap,
  UserPlus,
} from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { useAppAuth } from "@/context/auth-context";
import { isDesignatedAadhaarAdministrator } from "@/lib/aadhaar-admin-policy";
import { authorizedFetch } from "@/lib/api-client";
import { db } from "@/lib/firebase";
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  startAt,
  endAt,
  where,
} from "firebase/firestore";
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
  /** Avatar initials rendered when present (data results, e.g. employees) */
  avatar?: string;
  /** Short badge/meta rendered next to the label (e.g. status) */
  meta?: string;
};

type EmployeeSearchResult = {
  docId: string;
  fullName: string;
  employeeId: string;
  clientName: string;
  status: string;
  phoneNumber?: string;
  createdAtMillis: number;
};

const EMPLOYEE_SEARCH_LIMIT = 8;
const EMPLOYEE_DEBOUNCE_MS = 220;

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function employeeToResult(data: Record<string, unknown>, docId: string): EmployeeSearchResult {
  const createdAtMillis =
    typeof (data.createdAt as any)?.toMillis === "function"
      ? (data.createdAt as any).toMillis()
      : 0;
  return {
    docId,
    fullName: String(data.fullName || data.employeeId || "Unknown employee"),
    employeeId: String(data.employeeId || ""),
    clientName: String(data.clientName || "Unassigned"),
    status: String(data.status || "Unknown"),
    phoneNumber: data.phoneNumber ? String(data.phoneNumber) : undefined,
    createdAtMillis,
  };
}

/**
 * ⌘K command palette — keyboard-driven navigation across every role's
 * visible pages plus quick actions. Opens with ⌘K / Ctrl+K, filters as you
 * type, navigates with ↑/↓ + Enter, closes with Esc.
 *
 * When the user types, the palette also searches the employee directory
 * (name / employee ID / phone) scoped by role — field officers only see
 * their assigned districts, client users only their own client.
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
  const { user, userRole, isSuperAdmin, clientInfo, assignedDistricts } = useAppAuth();
  const [paletteQuery, setPaletteQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [employeeResults, setEmployeeResults] = useState<EmployeeSearchResult[]>([]);
  const [searchingEmployees, setSearchingEmployees] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchSeq = useRef(0);
  const clientGuardCache = useRef<EmployeeSearchResult[] | null>(null);

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
      setPaletteQuery("");
      setActiveIndex(0);
      setEmployeeResults([]);
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

  // ── Employee search ───────────────────────────────────────────────────────
  // Mirrors the employee-directory search pattern: prefix queries on fullName
  // (case variants) + exact employeeId / phoneNumber matches, scoped by role.
  const searchEmployees = useCallback(
    async (term: string): Promise<EmployeeSearchResult[]> => {
      const trimmed = term.trim();
      if (!trimmed) return [];

      // Client users: guards are served through a permission-scoped API.
      if (userRole === "client") {
        if (!clientGuardCache.current) {
          const response = await authorizedFetch("/api/client/guards?limit=500&includeInactive=true");
          if (!response.ok) return [];
          const body = await response.json().catch(() => ({}));
          clientGuardCache.current = ((body.guards ?? []) as Record<string, unknown>[]).map(
            (guard, index) => employeeToResult(guard, String(guard.docId || guard.id || `client-${index}`)),
          );
        }
        const lower = trimmed.toLowerCase();
        return clientGuardCache.current
          .filter((guard) =>
            [guard.fullName, guard.employeeId, guard.phoneNumber]
              .filter(Boolean)
              .some((value) => String(value).toLowerCase().includes(lower)),
          )
          .slice(0, EMPLOYEE_SEARCH_LIMIT);
      }

      // Field officers without assigned districts see no employees.
      if (userRole === "fieldOfficer" && assignedDistricts.length === 0) return [];

      let baseQuery: any = collection(db, "employees");
      if (userRole === "fieldOfficer") {
        baseQuery = query(baseQuery, where("district", "in", assignedDistricts.slice(0, 30)));
      }

      const termCap = trimmed.replace(/\b\w/g, (c) => c.toUpperCase());
      const termUpper = trimmed.toUpperCase();
      const queries: Promise<any>[] = [];

      queries.push(getDocs(query(baseQuery, orderBy("fullName"), startAt(trimmed), endAt(trimmed + "\uf8ff"), limit(EMPLOYEE_SEARCH_LIMIT))));
      if (termCap !== trimmed) {
        queries.push(getDocs(query(baseQuery, orderBy("fullName"), startAt(termCap), endAt(termCap + "\uf8ff"), limit(EMPLOYEE_SEARCH_LIMIT))));
      }
      if (termUpper !== trimmed && termUpper !== termCap) {
        queries.push(getDocs(query(baseQuery, orderBy("fullName"), startAt(termUpper), endAt(termUpper + "\uf8ff"), limit(EMPLOYEE_SEARCH_LIMIT))));
      }
      if (trimmed.length >= 4) {
        queries.push(getDocs(query(baseQuery, where("employeeId", "==", termUpper))));
      }
      const digits = trimmed.replace(/\D/g, "");
      if (digits.length >= 6) {
        queries.push(getDocs(query(baseQuery, where("phoneNumber", "==", digits))));
      }

      const snapshots = await Promise.all(queries);
      const seen = new Set<string>();
      const merged: EmployeeSearchResult[] = [];
      snapshots.forEach((snap) => {
        snap.docs.forEach((d: any) => {
          if (seen.has(d.id)) return;
          seen.add(d.id);
          merged.push(employeeToResult(d.data(), d.id));
        });
      });
      merged.sort((a, b) => b.createdAtMillis - a.createdAtMillis);
      return merged.slice(0, EMPLOYEE_SEARCH_LIMIT);
    },
    [userRole, assignedDistricts],
  );

  // Debounced employee search while typing
  useEffect(() => {
    if (!open) return;
    const seq = ++searchSeq.current;
    setSearchingEmployees(true);
    const id = window.setTimeout(() => {
      void searchEmployees(paletteQuery)
        .then((results) => {
          if (searchSeq.current !== seq) return;
          setEmployeeResults(results);
        })
        .catch(() => {
          if (searchSeq.current !== seq) return;
          setEmployeeResults([]);
        })
        .finally(() => {
          if (searchSeq.current === seq) setSearchingEmployees(false);
        });
    }, EMPLOYEE_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [paletteQuery, open, searchEmployees]);

  const employeeItems = useMemo<PaletteItem[]>(
    () =>
      employeeResults.map((employee) => ({
        key: `emp:${employee.docId}`,
        label: employee.fullName,
        hint: employee.employeeId || employee.clientName,
        icon: MagnifyingGlass,
        href: `/employees/${employee.docId}`,
        group: "Employees",
        keywords: `${employee.fullName} ${employee.employeeId} ${employee.clientName} ${employee.status} employee guard staff`.toLowerCase(),
        avatar: initialsOf(employee.fullName),
        meta: employee.status,
      })),
    [employeeResults],
  );

  const filtered = useMemo(() => {
    const q = paletteQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => item.keywords.includes(q));
  }, [items, paletteQuery]);

  // Keep the active index inside the combined list (employees first, then pages)
  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(0, employeeItems.length + filtered.length - 1)));
  }, [employeeItems.length, filtered.length]);

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
      const total = employeeItems.length + filtered.length;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % Math.max(total, 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + total) % Math.max(total, 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (employeeItems.length > 0 && activeIndex < employeeItems.length) {
          runItem(employeeItems[activeIndex]);
        } else {
          const item = filtered[activeIndex - employeeItems.length];
          if (item) runItem(item);
        }
      }
    },
    [employeeItems, filtered, activeIndex, runItem],
  );

  const groups = useMemo(() => {
    const order = [...new Set(filtered.map((i) => i.group))];
    const pageGroups = order.map((group) => ({
      group,
      items: filtered.filter((i) => i.group === group),
    }));
    return [
      ...(employeeItems.length > 0 ? [{ group: "Employees", items: employeeItems }] : []),
      ...pageGroups,
    ];
  }, [employeeItems, filtered]);

  const showEmployeeSpinner = searchingEmployees && paletteQuery.trim().length > 0 && employeeItems.length === 0;
  const canEnroll = isDesignatedAadhaarAdministrator({
    email: user?.email,
    emailVerified: user?.emailVerified,
    role: userRole,
  });

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
            value={paletteQuery}
            onChange={(e) => setPaletteQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search pages, employees, actions…"
            className="h-14 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-list"
            autoComplete="off"
            spellCheck={false}
          />
          {searchingEmployees ? (
            <SpinnerGap className="h-4 w-4 shrink-0 animate-spin text-muted-foreground/60" aria-hidden="true" />
          ) : (
            <kbd className="hidden shrink-0 rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground sm:inline">
              esc
            </kbd>
          )}
        </div>

        {/* Results */}
        <div
          id="command-palette-list"
          className="max-h-[52vh] overflow-y-auto overscroll-contain p-2"
          role="listbox"
        >
          {groups.length === 0 && !showEmployeeSpinner ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <MagnifyingGlass className="h-5 w-5 text-muted-foreground/50" />
              <p className="text-sm font-medium text-muted-foreground">No matching pages or employees</p>
              <p className="text-xs text-muted-foreground/70">
                Try a page name, employee name, employee ID, or phone number.
              </p>
              {canEnroll && (
                <button
                  type="button"
                  onClick={() => {
                    haptic("light");
                    onOpenChange(false);
                    router.push("/employees/enroll");
                  }}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted hover:text-primary"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  Enroll a new employee
                </button>
              )}
            </div>
          ) : (
            <>
              {showEmployeeSpinner && (
                <div className="px-3 py-8 text-center">
                  <p className="text-xs font-medium text-muted-foreground">Searching employees…</p>
                </div>
              )}
              {groups.map(({ group, items: groupItems }, gi) => (
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
                        {item.avatar ? (
                          <Avatar className="h-7 w-7 shrink-0">
                            <AvatarFallback className="bg-brand-blue/10 text-brand-blue text-[10px] font-bold">
                              {item.avatar}
                            </AvatarFallback>
                          </Avatar>
                        ) : (
                          <Icon
                            className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "text-muted-foreground/60")}
                            weight={active ? "fill" : "regular"}
                          />
                        )}
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.label}</span>
                        {item.meta && (
                          <span
                            className={cn(
                              "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold",
                              item.meta === "Active"
                                ? "bg-success/10 text-success"
                                : item.meta === "Inactive" || item.meta === "Exited"
                                  ? "bg-muted text-muted-foreground"
                                  : "bg-muted text-muted-foreground",
                            )}
                          >
                            {item.meta}
                          </span>
                        )}
                        <span className="hidden font-mono text-[10px] text-muted-foreground/60 sm:inline">
                          {item.hint}
                        </span>
                        {active && <CaretRight className="h-3.5 w-3.5 shrink-0 text-primary" />}
                      </button>
                    );
                  })}
                </div>
              ))}
            </>
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
