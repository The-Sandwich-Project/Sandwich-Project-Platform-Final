/** Card badge for next-day pickup: "Next-day pickup" (planned) or "Can hold overnight" (option). */
import * as React from 'react';
import { Moon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { effectiveNextDayPickup } from '@shared/next-day-pickup';

export function NextDayPickupBadge({ event, className = '' }: { event: any; className?: string }) {
  const value = effectiveNextDayPickup(event);
  if (value === 'no') return null;
  const planned = value === 'planned';
  return (
    <Badge
      className={`text-xs sm:text-sm font-medium inline-flex items-center gap-1 ${
        planned ? 'bg-[#236383] text-white border border-[#114145]' : 'bg-[#E9EFF3] text-[#114145] border border-[#47B3CB]'
      } ${className}`}
      title={planned ? 'The group holds the sandwiches overnight; pickup is the next day' : 'The group can hold the sandwiches overnight if needed'}
      data-testid="badge-next-day-pickup"
    >
      <Moon className="w-3 h-3" />
      {planned ? 'Next-day pickup' : 'Can hold overnight'}
    </Badge>
  );
}
