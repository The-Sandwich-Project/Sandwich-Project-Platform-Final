import * as React from 'react';

import { cn } from '@/lib/utils';

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, onWheel, ...props }, ref) => {
    // Browsers step a focused number input on mouse-wheel/trackpad scroll, so
    // scrolling the page with the cursor over the field silently turns 1600
    // into 1599. Drop focus first so the scroll moves the page instead.
    const handleWheel = (e: React.WheelEvent<HTMLInputElement>) => {
      if (type === 'number' && document.activeElement === e.currentTarget) {
        e.currentTarget.blur();
      }
      onWheel?.(e);
    };

    return (
      <input
        type={type}
        onWheel={handleWheel}
        className={cn(
          'flex min-h-[44px] h-11 md:h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-base text-gray-900 placeholder:text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';

export { Input };
