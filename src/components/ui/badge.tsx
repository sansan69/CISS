import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold transition-colors select-none",
  {
    variants: {
      variant: {
        /* Core */
        default:     "bg-primary text-primary-foreground",
        secondary:   "bg-secondary text-secondary-foreground border border-border",
        destructive: "bg-destructive/10 text-destructive border border-destructive/20",
        outline:     "border border-border text-foreground bg-transparent",

        /* Semantic */
        success:  "bg-green-50  text-green-700  border border-green-200  dark:bg-green-950/60  dark:text-green-400  dark:border-green-800",
        warning:  "bg-amber-50  text-amber-700  border border-amber-200  dark:bg-amber-950/60  dark:text-amber-400  dark:border-amber-800",
        info:     "bg-blue-50   text-blue-700   border border-blue-200   dark:bg-blue-950/60   dark:text-blue-400   dark:border-blue-800",
        error:    "bg-red-50    text-red-700    border border-red-200    dark:bg-red-950/60    dark:text-red-400    dark:border-red-800",

        /* Brand */
        brand:  "bg-brand-blue text-white",
        gold:   "bg-brand-gold text-white",
        "gold-outline": "border border-brand-gold text-brand-gold bg-brand-gold-pale",
        "brand-outline": "border border-brand-blue text-brand-blue bg-brand-blue-pale",

        /* Status — used for employee status chips */
        active:   "bg-green-50  text-green-700  border border-green-200  dark:bg-green-950/60  dark:text-green-400  dark:border-green-800",
        inactive: "bg-gray-100  text-gray-600   border border-gray-200   dark:bg-gray-800      dark:text-gray-400   dark:border-gray-700",
        leave:    "bg-amber-50  text-amber-700  border border-amber-200  dark:bg-amber-950/60  dark:text-amber-400  dark:border-amber-800",
        exited:   "bg-red-50    text-red-600    border border-red-200    dark:bg-red-950/60    dark:text-red-400    dark:border-red-800",

        /* Muted */
        muted: "bg-muted text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
