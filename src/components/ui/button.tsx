import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // Base — native-feel: no tap flash, press scale, smooth transitions
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "text-sm font-semibold leading-snug",
    "ring-offset-background",
    "transition-[transform,box-shadow,background-color,opacity,filter] duration-150 ease-out",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    "disabled:pointer-events-none disabled:opacity-50",
    "active:brightness-[0.92]",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
    "select-none",
  ].join(" "),
  {
    variants: {
      variant: {
        /* Primary — brand blue */
        default:
          "bg-primary text-primary-foreground shadow-brand-sm hover:bg-primary/90 hover:shadow-brand-md rounded-lg [box-shadow:inset_0_1px_0_hsl(0_0%_100%/0.14),var(--shadow-brand-sm)]",

        /* Destructive — red */
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 rounded-lg",

        /* Outline */
        outline:
          "border border-input bg-card text-foreground hover:bg-muted hover:border-primary/40 rounded-lg shadow-brand-xs",

        /* Secondary — muted fill */
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-muted rounded-lg shadow-none",

        /* Ghost — subtle hover */
        ghost:
          "text-foreground hover:bg-muted hover:text-foreground rounded-lg",

        /* Ghost Brand — text-primary, hover brand bg */
        "ghost-brand":
          "text-primary hover:bg-primary/10 hover:text-primary rounded-lg",

        /* Brand Gold accent */
        brand:
          "bg-accent text-accent-foreground shadow-brand-sm hover:bg-accent/88 rounded-lg",

        /* Glass morphism */
        glass:
          "glass text-foreground hover:bg-card/90 rounded-lg shadow-brand-sm",

        /* Link */
        link:
          "text-primary underline-offset-4 hover:underline p-0 h-auto",
      },
      size: {
        // Mobile-first touch targets (44px WCAG 2.5.5); desktop steps down to 40px.
        default: "h-11 min-h-11 md:h-10 md:min-h-10 px-4 py-2",
        sm:      "h-10 min-h-10 md:h-9  md:min-h-9  px-3 py-1.5 text-xs",
        lg:      "h-11 min-h-11 px-6 py-2.5 text-base",
        xl:      "h-12 min-h-12 px-8 py-3  text-base",
        icon:    "h-11 w-11 md:h-10 md:w-10",
        "icon-sm": "h-8 w-8",
        "icon-lg": "h-11 w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
