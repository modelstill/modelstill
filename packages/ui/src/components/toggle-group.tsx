"use client"

import * as React from "react"
import { type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { LayoutGroup, motion } from "motion/react"
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui"

import { toggleVariants } from "@modelstill/ui/components/toggle"

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants> & {
    spacing?: number
    selected?: string
    indicatorId?: string
  }
>({
  size: "default",
  variant: "default",
  spacing: 0,
})

function ToggleGroup({
  className,
  variant,
  size,
  spacing = 0,
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> &
  VariantProps<typeof toggleVariants> & {
    spacing?: number
  }) {
  const indicatorId = React.useId()
  const single = props.type === "single"
  const [uncontrolled, setUncontrolled] = React.useState<string | undefined>(
    single ? (props.defaultValue as string | undefined) : undefined
  )
  const selected = single ? ((props.value as string | undefined) ?? uncontrolled) : undefined
  const rootProps = single
    ? {
        ...props,
        onValueChange: (next: string) => {
          setUncontrolled(next)
          ;(props.onValueChange as ((value: string) => void) | undefined)?.(next)
        },
      }
    : props
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      data-spacing={spacing}
      style={{ "--gap": spacing } as React.CSSProperties}
      className={cn(
        "group/toggle-group flex w-fit items-center gap-[--spacing(var(--gap))] rounded-md data-[spacing=default]:data-[variant=outline]:shadow-xs",
        className
      )}
      {...(rootProps as React.ComponentProps<typeof ToggleGroupPrimitive.Root>)}
    >
      <ToggleGroupContext.Provider value={{ variant, size, spacing, selected, indicatorId: single ? indicatorId : undefined }}>
        <LayoutGroup id={indicatorId}>{children}</LayoutGroup>
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive.Root>
  )
}

function ToggleGroupItem({
  className,
  children,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> &
  VariantProps<typeof toggleVariants>) {
  const context = React.useContext(ToggleGroupContext)
  const sliding = context.indicatorId !== undefined
  const active = sliding && context.selected === props.value

  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      data-variant={context.variant || variant}
      data-size={context.size || size}
      data-spacing={context.spacing}
      className={cn(
        toggleVariants({
          variant: context.variant || variant,
          size: context.size || size,
        }),
        "w-auto min-w-0 shrink-0 px-3 focus:z-10 focus-visible:z-10",
        sliding && "relative isolate data-[state=on]:bg-transparent!",
        "data-[spacing=0]:rounded-none data-[spacing=0]:shadow-none data-[spacing=0]:first:rounded-l-md data-[spacing=0]:last:rounded-r-md data-[spacing=0]:data-[variant=outline]:border-l-0 data-[spacing=0]:data-[variant=outline]:first:border-l",
        className
      )}
      {...props}
    >
      {active && (
        <motion.span
          layoutId="toggle-group-indicator"
          data-slot="toggle-group-indicator"
          aria-hidden="true"
          transition={{ type: "spring", stiffness: 520, damping: 42, mass: 0.8 }}
          className="absolute inset-0 -z-10 rounded-[inherit] bg-accent"
        />
      )}
      {children}
    </ToggleGroupPrimitive.Item>
  )
}

export { ToggleGroup, ToggleGroupItem }
