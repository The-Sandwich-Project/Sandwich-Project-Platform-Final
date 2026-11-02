import { useState } from 'react';

const COLORS = {
  navy: '#236383',
  teal: '#236383',
  sky: '#47B3CB',
  crimson: '#A31C41',
  gold: '#FBAD3F',
  white: '#FFFFFF',
  lightBg: '#F7F8FA',
  darkText: '#1a1a1a',
  midGray: '#6b7280',
};

interface WishlistItem {
  name: string;
  price: string;
  need: number;
  has: number;
  category: string;
  emoji: string;
  urgent?: boolean;
}

const WISHLIST_ITEMS: WishlistItem[] = [
  {
    name: 'Zbar Chocolate Chip (24pk)',
    price: '$16.99',
    need: 75,
    has: 60,
    category: 'bars',
    emoji: '🍫',
  },
  {
    name: 'Nature Valley Sweet & Salty (24ct)',
    price: '$9.57',
    need: 75,
    has: 86,
    category: 'bars',
    emoji: '🥜',
  },
  {
    name: 'Nutri-Grain Variety (32ct)',
    price: '$9.98',
    need: 75,
    has: 77,
    category: 'bars',
    emoji: '🍓',
  },
  {
    name: 'CLIF Bar Chocolate Chip (12pk)',
    price: '~$12',
    need: 15,
    has: 5,
    category: 'bars',
    emoji: '💪',
    urgent: true,
  },
  {
    name: 'Zbar Protein Variety (18pk)',
    price: '~$15',
    need: 25,
    has: 10,
    category: 'bars',
    emoji: '⚡',
    urgent: true,
  },
  {
    name: 'Dole Diced Peaches (12ct)',
    price: '$9.74',
    need: 50,
    has: 44,
    category: 'fruit',
    emoji: '🍑',
  },
  {
    name: 'Del Monte Fruit Cups Variety (12ct)',
    price: '~$10',
    need: 45,
    has: 27,
    category: 'fruit',
    emoji: '🍊',
    urgent: true,
  },
  {
    name: 'Dole Mandarin Oranges (12ct)',
    price: '$9.49',
    need: 75,
    has: 60,
    category: 'fruit',
    emoji: '🍊',
  },
  {
    name: "Mott's Applesauce (18ct)",
    price: '~$8',
    need: 130,
    has: 149,
    category: 'fruit',
    emoji: '🍎',
  },
  {
    name: 'GoGo squeeZ Variety (20pk)',
    price: '$10.99',
    need: 50,
    has: 59,
    category: 'fruit',
    emoji: '🍏',
  },
  {
    name: "Jack Link's Meat Sticks (20ct)",
    price: '~$15',
    need: 75,
    has: 88,
    category: 'protein',
    emoji: '🥩',
  },
  {
    name: 'KIND Nut Bars Variety (12ct)',
    price: '$13.67',
    need: 25,
    has: 32,
    category: 'bars',
    emoji: '🌰',
  },
  {
    name: "Nature's Bakery Fig Bars (12pk)",
    price: '$8.06',
    need: 25,
    has: 28,
    category: 'bars',
    emoji: '🫐',
  },
];

const URGENT_ITEMS = WISHLIST_ITEMS.filter((i) => i.urgent);

interface Template {
  id: string;
  name: string;
  frequency: string;
  description: string;
  platform: string;
  bgColor: string;
  accentColor: string;
}

