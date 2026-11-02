interface SVGIconProps {
  className?: string;
  color?: string;
}

export function SandwichStackIcon({
  className = 'w-8 h-8',
  color = 'currentColor',
}: SVGIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <defs>
        <linearGradient id="sandwichGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop
            offset="0%"
            style={{ stopColor: 'var(--color-brand-secondary)', stopOpacity: 1 }}
          />
          <stop
            offset="100%"
            style={{ stopColor: '#f09f2b', stopOpacity: 1 }}
          />
        </linearGradient>
      </defs>
      {/* Bread slices */}
      <path
        d="M3 6h18c1 0 1.5 0.5 1.5 1.5S22 9 21 9H3c-1 0-1.5-0.5-1.5-1.5S2 6 3 6z"
        fill="url(#sandwichGrad)"
      />
      <path
        d="M3 18h18c1 0 1.5-0.5 1.5-1.5S22 15 21 15H3c-1 0-1.5 0.5-1.5 1.5S2 18 3 18z"
        fill="url(#sandwichGrad)"
      />
      {/* Filling layers */}
      <rect x="2" y="10" width="20" height="1.5" fill="#4ade80" opacity="0.8" />
      <rect x="2" y="12" width="20" height="1.5" fill="#ef4444" opacity="0.8" />
      <rect x="2" y="13.5" width="20" height="1" fill="#fbbf24" opacity="0.8" />
    </svg>
  );
}

export function GrowthTrendIcon({
  className = 'w-8 h-8',
  color = 'currentColor',
}: SVGIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <defs>
        <linearGradient id="growthGrad" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop
            offset="0%"
            style={{ stopColor: 'var(--color-brand-primary)', stopOpacity: 1 }}
          />
          <stop
            offset="100%"
            style={{ stopColor: '#47B3CB', stopOpacity: 1 }}
          />
        </linearGradient>
      </defs>
      <path
        d="M3 17l6-6 4 4 8-8"
        stroke="url(#growthGrad)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14 7h7v7"
        stroke="url(#growthGrad)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="9" cy="11" r="2" fill="var(--color-brand-secondary)" opacity="0.8" />
      <circle cx="15" cy="5" r="2" fill="var(--color-brand-secondary)" opacity="0.8" />
      <circle cx="21" cy="3" r="2" fill="var(--color-brand-secondary)" opacity="0.8" />
    </svg>
  );
}

export function CommunityIcon({
  className = 'w-8 h-8',
  color = 'currentColor',
}: SVGIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <defs>
        <linearGradient id="communityGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop
            offset="0%"
            style={{ stopColor: 'var(--color-brand-accent)', stopOpacity: 1 }}
          />
          <stop
            offset="50%"
            style={{ stopColor: 'var(--color-brand-secondary)', stopOpacity: 1 }}
          />
          <stop
            offset="100%"
            style={{ stopColor: 'var(--color-brand-primary)', stopOpacity: 1 }}
          />
        </linearGradient>
      </defs>
      {/* People silhouettes */}
      <circle cx="9" cy="7" r="3" fill="url(#communityGrad)" opacity="0.8" />
      <circle cx="15" cy="7" r="3" fill="url(#communityGrad)" opacity="0.8" />
      <circle cx="12" cy="11" r="3" fill="url(#communityGrad)" opacity="0.9" />
      <path
        d="M3 20v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"
        stroke="url(#communityGrad)"
        strokeWidth="2"
      />
      <path
        d="M17 20v-2a4 4 0 0 0-3-3.87"
        stroke="url(#communityGrad)"
        strokeWidth="2"
      />
      <path
        d="M21 20v-2a4 4 0 0 0-3-3.87"
        stroke="url(#communityGrad)"
        strokeWidth="2"
      />
    </svg>
  );
}

export function TargetIcon({
  className = 'w-8 h-8',
  color = 'currentColor',
}: SVGIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <defs>
        <radialGradient id="targetGrad" cx="50%" cy="50%" r="50%">
          <stop
            offset="0%"
            style={{ stopColor: 'var(--color-brand-secondary)', stopOpacity: 1 }}
          />
          <stop
            offset="70%"
            style={{ stopColor: 'var(--color-brand-primary)', stopOpacity: 0.8 }}
          />
          <stop
            offset="100%"
            style={{ stopColor: 'var(--color-brand-accent)', stopOpacity: 0.6 }}
          />
        </radialGradient>
      </defs>
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="url(#targetGrad)"
        strokeWidth="2"
        fill="none"
      />
      <circle
        cx="12"
        cy="12"
        r="6"
        stroke="url(#targetGrad)"
        strokeWidth="2"
        fill="none"
      />
      <circle cx="12" cy="12" r="2" fill="url(#targetGrad)" />
      <path
        d="M12 2v4M12 18v4M2 12h4M18 12h4"
        stroke="url(#targetGrad)"
        strokeWidth="2"
      />
    </svg>
  );
}

export function SparkleIcon({
  className = 'w-8 h-8',
  color = 'currentColor',
}: SVGIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <defs>
        <linearGradient id="sparkleGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop
            offset="0%"
            style={{ stopColor: 'var(--color-brand-secondary)', stopOpacity: 1 }}
          />
          <stop offset="50%" style={{ stopColor: '#fbbf24', stopOpacity: 1 }} />
          <stop
            offset="100%"
            style={{ stopColor: '#f59e0b', stopOpacity: 1 }}
          />
        </linearGradient>
      </defs>
      <path
        d="M12 2l2.5 7h7.5l-6 4.5 2.5 7-6-4.5-6 4.5 2.5-7-6-4.5h7.5z"
        fill="url(#sparkleGrad)"
      />
      <circle
        cx="18"
        cy="6"
        r="1.5"
        fill="var(--color-brand-secondary)"
        opacity="0.8"
        className="animate-pulse"
      />
      <circle
        cx="6"
        cy="18"
        r="1"
        fill="var(--color-brand-secondary)"
        opacity="0.6"
        className="animate-pulse"
      />
      <circle
        cx="20"
        cy="16"
        r="1"
        fill="var(--color-brand-secondary)"
        opacity="0.7"
        className="animate-pulse"
      />
    </svg>
  );
}

export function NetworkIcon({
  className = 'w-8 h-8',
  color = 'currentColor',
}: SVGIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <defs>
        <linearGradient id="networkGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: '#236383', stopOpacity: 1 }} />
          <stop
            offset="100%"
            style={{ stopColor: '#47B3CB', stopOpacity: 1 }}
          />
        </linearGradient>
      </defs>
      {/* Network nodes */}
      <circle cx="12" cy="12" r="3" fill="url(#networkGrad)" />
      <circle cx="6" cy="6" r="2" fill="url(#networkGrad)" opacity="0.8" />
      <circle cx="18" cy="6" r="2" fill="url(#networkGrad)" opacity="0.8" />
      <circle cx="6" cy="18" r="2" fill="url(#networkGrad)" opacity="0.8" />
      <circle cx="18" cy="18" r="2" fill="url(#networkGrad)" opacity="0.8" />
      {/* Connections */}
      <path
        d="M8 8l6 6M16 8l-6 6M12 9v6M9 12h6"
        stroke="url(#networkGrad)"
        strokeWidth="2"
        opacity="0.6"
      />
    </svg>
  );
}
