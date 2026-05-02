import React from 'react';
import { cn } from '../../lib/utils';

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("surface-card", className)} {...props} />
  )
);
Card.displayName = "Card";

export const PremiumCard = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("premium-card", className)} {...props} />
  )
);
PremiumCard.displayName = "PremiumCard";

export const InnerPanel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("inner-panel", className)} {...props} />
  )
);
InnerPanel.displayName = "InnerPanel";