const TEMPLATES: Template[] = [
  {
    id: 'supply-sunday',
    name: 'Supply Sunday',
    frequency: 'Weekly',
    description:
      'Recurring weekly post featuring 1-2 items. Same format every week builds recognition.',
    platform: 'Instagram Post + Story',
    bgColor: COLORS.navy,
    accentColor: COLORS.gold,
  },
  {
    id: 'cant-make',
    name: "Can't Make Sandwiches?",
    frequency: '2x/month',
    description:
      "Targets people who want to help but don't have time to make sandwiches. The wishlist is their on-ramp.",
    platform: 'Instagram Post',
    bgColor: COLORS.white,
    accentColor: COLORS.teal,
  },
  {
    id: 'by-the-numbers',
    name: 'By The Numbers',
    frequency: '2x/month',
    description:
      'Pairs a consumption stat with a specific item ask. Makes the need tangible and ongoing.',
    platform: 'Instagram Post + Story',
    bgColor: COLORS.teal,
    accentColor: COLORS.gold,
  },
  {
    id: 'urgent-need',
    name: 'Urgent Need',
    frequency: 'As needed',
    description:
      'When specific items are critically low. Drives immediate action with clear urgency.',
    platform: 'Instagram Story + Post',
    bgColor: COLORS.crimson,
    accentColor: COLORS.gold,
  },
  {
    id: 'thank-you',
    name: 'Wishlist Wins',
    frequency: 'Monthly',
    description:
      'Celebrate fulfillment milestones. Shows donors their impact and normalizes wishlist giving.',
    platform: 'Instagram Post',
    bgColor: COLORS.gold,
    accentColor: COLORS.navy,
  },
];

interface CalendarEntry {
  week: number;
  day: string;
  template: string;
  note: string;
}

const CALENDAR: CalendarEntry[] = [
  {
    week: 1,
    day: 'Sunday',
    template: 'supply-sunday',
    note: 'Feature 1 item from urgent list',
  },
  {
    week: 1,
    day: 'Wednesday',
    template: 'cant-make',
    note: 'Post after volunteer content',
  },
  {
    week: 2,
    day: 'Sunday',
    template: 'supply-sunday',
    note: 'Feature fruit cups or applesauce',
  },
  {
    week: 2,
    day: 'Thursday',
    template: 'by-the-numbers',
    note: 'Pair with weekly impact stats',
  },
  {
    week: 3,
    day: 'Sunday',
    template: 'supply-sunday',
    note: 'Feature protein bars',
  },
  {
    week: 3,
    day: 'Tuesday',
    template: 'cant-make',
    note: 'Different angle than week 1',
  },
  {
    week: 4,
    day: 'Sunday',
    template: 'supply-sunday',
    note: 'Feature GoGo squeeZ or fruit',
  },
  {
    week: 4,
    day: 'Friday',
    template: 'thank-you',
    note: 'Monthly fulfillment celebration',
  },
];

function SupplySundayPreview() {
  const item = URGENT_ITEMS[0];
  return (
    <div
      style={{
        width: '100%',
        maxWidth: 380,
        aspectRatio: '1/1',
        background: `linear-gradient(135deg, ${COLORS.navy} 0%, ${COLORS.teal} 100%)`,
        borderRadius: 16,
        padding: 32,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        color: COLORS.white,
        position: 'relative',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: -40,
          right: -40,
          width: 160,
          height: 160,
          borderRadius: '50%',
          background: COLORS.gold,
          opacity: 0.15,
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: -60,
          left: -30,
          width: 200,
          height: 200,
          borderRadius: '50%',
          background: COLORS.sky,
          opacity: 0.1,
        }}
      />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <div
          style={{
            fontFamily: "'Montserrat', sans-serif",
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: 2.5,
            textTransform: 'uppercase',
            color: COLORS.gold,
            marginBottom: 8,
          }}
        >
          Supply Sunday
        </div>
        <div
          style={{
            fontFamily: "'Montserrat', sans-serif",
            fontWeight: 700,
            fontSize: 28,
            lineHeight: 1.2,
            marginBottom: 8,
          }}
        >
          This week
          <br />
          we need
        </div>
      </div>
      <div style={{ position: 'relative', zIndex: 1 }}>
        <div style={{ fontSize: 48, marginBottom: 4 }}>{item.emoji}</div>
        <div
          style={{
            fontFamily: "'Montserrat', sans-serif",
            fontWeight: 700,
            fontSize: 22,
            marginBottom: 4,
          }}
        >
          CLIF Bars
        </div>
        <div
          style={{
            fontFamily: "'Open Sans', sans-serif",
            fontSize: 15,
            opacity: 0.85,
            marginBottom: 16,
          }}
        >
          Only 5 of 15 fulfilled
        </div>
        <div
          style={{
            background: COLORS.gold,
            color: COLORS.navy,
            fontFamily: "'Montserrat', sans-serif",
            fontWeight: 700,
            fontSize: 14,
            padding: '10px 20px',
            borderRadius: 24,
            display: 'inline-block',
          }}
        >
          Shop our Amazon Wishlist →
        </div>
      </div>
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          fontFamily: "'Open Sans', sans-serif",
          fontSize: 11,
          opacity: 0.6,
          marginTop: 8,
        }}
      >
        🥪 thesandwichprojectatl 💛
      </div>
    </div>
  );
}

