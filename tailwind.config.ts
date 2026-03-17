import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        /* ── CISS Brand direct tokens ── */
        "brand-blue":        "#014c85",
        "brand-blue-dark":   "#013a6b",
        "brand-blue-darker": "#012d54",
        "brand-blue-light":  "#0261a8",
        "brand-blue-pale":   "#e8f1f9",
        "brand-gold":        "#bd9c55",
        "brand-gold-dark":   "#a8893e",
        "brand-gold-light":  "#cdb06a",
        "brand-gold-pale":   "#faf4e8",

        /* ── Semantic (ShadCN CSS-var) ── */
        background:  "hsl(var(--background))",
        foreground:  "hsl(var(--foreground))",

        card: {
          DEFAULT:    "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT:    "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT:    "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT:    "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT:    "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT:    "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT:    "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        success: {
          DEFAULT:    "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT:    "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        border:  "hsl(var(--border))",
        input:   "hsl(var(--input))",
        ring:    "hsl(var(--ring))",

        chart: {
          "1": "hsl(var(--chart-1))",
          "2": "hsl(var(--chart-2))",
          "3": "hsl(var(--chart-3))",
          "4": "hsl(var(--chart-4))",
          "5": "hsl(var(--chart-5))",
        },

        sidebar: {
          DEFAULT:              "hsl(var(--sidebar-background))",
          foreground:           "hsl(var(--sidebar-foreground))",
          primary:              "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent:               "hsl(var(--sidebar-accent))",
          "accent-foreground":  "hsl(var(--sidebar-accent-foreground))",
          border:               "hsl(var(--sidebar-border))",
          ring:                 "hsl(var(--sidebar-ring))",
        },
      },

      borderRadius: {
        "2xl": "1rem",
        xl:    "0.75rem",
        lg:    "var(--radius)",
        md:    "calc(var(--radius) - 2px)",
        sm:    "calc(var(--radius) - 4px)",
      },

      boxShadow: {
        "brand-xs":  "0 1px 2px 0 rgb(1 76 133 / 0.06)",
        "brand-sm":  "0 2px 6px -1px rgb(1 76 133 / 0.10), 0 1px 3px -1px rgb(1 76 133 / 0.06)",
        "brand-md":  "0 4px 12px -2px rgb(1 76 133 / 0.12), 0 2px 6px -2px rgb(1 76 133 / 0.08)",
        "brand-lg":  "0 10px 24px -4px rgb(1 76 133 / 0.14), 0 4px 12px -4px rgb(1 76 133 / 0.08)",
        "card":      "0 1px 3px 0 rgb(1 76 133 / 0.08), 0 1px 2px -1px rgb(1 76 133 / 0.06)",
        "elevated":  "0 8px 20px -4px rgb(1 76 133 / 0.16), 0 4px 8px -4px rgb(1 76 133 / 0.10)",
        "inner-sm":  "inset 0 1px 3px 0 rgb(1 76 133 / 0.08)",
        "gold":      "0 4px 14px 0 rgb(189 156 85 / 0.4)",
        "glow-blue": "0 0 20px rgb(1 76 133 / 0.3)",
      },

      fontSize: {
        "2xs": ["0.625rem", { lineHeight: "0.875rem" }],
      },

      spacing: {
        "safe-bottom": "max(env(safe-area-inset-bottom), 8px)",
        "safe-top":    "env(safe-area-inset-top)",
        "18":  "4.5rem",
        "22":  "5.5rem",
        "88":  "22rem",
        "100": "25rem",
        "112": "28rem",
      },

      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to:   { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to:   { height: "0" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to:   { opacity: "1" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
        "slide-down": {
          from: { opacity: "0", transform: "translateY(-12px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in-left": {
          from: { opacity: "0", transform: "translateX(-16px)" },
          to:   { opacity: "1", transform: "translateX(0)" },
        },
        "slide-in-right": {
          from: { opacity: "0", transform: "translateX(16px)" },
          to:   { opacity: "1", transform: "translateX(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.94)" },
          to:   { opacity: "1", transform: "scale(1)" },
        },
        "scale-bounce": {
          "0%":   { transform: "scale(0.88)", opacity: "0" },
          "60%":  { transform: "scale(1.04)", opacity: "1" },
          "100%": { transform: "scale(1)" },
        },
        "shimmer": {
          from: { backgroundPosition: "-200% center" },
          to:   { backgroundPosition:  "200% center" },
        },
        "pulse-glow": {
          "0%, 100%": { boxShadow: "0 0 0 0 hsl(var(--primary) / 0.4)" },
          "50%":       { boxShadow: "0 0 0 8px hsl(var(--primary) / 0)" },
        },
        "count-up": {
          from: { transform: "translateY(8px)", opacity: "0" },
          to:   { transform: "translateY(0)",   opacity: "1" },
        },
        "nav-active": {
          from: { transform: "scaleX(0)", opacity: "0" },
          to:   { transform: "scaleX(1)", opacity: "1" },
        },
        "bounce-x": {
          "0%, 100%": { transform: "translateX(0)" },
          "50%":       { transform: "translateX(4px)" },
        },
        "spin-slow": {
          to: { transform: "rotate(360deg)" },
        },
      },

      animation: {
        "accordion-down":  "accordion-down 0.2s ease-out",
        "accordion-up":    "accordion-up 0.2s ease-out",
        "fade-in":         "fade-in 200ms ease-out both",
        "slide-up":        "slide-up 280ms cubic-bezier(0.16,1,0.3,1) both",
        "slide-down":      "slide-down 280ms cubic-bezier(0.16,1,0.3,1) both",
        "slide-in-left":   "slide-in-left 280ms cubic-bezier(0.16,1,0.3,1) both",
        "slide-in-right":  "slide-in-right 280ms cubic-bezier(0.16,1,0.3,1) both",
        "scale-in":        "scale-in 220ms cubic-bezier(0.16,1,0.3,1) both",
        "scale-bounce":    "scale-bounce 380ms cubic-bezier(0.16,1,0.3,1) both",
        "shimmer":         "shimmer 1.8s linear infinite",
        "pulse-glow":      "pulse-glow 2s ease-in-out infinite",
        "count-up":        "count-up 400ms cubic-bezier(0.16,1,0.3,1) both",
        "nav-active":      "nav-active 240ms cubic-bezier(0.16,1,0.3,1) both",
        "bounce-x":        "bounce-x 1.2s ease-in-out infinite",
        "spin-slow":       "spin-slow 2.4s linear infinite",
      },

      transitionTimingFunction: {
        spring: "cubic-bezier(0.16,1,0.3,1)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
