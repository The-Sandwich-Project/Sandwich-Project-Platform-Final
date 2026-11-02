import { Badge } from '@/components/ui/badge';
import { Heart } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface MlkDayBadgeProps {
  className?: string;
  showIcon?: boolean;
}

export function MlkDayBadge({ className = '', showIcon = true }: MlkDayBadgeProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge 
            className={`bg-tsp-navy text-white font-semibold ${className}`}
            data-testid="badge-mlk-day"
          >
            {showIcon && <Heart className="w-3 h-3 mr-1 fill-white" />}
            MLK Day
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p>This event is designated as an MLK Day of Service event</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