function CantMakePreview() {
  return (
    <div
      style={{
        width: '100%',
        maxWidth: 380,
        aspectRatio: '1/1',
        background: COLORS.white,
        borderRadius: 16,
        padding: 32,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        position: 'relative',
        overflow: 'hidden',
        border: `3px solid ${COLORS.navy}10`,
        flexShrink: 0,
      }}
    >
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 8,
          background: `linear-gradient(90deg, ${COLORS.navy}, ${COLORS.teal}, ${COLORS.sky}, ${COLORS.gold})`,
        }}
      />
      <div>
        <div
          style={{
            fontFamily: "'Montserrat', sans-serif",
            fontWeight: 700,
            fontSize: 26,
            color: COLORS.navy,
            lineHeight: 1.25,
            marginBottom: 12,
          }}
        >
          Can't make
          <br />
          sandwiches?
        </div>
        <div
          style={{
            fontFamily: "'Montserrat', sans-serif",
            fontWeight: 700,
            fontSize: 22,
            color: COLORS.teal,
            lineHeight: 1.3,
          }}
        >
          You can still feed
          <br />
          our neighbors. 💛
        </div>
      </div>
      <div>
        <div
          style={{
            fontFamily: "'Open Sans', sans-serif",
            fontSize: 14,
            color: COLORS.midGray,
            marginBottom: 16,
            lineHeight: 1.5,
          }}
        >
          Ship supplies directly to us through
          <br />
          our Amazon Wishlist — starting at $8.
        </div>
        <div
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            marginBottom: 16,
          }}
        >
          {['🍫 Bars', '🍑 Fruit cups', '🍎 Applesauce', '🥩 Protein'].map(
            (tag) => (
              <span
                key={tag}
                style={{
                  background: `${COLORS.sky}20`,
                  color: COLORS.navy,
                  fontFamily: "'Open Sans', sans-serif",
                  fontSize: 13,
                  fontWeight: 600,
                  padding: '6px 12px',
                  borderRadius: 20,
                }}
              >
                {tag}
              </span>
            )
          )}
        </div>
        <div
          style={{
            background: COLORS.teal,
            color: COLORS.white,
            fontFamily: "'Montserrat', sans-serif",
            fontWeight: 700,
            fontSize: 14,
            padding: '10px 20px',
            borderRadius: 24,
            display: 'inline-block',
          }}
        >
          Link in bio 🥪
        </div>
      </div>
    </div>
  );
}

