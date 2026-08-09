import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold leading-none transition-colors select-none",
  {
    variants: {
      variant: {
        /* Core */
        default:     "bg-primary text-primary-foreground",
        secondary:   "bg-secondary text-secondary-foreground border border-border",
        destructive: "bg-destructive/10 text-destructive border border-destructive/20",
        outline:     "border border-border text-foreground bg-transparent",

        /* Semantic */
        success:  "bg-success/10 text-success border border-success/30",
        warning:  "bg-warning/10 text-warning-strong border border-warning/30",
        info:     "bg-primary/10 text-primary border border-primary/30",
        error:    "bg-destructive/10 text-destructive border border-destructive/30",

        /* Brand */
        brand:  "bg-brand-blue text-white",
        gold:   "bg-brand-gold text-white",
        "gold-outline": "border border-brand-gold text-brand-gold bg-brand-gold-pale",
        "brand-outline": "border border-brand-blue text-brand-blue bg-brand-blue-pale",

        /* Status — used for employee status chips */
        active:   "bg-success/10 text-success border border-success/30",
        inactive: "bg-muted text-muted-foreground border border-border",
        leave:    "bg-warning/10 text-warning-strong border border-warning/30",
        exited:   "bg-destructive/10 text-destructive border border-destructive/30",

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
