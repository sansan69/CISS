import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/* ─── Card variants ──────────────────────────────────────────── */
const cardVariants = cva(
  "rounded-2xl bg-card text-card-foreground",
  {
    variants: {
      variant: {
        default:     "border border-border/80",
        elevated:    "border border-border/80 shadow-brand-md",
        interactive: "cursor-pointer border border-border/80 card-interactive",
        flush:       "border border-border/80",
        ghost:       "border-0 bg-muted/45",
        brand:       "border-0 bg-brand-blue text-white",
        gold:        "border-0 bg-brand-gold text-white",
        outline:     "border border-border bg-transparent shadow-none",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(cardVariants({ variant }), className)}
      {...props}
    />
  )
)
Card.displayName = "Card"

/* ─── CardHeader ─────────────────────────────────────────────── */
const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col gap-1.5 border-b border-border/70 p-5 sm:p-6", className)}
    {...props}
  />
))
CardHeader.displayName = "CardHeader"

/* ─── CardTitle ──────────────────────────────────────────────── */
const CardTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "font-exo2 text-base font-bold leading-snug tracking-[-0.02em] [text-wrap:balance]",
      className
    )}
    {...props}
  />
))
CardTitle.displayName = "CardTitle"

/* ─── CardDescription ────────────────────────────────────────── */
const CardDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm text-muted-foreground leading-relaxed", className)}
    {...props}
  />
))
CardDescription.displayName = "CardDescription"

/* ─── CardContent ────────────────────────────────────────────── */
const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("p-5 sm:p-6", className)}
    {...props}
  />
))
CardContent.displayName = "CardContent"

/* ─── CardFooter ─────────────────────────────────────────────── */
const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex items-center gap-2 border-t border-border/70 p-5 sm:p-6",
      className
    )}
    {...props}
  />
))
CardFooter.displayName = "CardFooter"

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
  cardVariants,
}