function ByTheNumbersPreview() {
  return (
    <div
      style={{
        width: '100%',
        maxWidth: 380,
        aspectRatio: '1/1',
        background: `linear-gradient(160deg, ${COLORS.teal} 0%, ${COLORS.navy} 100%)`,
        borderRadius: 16,
        padding: 32,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        color: COLORS.white,
        position: 'relative',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          fontSize: 200,
          opacity: 0.06,
          fontFamily: "'Montserrat', sans-serif",
          fontWeight: 900,
        }}
      >
        500
      </div>
      <div style={{ position: 'relative', zIndex: 1 }}>
        <div
          style={{
            fontFamily: "'Montserrat', sans-serif",
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: 2.5,
            textTransform: 'uppercase',
            color: COLORS.gold,
            marginBottom: 16,
          }}
        >
          By the numbers
        </div>
        <div
          style={{
            fontFamily: "'Montserrat', sans-serif",
            fontWeight: 800,
            fontSize: 52,
            lineHeight: 1,
            color: COLORS.gold,
          }}
        >
          500+
        </div>
        <div
          style={{
            fontFamily: "'Montserrat', sans-serif",
            fontWeight: 600,
            fontSize: 20,
            marginTop: 4,
          }}
        >
          snack bars distributed
          <br />
          every single week
        </div>
      </div>
      <div style={{ position: 'relative', zIndex: 1 }}>
        <div
          style={{
            fontFamily: "'Open Sans', sans-serif",
            fontSize: 15,
            opacity: 0.85,
            lineHeight: 1.5,
            marginBottom: 16,
          }}
        >
          That's why our Amazon Wishlist
          <br />
          isn't a one-time ask.
        </div>
        <div
          style={{
            background: 'rgba(255,255,255,0.15)',
            backdropFilter: 'blur(4px)',
            padding: '10px 20px',
            borderRadius: 24,
            display: 'inline-block',
            fontFamily: "'Montserrat', sans-serif",
            fontWeight: 700,
            fontSize: 14,
          }}
        >
          Help us stay stocked →
        </div>
      </div>
    </div>
  );
}

function UrgentPreview() {
  return (
    <div
      style={{
        width: '100%',
        maxWidth: 380,
        aspectRatio: '1/1',
        background: COLORS.crimson,
        borderRadius: 16,
        padding: 32,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        color: COLORS.white,
        position: 'relative',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          background: COLORS.gold,
          color: COLORS.crimson,
          fontFamily: "'Montserrat', sans-serif",
          fontWeight: 800,
          fontSize: 11,
          padding: '6px 14px',
          borderRadius: 20,
          letterSpacing: 1,
        }}
      >
        URGENT NEED
      </div>
      <div style={{ marginTop: 40 }}>
        <div
          style={{
            fontFamily: "'Montserrat', sans-serif",
            fontWeight: 700,
            fontSize: 24,
            lineHeight: 1.25,
            marginBottom: 20,
          }}
        >
          We're running low
          <br />
          on 3 items this week
        </div>
        {URGENT_ITEMS.map((item, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 10,
              background: 'rgba(255,255,255,0.12)',
              padding: '8px 14px',
              borderRadius: 10,
            }}
          >
            <span style={{ fontSize: 20 }}>{item.emoji}</span>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontFamily: "'Open Sans', sans-serif",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {item.name.split('(')[0].trim()}
              </div>
              <div style={{ fontSize: 11, opacity: 0.7 }}>
                {item.has}/{item.need} fulfilled
              </div>
            </div>
          </div>
        ))}
      </div>
      <div
        style={{
          background: COLORS.gold,
          color: COLORS.crimson,
          fontFamily: "'Montserrat', sans-serif",
          fontWeight: 700,
          fontSize: 14,
          padding: '10px 20px',
          borderRadius: 24,
          display: 'inline-block',
          textAlign: 'center',
        }}
      >
        Shop our Amazon Wishlist 💛
      </div>
    </div>
  );
}

