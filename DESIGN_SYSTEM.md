# Design System Documentation

## Overview

This design system provides a consistent, accessible, and professional user interface for The Sandwich Project Platform. It includes unified colors, typography, spacing, components, and utilities to ensure a cohesive experience across all features.

## Table of Contents

1. [Design Tokens](#design-tokens)
2. [Color Palette](#color-palette)
3. [Typography](#typography)
4. [Spacing System](#spacing-system)
5. [Components](#components)
6. [Accessibility](#accessibility)
7. [Responsive Design](#responsive-design)
8. [Usage Examples](#usage-examples)

---

## Design Tokens

All design tokens are centralized in `/client/src/lib/design-tokens.ts`.

### Importing Design Tokens

```typescript
import { BrandColors, Spacing, Typography } from '@/lib/design-tokens';
```

---

## Color Palette

### Brand Colors

```typescript
BrandColors.primary        // #236383 - Main brand color
BrandColors.teal          // #236383 - same as primary (#007E8C was retired from the palette)
BrandColors.orange        // #FBAD3F - Secondary accent
BrandColors.burgundy      // #A31C41 - Tertiary accent
BrandColors.navy          // #1A2332 - Dark accent
```

### Semantic Colors

```typescript
SemanticColors.success        // Green - Success states
SemanticColors.warning        // Yellow - Warning states
SemanticColors.error          // Red - Error states
SemanticColors.info           // Blue - Informational states
```

### Using Colors in Components

```tsx
// Tailwind classes
<div className="bg-brand-primary text-white">Primary Button</div>
<div className="bg-brand-teal text-white">Teal Button</div>

// CSS variables
<div style={{ backgroundColor: 'var(--color-brand-primary)' }}>
  Custom styling
</div>
```

---

## Typography

### Font Families

- **Sans-serif (Body)**: Roboto
- **Headings**: Roboto
- **Highlight/Accent**: Lobster (cursive)

### Font Sizes

| Size | Value | Use Case |
|------|-------|----------|
| xs   | 12px  | Small text, captions |
| sm   | 14px  | Secondary text |
| base | 16px  | Body text (default) |
| lg   | 18px  | Subheadings |
| xl   | 20px  | Section headings |
| 2xl  | 24px  | Page headings |
| 3xl  | 30px  | Hero headings |
| 4xl  | 36px  | Display headings |

### Font Weights

| Weight    | Value | Use Case |
|-----------|-------|----------|
| light     | 300   | Light emphasis |
| normal    | 400   | Body text |
| medium    | 500   | Subheadings |
| semibold  | 600   | Section titles |
| bold      | 700   | Strong emphasis |
| black     | 900   | Extra bold headings |

### Typography Classes

```tsx
<h1 className="font-main-heading">Main Heading</h1>
<h2 className="font-sub-heading">Sub Heading</h2>
<p className="font-body">Body text</p>
<span className="font-highlight">Accent text</span>
```

---

## Spacing System

Based on a **4px increment** scale for consistency.

| Token | Value | Use Case |
|-------|-------|----------|
| xs    | 4px   | Tight spacing |
| sm    | 8px   | Compact layouts |
| md    | 16px  | Default spacing |
| lg    | 24px  | Generous spacing |
| xl    | 32px  | Section separation |
| 2xl   | 48px  | Large gaps |
| 3xl   | 64px  | Extra large gaps |

### Spacing Utilities

```tsx
// Using custom spacing classes
<div className="space-md">
  <div>Item 1</div>
  <div>Item 2</div>
</div>

// Using Tailwind spacing
<div className="p-md">Padded content</div>
<div className="gap-4">Grid with gap</div>
```

---

## Components

### Button Component

Consistent button styles with variants.

```tsx
import { Button } from '@/components/ui/button';

// Variants
<Button variant="default">Primary Action</Button>
<Button variant="destructive">Delete</Button>
<Button variant="outline">Secondary</Button>
<Button variant="ghost">Tertiary</Button>
<Button variant="link">Link Style</Button>

// Sizes
<Button size="sm">Small</Button>
<Button size="default">Default</Button>
<Button size="lg">Large</Button>
<Button size="icon">Icon Only</Button>
```

### Badge Component

Enhanced with status variants.

```tsx
import { Badge } from '@/components/ui/badge';

// Variants
<Badge variant="default">Default</Badge>
<Badge variant="success">Success</Badge>
<Badge variant="warning">Warning</Badge>
<Badge variant="destructive">Error</Badge>
<Badge variant="info">Info</Badge>

// Status badges
<Badge variant="pending">Pending</Badge>
<Badge variant="in-progress">In Progress</Badge>
<Badge variant="completed">Completed</Badge>
<Badge variant="cancelled">Cancelled</Badge>
```

### Empty State Component

Display helpful empty states with calls-to-action.

```tsx
import { EmptyState } from '@/components/ui/empty-state';
import { Calendar } from 'lucide-react';

<EmptyState
  icon={<Calendar className="h-8 w-8" />}
  title="No meetings scheduled"
  description="Get started by creating your first meeting"
  action={{
    label: "Create Meeting",
    onClick: () => handleCreateMeeting()
  }}
  secondaryAction={{
    label: "Learn More",
    onClick: () => handleLearnMore(),
    variant: "outline"
  }}
/>
```

### List Filters Component

Reusable search and filter for list views.

```tsx
import { ListFilters, ActiveFilterTags } from '@/components/ui/list-filters';

const filterGroups = [
  {
    id: 'status',
    label: 'Status',
    options: [
      { id: 'pending', label: 'Pending' },
      { id: 'completed', label: 'Completed' },
    ]
  }
];

<ListFilters
  searchPlaceholder="Search events..."
  searchValue={searchValue}
  onSearchChange={setSearchValue}
  filterGroups={filterGroups}
  activeFilters={activeFilters}
  onFilterChange={handleFilterChange}
  onClearFilters={handleClearFilters}
/>

<ActiveFilterTags
  filterGroups={filterGroups}
  activeFilters={activeFilters}
  onRemoveFilter={handleRemoveFilter}
  onClearAll={handleClearAll}
/>
```

---

## Date Formatting

Consistent date and time display utilities.

```tsx
import {
  formatDate,
  formatRelativeDate,
  formatRelativeDateTime,
  formatTimeAgo,
  formatDateRange,
  formatWeekRange,
  DateFormats
} from '@/lib/date-formats';

// Standard formats
formatDate(new Date(), DateFormats.SHORT)
// Output: "Sep 19, 2024"

formatDate(new Date(), DateFormats.MEDIUM)
// Output: "September 19, 2024"

// Relative dates
formatRelativeDate(new Date())
// Output: "Today"

formatRelativeDateTime(new Date())
// Output: "Today at 2:30 PM"

// Time ago
formatTimeAgo(new Date(Date.now() - 3600000))
// Output: "1 hour ago"

// Date ranges
formatDateRange(startDate, endDate)
// Output: "Sep 19 - Sep 25, 2024"

formatWeekRange(new Date())
// Output: "Week of Sep 19 - Sep 25, 2024"
```

---

## Accessibility

### ARIA Labels

```tsx
import { getIconButtonLabel, getStatusAriaLabel } from '@/lib/accessibility';

// Icon-only buttons
<button aria-label={getIconButtonLabel('edit', 'user profile')}>
  <EditIcon />
</button>

// Status badges
<Badge aria-label={getStatusAriaLabel('in-progress')}>
  In Progress
</Badge>
```

### Keyboard Navigation

```tsx
import { isActionKey, isEscapeKey, trapFocus } from '@/lib/accessibility';

function handleKeyDown(event: React.KeyboardEvent) {
  if (isActionKey(event)) {
    // Handle Enter or Space
    handleAction();
  }

  if (isEscapeKey(event)) {
    // Handle Escape
    handleClose();
  }
}
```

### Screen Reader Announcements

```tsx
import { announceToScreenReader } from '@/lib/accessibility';

function handleSave() {
  // Save data...
  announceToScreenReader('Changes saved successfully', 'polite');
}

function handleError() {
  // Handle error...
  announceToScreenReader('Error saving changes', 'assertive');
}
```

### Focus States

All interactive elements should have clear focus indicators:

```tsx
// Use the focus-ring utility class
<button className="focus-ring">
  Accessible Button
</button>

// Or use the built-in Button component (already includes focus states)
<Button>Already Accessible</Button>
```

---

## Responsive Design

### Breakpoints

| Breakpoint | Size | Use Case |
|------------|------|----------|
| xs         | 480px | Extra small devices |
| sm         | 640px | Small devices |
| md         | 768px | Tablets (mobile breakpoint) |
| lg         | 1024px | Desktop |
| xl         | 1280px | Large desktop |
| 2xl        | 1536px | Extra large desktop |

### Responsive Utilities

```tsx
// Stack on mobile, grid on desktop
<div className="flex flex-col md:grid md:grid-cols-2 lg:grid-cols-3">
  <div>Item 1</div>
  <div>Item 2</div>
  <div>Item 3</div>
</div>

// Hide on mobile, show on desktop
<div className="hidden md:block">
  Desktop only content
</div>

// Show on mobile, hide on desktop
<div className="block md:hidden">
  Mobile only content
</div>

// Responsive text sizes
<h1 className="text-2xl md:text-3xl lg:text-4xl">
  Responsive Heading
</h1>
```

### Touch Targets

All interactive elements meet WCAG 2.1 Level AAA standards:

- **Minimum touch target**: 44px × 44px
- Buttons automatically sized appropriately
- Use `min-h-[44px]` for custom interactive elements

---

## Usage Examples

### Creating a Filtered List Page

```tsx
import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { ListFilters, ActiveFilterTags } from '@/components/ui/list-filters';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { formatRelativeDate } from '@/lib/date-formats';

function EventsPage() {
  const [searchValue, setSearchValue] = useState('');
  const [activeFilters, setActiveFilters] = useState({});

  const filterGroups = [
    {
      id: 'status',
      label: 'Status',
      options: [
        { id: 'pending', label: 'Pending' },
        { id: 'completed', label: 'Completed' },
      ]
    }
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Events</h1>
      </div>

      <ListFilters
        searchPlaceholder="Search events..."
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        filterGroups={filterGroups}
        activeFilters={activeFilters}
        onFilterChange={handleFilterChange}
        onClearFilters={() => setActiveFilters({})}
      />

      <ActiveFilterTags
        filterGroups={filterGroups}
        activeFilters={activeFilters}
        onRemoveFilter={handleRemoveFilter}
        onClearAll={() => setActiveFilters({})}
      />

      {filteredEvents.length === 0 ? (
        <EmptyState
          title="No events found"
          description="Try adjusting your search or filters"
          action={{
            label: "Clear Filters",
            onClick: () => setActiveFilters({})
          }}
        />
      ) : (
        <div className="grid gap-4">
          {filteredEvents.map(event => (
            <Card key={event.id}>
              <CardHeader>
                <div className="flex justify-between items-start">
                  <CardTitle>{event.name}</CardTitle>
                  <Badge variant={getStatusVariant(event.status)}>
                    {event.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {formatRelativeDate(event.date)}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
```

### Creating an Accessible Form

```tsx
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { announceToScreenReader } from '@/lib/accessibility';

function UserForm() {
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      await saveUser();
      announceToScreenReader('User saved successfully', 'polite');
    } catch (error) {
      announceToScreenReader('Error saving user', 'assertive');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          type="text"
          aria-required="true"
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? 'name-error' : undefined}
        />
        {errors.name && (
          <p id="name-error" className="text-sm text-red-600" role="alert">
            {errors.name}
          </p>
        )}
      </div>

      <Button type="submit" className="focus-ring">
        Save
      </Button>
    </form>
  );
}
```

---

## Best Practices

### Consistency

1. **Always use design tokens** instead of hardcoded values
2. **Use the standard spacing scale** (4px increments)
3. **Use semantic color names** (primary, success, warning) instead of color values
4. **Use provided components** instead of creating custom ones

### Accessibility

1. **Provide ARIA labels** for icon-only buttons
2. **Use semantic HTML** elements
3. **Ensure keyboard navigation** works throughout
4. **Test with screen readers** (NVDA, JAWS, VoiceOver)
5. **Meet color contrast requirements** (WCAG AA minimum)

### Responsive Design

1. **Mobile-first approach** - design for mobile, enhance for desktop
2. **Test across breakpoints** - don't just test desktop and mobile
3. **Use flexible layouts** - avoid fixed widths
4. **Touch-friendly targets** - minimum 44px × 44px

### Performance

1. **Use skeleton loaders** for loading states
2. **Provide helpful empty states** instead of blank pages
3. **Show user feedback** for actions (toasts, status messages)

---

## Resources

- **Design Tokens**: `/client/src/lib/design-tokens.ts`
- **Accessibility Utilities**: `/client/src/lib/accessibility.ts`
- **Date Formatting**: `/client/src/lib/date-formats.ts`
- **UI Components**: `/client/src/components/ui/`
- **Tailwind Config**: `/tailwind.config.ts`
- **CSS Styles**: `/client/src/styles/`

---

## Getting Help

If you have questions about the design system or need help implementing a component, please:

1. Review this documentation
2. Check the component source code in `/client/src/components/ui/`
3. Look at existing usage examples in the codebase
4. Reach out to the development team

---

**Last Updated**: 2024-10-25
