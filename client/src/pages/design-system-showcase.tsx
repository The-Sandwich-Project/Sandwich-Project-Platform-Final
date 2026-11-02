import {
  Heart,
  Check,
  AlertCircle,
  Info,
  Loader2,
  Plus,
  Download,
  Trash2,
  ArrowRight,
} from 'lucide-react';

/**
 * Design System Showcase
 *
 * This page demonstrates the new premium design system alongside existing styles
 * for visual comparison and testing. Use this to preview the modern styling
 * before adopting it across the application.
 */

export default function DesignSystemShowcase() {
  const progress = 65;

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="premium-container">
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="premium-text-display mb-4">
            Premium Design System
          </h1>
          <p className="premium-text-body-lg text-gray-600 max-w-3xl mx-auto">
            A modern, cohesive design system using your brand colors: Navy (#236383),
            Teal (#236383), Cyan (#47B3CB), Orange (#FBAD3F), and Burgundy (#A31C41).
            All classes use the "premium-" prefix and work alongside existing styles.
          </p>
        </div>

        {/* Color Palette */}
        <section className="mb-16">
          <h2 className="premium-text-h2 mb-8">Brand Color Palette</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
            <div className="premium-card p-6 text-center">
              <div
                className="w-full h-24 rounded-lg mb-4"
                style={{ background: '#236383' }}
              />
              <div className="font-semibold text-sm">Primary Navy</div>
              <div className="text-xs text-gray-500 mt-1">#236383</div>
              <div className="text-xs text-gray-400">Trust, Stability</div>
            </div>
            <div className="premium-card p-6 text-center">
              <div
                className="w-full h-24 rounded-lg mb-4"
                style={{ background: '#236383' }}
              />
              <div className="font-semibold text-sm">Teal</div>
              <div className="text-xs text-gray-500 mt-1">#236383</div>
              <div className="text-xs text-gray-400">Success, Active</div>
            </div>
            <div className="premium-card p-6 text-center">
              <div
                className="w-full h-24 rounded-lg mb-4"
                style={{ background: '#47B3CB' }}
              />
              <div className="font-semibold text-sm">Light Cyan</div>
              <div className="text-xs text-gray-500 mt-1">#47B3CB</div>
              <div className="text-xs text-gray-400">Hover, Secondary</div>
            </div>
            <div className="premium-card p-6 text-center">
              <div
                className="w-full h-24 rounded-lg mb-4"
                style={{ background: '#FBAD3F' }}
              />
              <div className="font-semibold text-sm">Orange</div>
              <div className="text-xs text-gray-500 mt-1">#FBAD3F</div>
              <div className="text-xs text-gray-400">Warning, Energy</div>
            </div>
            <div className="premium-card p-6 text-center">
              <div
                className="w-full h-24 rounded-lg mb-4"
                style={{ background: '#A31C41' }}
              />
              <div className="font-semibold text-sm">Burgundy</div>
              <div className="text-xs text-gray-500 mt-1">#A31C41</div>
              <div className="text-xs text-gray-400">Error, Premium</div>
            </div>
          </div>
        </section>

        <div className="premium-divider mb-16" />

        {/* Buttons - Premium vs. Old */}
        <section className="mb-16">
          <h2 className="premium-text-h2 mb-8">Button System</h2>

          {/* Premium Buttons */}
          <div className="premium-card p-8 mb-8">
            <h3 className="premium-text-h4 mb-6">✨ New Premium Buttons</h3>
            <div className="space-y-6">
              <div>
                <p className="text-sm text-gray-600 mb-3 font-medium">Primary Actions</p>
                <div className="flex flex-wrap gap-4">
                  <button className="premium-btn-primary">
                    <Plus className="w-4 h-4" />
                    Primary Button
                  </button>
                  <button className="premium-btn-primary premium-btn-sm">
                    Small Primary
                  </button>
                  <button className="premium-btn-primary premium-btn-lg">
                    <ArrowRight className="w-5 h-5" />
                    Large Primary
                  </button>
                </div>
              </div>

              <div>
                <p className="text-sm text-gray-600 mb-3 font-medium">Secondary & Accent</p>
                <div className="flex flex-wrap gap-4">
                  <button className="premium-btn-secondary">
                    <Check className="w-4 h-4" />
                    Secondary
                  </button>
                  <button className="premium-btn-accent">
                    <Heart className="w-4 h-4" />
                    Accent Button
                  </button>
                  <button className="premium-btn-danger">
                    <Trash2 className="w-4 h-4" />
                    Danger
                  </button>
                </div>
              </div>

              <div>
                <p className="text-sm text-gray-600 mb-3 font-medium">Outline & Ghost</p>
                <div className="flex flex-wrap gap-4">
                  <button className="premium-btn-outline">
                    Outline Button
                  </button>
                  <button className="premium-btn-ghost">
                    <Download className="w-4 h-4" />
                    Ghost Button
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Old Buttons for Comparison */}
          <div className="bg-gray-100 border border-gray-300 rounded-lg p-8">
            <h3 className="text-lg font-semibold mb-6 text-gray-700">📦 Existing Buttons (for comparison)</h3>
            <div className="flex flex-wrap gap-4">
              <button className="btn-primary px-4 py-2 rounded">
                Old Primary
              </button>
              <button className="btn-secondary px-4 py-2 rounded">
                Old Secondary
              </button>
              <button className="btn-outline px-4 py-2 rounded">
                Old Outline
              </button>
            </div>
          </div>
        </section>

        <div className="premium-divider mb-16" />

        {/* Cards */}
        <section className="mb-16">
          <h2 className="premium-text-h2 mb-8">Card Treatments</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="premium-card p-6">
              <div className="premium-text-h4 mb-2">Default Card</div>
              <p className="premium-text-body-sm text-gray-600">
                Subtle elevation with hover effect. Perfect for content cards.
              </p>
            </div>

            <div className="premium-card-flat p-6">
              <div className="premium-text-h4 mb-2">Flat Card</div>
              <p className="premium-text-body-sm text-gray-600">
                No shadow, just border. Great for grouped content.
              </p>
            </div>

            <div className="premium-card-elevated p-6">
              <div className="premium-text-h4 mb-2">Elevated Card</div>
              <p className="premium-text-body-sm text-gray-600">
                More shadow for emphasis. Use sparingly.
              </p>
            </div>

            <div className="premium-card-featured p-6">
              <div className="premium-text-h4 mb-2">Featured Card</div>
              <p className="premium-text-body-sm text-gray-600">
                Gradient border for premium content.
              </p>
            </div>
          </div>

          <div className="mt-8">
            <div className="premium-card-glass p-8">
              <div className="premium-text-h3 mb-2">Glass Card Effect</div>
              <p className="premium-text-body text-gray-600">
                Modern glassmorphism for overlays and hero sections.
              </p>
            </div>
          </div>
        </section>

        <div className="premium-divider mb-16" />

        {/* Status Badges */}
        <section className="mb-16">
          <h2 className="premium-text-h2 mb-8">Status System</h2>

          <div className="premium-card p-8 mb-6">
            <h3 className="premium-text-h4 mb-6">✨ New Premium Status Badges</h3>
            <div className="flex flex-wrap gap-3">
              <span className="premium-status-success">
                <Check className="w-4 h-4 inline" />
                Success / Completed
              </span>
              <span className="premium-status-progress">
                <Loader2 className="w-4 h-4 inline animate-spin" />
                In Progress
              </span>
              <span className="premium-status-pending">
                <Info className="w-4 h-4 inline" />
                Pending
              </span>
              <span className="premium-status-error">
                <AlertCircle className="w-4 h-4 inline" />
                Error / Critical
              </span>
              <span className="premium-status-info">
                <Info className="w-4 h-4 inline" />
                Information
              </span>
            </div>
          </div>

          <div className="bg-gray-100 border border-gray-300 rounded-lg p-8">
            <h3 className="text-lg font-semibold mb-6 text-gray-700">📦 Existing Status Badges</h3>
            <div className="flex flex-wrap gap-3">
              <span className="status-badge status-completed">Completed</span>
              <span className="status-badge status-progress">In Progress</span>
              <span className="status-badge status-pending">Pending</span>
            </div>
          </div>
        </section>

        <div className="premium-divider mb-16" />

        {/* Typography */}
        <section className="mb-16">
          <h2 className="premium-text-h2 mb-8">Typography Scale</h2>
          <div className="premium-card p-8 space-y-6">
            <div>
              <p className="premium-text-caption mb-2">Display Large</p>
              <h1 className="premium-text-display-lg">Making an Impact</h1>
            </div>
            <div>
              <p className="premium-text-caption mb-2">Display</p>
              <h2 className="premium-text-display">Premium Typography</h2>
            </div>
            <div>
              <p className="premium-text-caption mb-2">Heading 1</p>
              <h1 className="premium-text-h1">Professional Design System</h1>
            </div>
            <div>
              <p className="premium-text-caption mb-2">Heading 2</p>
              <h2 className="premium-text-h2">Modern & Cohesive</h2>
            </div>
            <div>
              <p className="premium-text-caption mb-2">Heading 3</p>
              <h3 className="premium-text-h3">Section Heading</h3>
            </div>
            <div>
              <p className="premium-text-caption mb-2">Body Text</p>
              <p className="premium-text-body">
                This is body text with comfortable line height and spacing.
                Perfect for paragraphs and longer content that needs to be
                easily readable.
              </p>
            </div>
            <div>
              <p className="premium-text-caption mb-2">Caption</p>
              <p className="premium-text-caption">SMALL LABEL OR CAPTION TEXT</p>
            </div>
          </div>
        </section>

        <div className="premium-divider mb-16" />

        {/* Form Inputs */}
        <section className="mb-16">
          <h2 className="premium-text-h2 mb-8">Form Elements</h2>
          <div className="premium-card p-8">
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <label className="premium-text-body-sm font-medium mb-2 block">
                  Text Input
                </label>
                <input
                  type="text"
                  placeholder="Enter your name..."
                  className="premium-input w-full"
                />
              </div>
              <div>
                <label className="premium-text-body-sm font-medium mb-2 block">
                  Email Input
                </label>
                <input
                  type="email"
                  placeholder="your@email.com"
                  className="premium-input w-full"
                />
              </div>
              <div className="md:col-span-2">
                <label className="premium-text-body-sm font-medium mb-2 block">
                  Textarea
                </label>
                <textarea
                  placeholder="Enter your message..."
                  className="premium-input w-full"
                  rows={4}
                />
              </div>
            </div>
          </div>
        </section>

        <div className="premium-divider mb-16" />

        {/* Progress Bars */}
        <section className="mb-16">
          <h2 className="premium-text-h2 mb-8">Progress Indicators</h2>
          <div className="premium-card p-8 space-y-6">
            <div>
              <div className="flex justify-between mb-2">
                <span className="premium-text-body-sm font-medium">Project Completion</span>
                <span className="premium-text-body-sm text-gray-600">{progress}%</span>
              </div>
              <div className="premium-progress">
                <div
                  className="premium-progress-bar"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between mb-2">
                <span className="premium-text-body-sm font-medium">Loading State</span>
                <span className="premium-spinner" />
              </div>
            </div>

            <div>
              <div className="premium-text-body-sm font-medium mb-3">Skeleton Loading</div>
              <div className="space-y-3">
                <div className="premium-skeleton h-4 w-full" />
                <div className="premium-skeleton h-4 w-4/5" />
                <div className="premium-skeleton h-4 w-3/5" />
              </div>
            </div>
          </div>
        </section>

        <div className="premium-divider mb-16" />

        {/* Elevation System */}
        <section className="mb-16">
          <h2 className="premium-text-h2 mb-8">Elevation System</h2>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="bg-white p-8 rounded-xl elevation-1">
              <div className="premium-text-h4 mb-2">Elevation 1</div>
              <p className="premium-text-body-sm text-gray-600">
                Subtle shadow for cards and containers.
              </p>
            </div>
            <div className="bg-white p-8 rounded-xl elevation-2">
              <div className="premium-text-h4 mb-2">Elevation 2</div>
              <p className="premium-text-body-sm text-gray-600">
                Medium shadow for interactive elements.
              </p>
            </div>
            <div className="bg-white p-8 rounded-xl elevation-3">
              <div className="premium-text-h4 mb-2">Elevation 3</div>
              <p className="premium-text-body-sm text-gray-600">
                High shadow for modals and dropdowns.
              </p>
            </div>
          </div>
        </section>

        <div className="premium-divider mb-16" />

        {/* Gradients */}
        <section className="mb-16">
          <h2 className="premium-text-h2 mb-8">Brand Gradients</h2>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="premium-gradient-primary p-8 rounded-xl text-white">
              <div className="text-xl font-semibold mb-2">Primary Gradient</div>
              <p className="text-white/90 text-sm">Navy to Teal</p>
            </div>
            <div className="premium-gradient-warm p-8 rounded-xl text-white">
              <div className="text-xl font-semibold mb-2">Warm Gradient</div>
              <p className="text-white/90 text-sm">Orange to Burgundy</p>
            </div>
            <div className="premium-gradient-cool p-8 rounded-xl text-white">
              <div className="text-xl font-semibold mb-2">Cool Gradient</div>
              <p className="text-white/90 text-sm">Cyan to Navy</p>
            </div>
          </div>
        </section>

        <div className="premium-divider mb-16" />

        {/* Implementation Guide */}
        <section className="mb-16">
          <div className="premium-card-featured p-8">
            <h2 className="premium-text-h2 mb-4">Implementation Guide</h2>
            <div className="premium-text-body space-y-4">
              <p>
                All new premium styles are now available in your application!
                They use the <code className="px-2 py-1 bg-gray-100 rounded text-sm">premium-</code> prefix
                to avoid conflicts with existing styles.
              </p>

              <div className="premium-divider my-6" />

              <div>
                <h3 className="premium-text-h4 mb-3">How to Use</h3>
                <ol className="space-y-2 list-decimal list-inside">
                  <li>Start by updating high-impact areas (landing page, dashboard header)</li>
                  <li>Replace button classes: <code className="px-2 py-1 bg-gray-100 rounded text-sm">.btn-primary</code> → <code className="px-2 py-1 bg-gray-100 rounded text-sm">.premium-btn-primary</code></li>
                  <li>Update cards: <code className="px-2 py-1 bg-gray-100 rounded text-sm">.card-elevated</code> → <code className="px-2 py-1 bg-gray-100 rounded text-sm">.premium-card</code></li>
                  <li>Migrate status badges to use brand colors</li>
                  <li>Gradually adopt across other components</li>
                </ol>
              </div>

              <div className="premium-divider my-6" />

              <div>
                <h3 className="premium-text-h4 mb-3">Benefits</h3>
                <ul className="space-y-2 list-disc list-inside">
                  <li>Consistent use of brand colors throughout</li>
                  <li>Modern shadows and elevation for premium feel</li>
                  <li>Professional typography scale</li>
                  <li>Better accessibility with larger touch targets</li>
                  <li>Cohesive design language across all components</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <div className="text-center py-8">
          <p className="premium-text-body text-gray-500">
            Design System Showcase • The Sandwich Project Platform
          </p>
        </div>
      </div>
    </div>
  );
}