function ThankYouPreview() {
  return (
    <div
      style={{
        width: '100%',
        maxWidth: 380,
        aspectRatio: '1/1',
        background: `linear-gradient(135deg, ${COLORS.gold} 0%, #f5c563 100%)`,
        borderRadius: 16,
        padding: 32,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        color: COLORS.navy,
        position: 'relative',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: -30,
          right: -30,
          width: 140,
          height: 140,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.2)',
        }}
      />
      <div>
        <div style={{ fontSize: 40, marginBottom: 8 }}>💛🥪</div>
        <div
          style={{
            fontFamily: "'Montserrat', sans-serif",
            fontWeight: 700,
            fontSize: 26,
            lineHeight: 1.2,
          }}
        >
          Wishlist Win!
        </div>
      </div>
      <div>
        <div
          style={{
            fontFamily: "'Montserrat', sans-serif",
            fontWeight: 800,
            fontSize: 40,
            lineHeight: 1.1,
            marginBottom: 4,
          }}
        >
          12 items
        </div>
        <div
          style={{
            fontFamily: "'Open Sans', sans-serif",
            fontSize: 16,
            marginBottom: 16,
            lineHeight: 1.4,
          }}
        >
          fully stocked this month
          <br />
          thanks to YOU
        </div>
        <div
          style={{
            fontFamily: "'Open Sans', sans-serif",
            fontSize: 14,
            opacity: 0.7,
          }}
        >
          Every bar, every fruit cup — it all
          <br />
          goes straight to our neighbors.
        </div>
      </div>
      <div
        style={{
          fontFamily: "'Open Sans', sans-serif",
          fontSize: 12,
          opacity: 0.5,
        }}
      >
        thesandwichprojectatl 🥪
      </div>
    </div>
  );
}

const PREVIEW_MAP: Record<string, React.FC> = {
  'supply-sunday': SupplySundayPreview,
  'cant-make': CantMakePreview,
  'by-the-numbers': ByTheNumbersPreview,
  'urgent-need': UrgentPreview,
  'thank-you': ThankYouPreview,
};

const CAPTIONS: Record<string, string> = {
  'supply-sunday': `Supply Sunday 🥪💛

This week, we need CLIF Bars. We're at 5 out of 15 — that's not enough to get through the week.

Every bar goes straight to a neighbor. Shop our Amazon Wishlist (link in bio) and it ships right to us. Takes 30 seconds.

#TheSandwichProject #FightHunger #Atlanta #FoodInsecurity #SupplySunday`,
  'cant-make': `Not everyone can make sandwiches — and that's okay. 💛

You can still help feed our neighbors by shopping our Amazon Wishlist. Snack bars, fruit cups, and applesauce starting at $8, shipped directly to us.

No kitchen required. Just a couple clicks.

🔗 Link in bio

#TheSandwichProject #Atlanta #FoodInsecurity #FightHunger`,
  'by-the-numbers': `500+ snack bars go out the door every single week. That's not a one-time need — it's every Wednesday, all year long.

Our Amazon Wishlist makes it easy to keep us stocked. One order from you = meals for our neighbors.

🔗 Link in bio

#TheSandwichProject #ByTheNumbers #Atlanta #FoodInsecurity`,
  'urgent-need': `🚨 We're running low this week.

3 items on our Amazon Wishlist are critically low — CLIF Bars, Zbar Protein packs, and Del Monte Fruit Cups.

These go directly to our neighbors through 70+ partner charities across Metro Atlanta. Can you help us restock?

🔗 Link in bio

#TheSandwichProject #UrgentNeed #Atlanta #FoodInsecurity`,
  'thank-you': `YOU did this. 💛

This month, 12 wishlist items were fully stocked by people just like you — people who took 30 seconds to click a link and ship a box of snack bars.

Every single one went straight to a neighbor in Metro Atlanta. Thank you for showing up, even from your couch. 🥪

#TheSandwichProject #WishlistWin #Atlanta #FightHunger`,
};

