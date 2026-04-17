import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/* ─── Card variants ──────────────────────────────────────────── */
const cardVariants = cva(
  "rounded-xl bg-card text-card-foreground",
  {
    variants: {
      variant: {
        default:     "border border-border shadow-card",
        elevated:    "border border-border shadow-brand-md",
        interactive: "border border-border shadow-card card-interactive cursor-pointer",
        flush:       "border border-border",
        ghost:       "bg-muted/50 border-0",
        brand:       "gradient-brand text-white border-0 shadow-brand-md",
        gold:        "gradient-gold text-white border-0 shadow-gold",
        outline:     "border-2 border-border bg-transparent",
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
    className={cn("flex flex-col space-y-1 p-4 sm:p-5", className)}
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
      "text-base font-semibold leading-snug tracking-tight font-exo2",
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
    className={cn("p-4 sm:p-5 pt-0", className)}
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
      "flex items-center p-4 sm:p-5 pt-0 gap-2",
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
