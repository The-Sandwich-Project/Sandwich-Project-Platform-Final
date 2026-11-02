/**
 * Badge that flags an event date as conflicting with a known
 * Atlanta-area traffic event (e.g. World Cup matches at Mercedes-Benz Stadium).
 */
import { Badge } from '@/components/ui/badge';
import { AlertTriangle } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  getTrafficConflictForEvent,
  type TrafficConflict,
} from '@shared/traffic-conflicts';

interface TrafficConflictBadgeProps {
  /** Any combination of dates to check (e.g. desired + scheduled). */
  dates: Array<Date | string | null | undefined>;
  className?: string;
  /** When true, render only the icon + label; skip the match detail in the badge. */
  compact?: boolean;
}

export function TrafficConflictBadge({
  dates,
  className = '',
  compact = false,
}: TrafficConflictBadgeProps) {
  const conflict = getTrafficConflictForEvent(...dates);
  if (!conflict) return null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={`gap-1 border-tsp-red bg-tsp-red/10 text-tsp-red hover:bg-tsp-red/15 ${className}`}
          >
            <span className="text-sm leading-none">⚽</span>
            {compact ? (
              <span>World Cup traffic</span>
            ) : (
              <span>
                {conflict.label}
                <span className="ml-1 font-normal opacity-80">
                  · {conflict.detail}
                </span>
              </span>
            )}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <TrafficConflictTooltipBody conflict={conflict} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function TrafficConflictTooltipBody({ conflict }: { conflict: TrafficConflict }) {
  return (
    <div className="space-y-1 text-xs">
      <div className="font-semibold">{conflict.label}</div>
      <div>{conflict.detail}</div>
      <div className="opacity-80">Kickoff: {conflict.kickoffEt}</div>
      <div className="pt-1 opacity-80">
        Expect heavy Atlanta-area traffic before and after the match. Consider
        an earlier start time, an alternate date, or an off-peak window.
      </div>
    </div>
  );
}
