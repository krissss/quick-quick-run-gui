import { cva } from 'class-variance-authority'

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-all cursor-pointer disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground rounded-md hover:opacity-90',
        secondary: 'bg-secondary text-secondary-foreground rounded-md shadow-[var(--shadow-border)] hover:bg-border',
        destructive: 'bg-destructive/10 text-destructive rounded-md hover:bg-destructive/20',
        ghost: 'hover:bg-accent hover:text-accent-foreground rounded-md',
        outline: 'rounded-md bg-transparent hover:bg-accent hover:text-accent-foreground shadow-[var(--shadow-border)]',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-7 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-6',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)