export default function WishlistToolkit() {
  const [activeTab, setActiveTab] = useState('templates');
  const [activeTemplate, setActiveTemplate] = useState('supply-sunday');
  const [showCaption, setShowCaption] = useState(false);

  const template = TEMPLATES.find((t) => t.id === activeTemplate)!;
  const PreviewComponent = PREVIEW_MAP[activeTemplate];

  return (
    <div
      style={{
        minHeight: '100vh',
        background: COLORS.lightBg,
        fontFamily: "'Open Sans', 'Helvetica Neue', sans-serif",
      }}
    >
      <link
        href="https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700;800&family=Open+Sans:wght@400;600;700&display=swap"
        rel="stylesheet"
      />

      {/* Header */}
      <div
        style={{
          background: `linear-gradient(135deg, ${COLORS.navy} 0%, ${COLORS.teal} 100%)`,
          padding: '32px 24px 24px',
          color: COLORS.white,
        }}
      >
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div
            style={{
              fontFamily: "'Montserrat', sans-serif",
              fontWeight: 800,
              fontSize: 24,
              marginBottom: 4,
            }}
          >
            Amazon Wishlist Marketing Kit
          </div>
          <div style={{ fontSize: 14, opacity: 0.8 }}>
            The Sandwich Project — Social Media Templates & Strategy
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div
        style={{
          background: COLORS.white,
          borderBottom: `1px solid #e5e7eb`,
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <div
          style={{ maxWidth: 900, margin: '0 auto', display: 'flex', gap: 0 }}
        >
          {[
            { id: 'templates', label: 'Post Templates' },
            { id: 'calendar', label: 'Content Calendar' },
            { id: 'inventory', label: 'Current Inventory' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '14px 20px',
                fontFamily: "'Montserrat', sans-serif",
                fontWeight: 700,
                fontSize: 13,
                color: activeTab === tab.id ? COLORS.teal : COLORS.midGray,
                background: 'none',
                border: 'none',
                borderBottom:
                  activeTab === tab.id
                    ? `3px solid ${COLORS.teal}`
                    : '3px solid transparent',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px' }}>
        {/* TEMPLATES TAB */}
        {activeTab === 'templates' && (
          <div>
            {/* Template selector */}
            <div
              style={{
                display: 'flex',
                gap: 8,
                marginBottom: 24,
                overflowX: 'auto',
                paddingBottom: 4,
              }}
            >
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setActiveTemplate(t.id);
                    setShowCaption(false);
                  }}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 20,
                    fontFamily: "'Open Sans', sans-serif",
                    fontWeight: 600,
                    fontSize: 13,
                    color: activeTemplate === t.id ? COLORS.white : COLORS.navy,
                    background:
                      activeTemplate === t.id ? COLORS.navy : `${COLORS.sky}20`,
                    border: 'none',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.2s',
                  }}
                >
                  {t.name}
                </button>
              ))}
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
                gap: 24,
                alignItems: 'start',
              }}
            >
              {/* Preview */}
              <div>
                <PreviewComponent />
              </div>

              {/* Details */}
              <div>
                <div
                  style={{
                    fontFamily: "'Montserrat', sans-serif",
                    fontWeight: 700,
                    fontSize: 20,
                    color: COLORS.navy,
                    marginBottom: 4,
                  }}
                >
                  {template.name}
                </div>
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    marginBottom: 12,
                  }}
                >
                  <span
                    style={{
                      background: `${COLORS.teal}15`,
                      color: COLORS.teal,
                      fontSize: 12,
                      fontWeight: 600,
                      padding: '3px 10px',
                      borderRadius: 12,
                    }}
                  >
                    {template.frequency}
                  </span>
                  <span
                    style={{
                      background: `${COLORS.navy}10`,
                      color: COLORS.navy,
                      fontSize: 12,
                      fontWeight: 600,
                      padding: '3px 10px',
                      borderRadius: 12,
                    }}
                  >
                    {template.platform}
                  </span>
                </div>
                <p
                  style={{
                    color: COLORS.midGray,
                    fontSize: 14,
                    lineHeight: 1.6,
                    marginBottom: 20,
                    marginTop: 0,
                  }}
                >
                  {template.description}
                </p>

                <button
                  onClick={() => setShowCaption(!showCaption)}
                  style={{
                    background: showCaption ? COLORS.navy : COLORS.white,
                    color: showCaption ? COLORS.white : COLORS.navy,
                    border: `2px solid ${COLORS.navy}`,
                    fontFamily: "'Montserrat', sans-serif",
                    fontWeight: 700,
                    fontSize: 13,
                    padding: '10px 20px',
                    borderRadius: 10,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    width: '100%',
                    marginBottom: 12,
                  }}
                >
                  {showCaption ? 'Hide Caption' : 'Show Sample Caption'}
                </button>

                {showCaption && (
                  <div
                    style={{
                      background: COLORS.white,
                      border: `1px solid #e5e7eb`,
                      borderRadius: 12,
                      padding: 16,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: COLORS.teal,
                        textTransform: 'uppercase',
                        letterSpacing: 1,
                        marginBottom: 8,
                      }}
                    >
                      Sample Caption
                    </div>
                    <pre
                      style={{
                        fontFamily: "'Open Sans', sans-serif",
                        fontSize: 13,
                        color: COLORS.darkText,
                        whiteSpace: 'pre-wrap',
                        lineHeight: 1.6,
                        margin: 0,
                      }}
                    >
                      {CAPTIONS[activeTemplate]}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* CALENDAR TAB */}
        {activeTab === 'calendar' && (
          <div>
            <div
              style={{
                fontFamily: "'Montserrat', sans-serif",
                fontWeight: 700,
                fontSize: 18,
                color: COLORS.navy,
                marginBottom: 4,
              }}
            >
              Monthly Content Calendar
            </div>
            <p
              style={{
                color: COLORS.midGray,
                fontSize: 14,
                lineHeight: 1.5,
                marginTop: 4,
                marginBottom: 20,
              }}
            >
              8 wishlist-related posts per month. That's 2 per week — enough to
              build a rhythm without overwhelming your feed.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[1, 2, 3, 4].map((week) => (
                <div
                  key={week}
                  style={{
                    background: COLORS.white,
                    borderRadius: 12,
                    padding: 16,
                    border: `1px solid #e5e7eb`,
                  }}
                >
                  <div
                    style={{
                      fontFamily: "'Montserrat', sans-serif",
                      fontWeight: 700,
                      fontSize: 14,
                      color: COLORS.navy,
                      marginBottom: 12,
                    }}
                  >
                    Week {week}
                  </div>
                  <div
                    style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                  >
                    {CALENDAR.filter((c) => c.week === week).map((entry, i) => {
                      const tmpl = TEMPLATES.find(
                        (t) => t.id === entry.template
                      )!;
                      return (
                        <div
                          key={i}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            background: `${tmpl.bgColor}10`,
                            padding: '10px 14px',
                            borderRadius: 8,
                            borderLeft: `4px solid ${tmpl.bgColor === '#FFFFFF' ? COLORS.teal : tmpl.bgColor}`,
                          }}
                        >
                          <div
                            style={{
                              fontFamily: "'Montserrat', sans-serif",
                              fontWeight: 700,
                              fontSize: 12,
                              color: COLORS.midGray,
                              width: 80,
                              flexShrink: 0,
                            }}
                          >
                            {entry.day}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div
                              style={{
                                fontFamily: "'Montserrat', sans-serif",
                                fontWeight: 700,
                                fontSize: 13,
                                color: COLORS.navy,
                              }}
                            >
                              {tmpl.name}
                            </div>
                            <div
                              style={{
                                fontSize: 12,
                                color: COLORS.midGray,
                                marginTop: 2,
                              }}
                            >
                              {entry.note}
                            </div>
                          </div>
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              color:
                                tmpl.bgColor === '#FFFFFF'
                                  ? COLORS.teal
                                  : tmpl.bgColor,
                              background: `${tmpl.bgColor === '#FFFFFF' ? COLORS.teal : tmpl.bgColor}15`,
                              padding: '3px 8px',
                              borderRadius: 8,
                            }}
                          >
                            {tmpl.platform.split('+')[0].trim()}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* INVENTORY TAB */}
        {activeTab === 'inventory' && (
          <div>
            <div
              style={{
                fontFamily: "'Montserrat', sans-serif",
                fontWeight: 700,
                fontSize: 18,
                color: COLORS.navy,
                marginBottom: 4,
              }}
            >
              Wishlist Inventory Snapshot
            </div>
            <p
              style={{
                color: COLORS.midGray,
                fontSize: 14,
                lineHeight: 1.5,
                marginTop: 4,
                marginBottom: 20,
              }}
            >
              Current fulfillment status — use this to decide what to feature
              each week.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[...WISHLIST_ITEMS]
                .sort((a, b) => a.has / a.need - b.has / b.need)
                .map((item, i) => {
                  const pct = Math.min((item.has / item.need) * 100, 100);
                  const isLow = pct < 50;
                  const isOver = item.has >= item.need;
                  return (
                    <div
                      key={i}
                      style={{
                        background: COLORS.white,
                        borderRadius: 10,
                        padding: '12px 16px',
                        border: `1px solid ${isLow ? COLORS.crimson + '30' : '#e5e7eb'}`,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                      }}
                    >
                      <span
                        style={{ fontSize: 20, width: 28, textAlign: 'center' }}
                      >
                        {item.emoji}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontFamily: "'Open Sans', sans-serif",
                            fontSize: 13,
                            fontWeight: 600,
                            color: COLORS.darkText,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {item.name}
                        </div>
                        <div
                          style={{
                            height: 6,
                            background: '#e5e7eb',
                            borderRadius: 3,
                            marginTop: 6,
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              height: '100%',
                              width: `${pct}%`,
                              background: isOver
                                ? COLORS.teal
                                : isLow
                                  ? COLORS.crimson
                                  : COLORS.gold,
                              borderRadius: 3,
                              transition: 'width 0.3s',
                            }}
                          />
                        </div>
                      </div>
                      <div
                        style={{
                          textAlign: 'right',
                          flexShrink: 0,
                        }}
                      >
                        <div
                          style={{
                            fontFamily: "'Montserrat', sans-serif",
                            fontWeight: 700,
                            fontSize: 14,
                            color: isOver
                              ? COLORS.teal
                              : isLow
                                ? COLORS.crimson
                                : COLORS.navy,
                          }}
                        >
                          {item.has}/{item.need}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: COLORS.midGray,
                          }}
                        >
                          {item.price}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>

            <div
              style={{
                marginTop: 16,
                padding: 14,
                background: `${COLORS.crimson}08`,
                borderRadius: 10,
                border: `1px solid ${COLORS.crimson}20`,
              }}
            >
              <div
                style={{
                  fontFamily: "'Montserrat', sans-serif",
                  fontWeight: 700,
                  fontSize: 13,
                  color: COLORS.crimson,
                  marginBottom: 4,
                }}
              >
                🔴 Priority items to feature
              </div>
              <div
                style={{ fontSize: 13, color: COLORS.midGray, lineHeight: 1.5 }}
              >
                CLIF Bars (33%), Zbar Protein (40%), Del Monte Fruit Cups (60%),
                and Mott's Mighty Applesauce (60%) are your best candidates for
                Supply Sunday and Urgent Need posts.
              </div>
            </div>

            <div
              style={{
                marginTop: 10,
                padding: 14,
                background: `${COLORS.teal}08`,
                borderRadius: 10,
                border: `1px solid ${COLORS.teal}20`,
              }}
            >
              <div
                style={{
                  fontFamily: "'Montserrat', sans-serif",
                  fontWeight: 700,
                  fontSize: 13,
                  color: COLORS.teal,
                  marginBottom: 4,
                }}
              >
                ✅ Over-fulfilled — refresh quantities
              </div>
              <div
                style={{ fontSize: 13, color: COLORS.midGray, lineHeight: 1.5 }}
              >
                Nature Valley Sweet & Salty, Mott's Applesauce 18ct, Jack
                Link's, and several others are at or above target. Update
                quantities on Amazon to keep the list looking current and
                urgent.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
