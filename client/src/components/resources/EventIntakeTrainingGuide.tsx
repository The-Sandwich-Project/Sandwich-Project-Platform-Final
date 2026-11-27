/**
 * Event Intake Training Guide
 *
 * A read-only reference for new intake team members: what to cover on an
 * intake call with a group. It replaces the old per-event "Intake Call
 * Guide" form that lived on event cards. Nothing here is saved; the guide is
 * meant to be read through, or kept open during a call. Record what you learn
 * on the event itself (Edit, Log Contact).
 *
 * Shown inline on the Resources page (not in a popup) so it can stay open
 * next to an event while someone is on the phone.
 */
import * as React from 'react';
import { BookOpen, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface GuideItem {
  topic: string;
  /** Talking points or rules of thumb for this topic. */
  points?: string[];
  /** An outside page to open while on the call. */
  link?: { label: string; href: string };
}

/** Where we usually hold events (from the old intake call form). */
export const TYPICAL_OPERATING_AREAS = [
  'Dunwoody',
  'Sandy Springs',
  'Intown (generally not South Atlanta)',
  'Buckhead',
  'Peachtree Corners',
  'Alpharetta',
  'Milton',
  'Marietta',
  'Roswell',
];

interface GuideSection {
  title: string;
  items: GuideItem[];
}

export const INTAKE_GUIDE_SECTIONS: GuideSection[] = [
  {
    title: 'Contact details',
    items: [
      { topic: 'Contact person name' },
      { topic: 'Contact phone number' },
      { topic: 'Contact email' },
      { topic: 'Backup contact', points: ['Name and phone number of a second person at the group.'] },
    ],
  },
  {
    title: 'Event basics',
    items: [
      {
        topic: 'Event date',
        points: ['Confirm the date from their request, or note that they are still deciding.'],
      },
      { topic: 'Event address' },
      {
        topic: 'Outside our usual area?',
        points: [
          `Our typical areas: ${TYPICAL_OPERATING_AREAS.join(', ')}.`,
          'Check with Christine & Marcy before saying yes.',
          'Let the group know we will try to make it work but need leadership confirmation first.',
        ],
      },
      {
        topic: 'Event times',
        points: [
          'Start and end times are ideal, and required if they want TSP volunteers.',
          'A pickup time is required if they need a driver.',
          'If they can hold the sandwiches overnight, next-day pickup may be an option.',
        ],
      },
    ],
  },
  {
    title: 'Sandwiches',
    items: [
      {
        topic: 'How many sandwiches?',
        points: [
          'An exact number or a range is fine (e.g. 400-500).',
          'Under about 200 sandwiches is usually better as a Wednesday drop-off at a host home than a group event. Share the host finder with them. Check with Christine/Marcy before going ahead with a smaller group event.',
        ],
        link: { label: 'Open TSP Host Finder', href: 'https://tsp-host-finder-tool.web.app/' },
      },
      {
        topic: 'Deli or PB&J?',
        points: [
          'We focus on fresh deli sandwiches.',
          'Only a limited number of recipient partners can take PB&J, so groups making a larger number of sandwiches should make deli.',
          'No fridge space for deli? They can make enough for the van, or switch to PB&J.',
        ],
      },
      {
        topic: 'Children under 13 making PB&J?',
        points: [
          'We generally do not have children under 13 make PB&J, for safety and hygiene reasons.',
          'A high adult-to-child ratio improves the odds of an exception. Clear any exception with Christine/Marcy.',
        ],
      },
      {
        topic: 'Expected number of people',
        points: ['A rough estimate is fine; it is expected to change.'],
      },
      {
        topic: 'Do they want TSP volunteers?',
        points: ['Our volunteer roster is limited, so we generally prioritize larger events. Only offer volunteers if it really fits the event.'],
      },
      {
        topic: 'Is TSP buying the food?',
        points: ['If TSP is ordering the ingredients, mark "TSP shopping" on the event.'],
      },
    ],
  },
  {
    title: 'Refrigeration & the van',
    items: [
      {
        topic: 'Refrigeration',
        points: [
          'Deli sandwiches need a fridge.',
          'The fridge has to hold both the ingredients and the finished sandwiches. Partway through the event both are in there at once, so room for the ingredients does not always mean room for the sandwiches.',
          'Ask how many fridges they can clear out, what kind (residential, single-door or double-door commercial), and how close they are to the sandwich-making space.',
        ],
      },
      {
        topic: 'Refrigerated van',
        points: [
          'The van is for events of 800 sandwiches or more. Using it for a smaller event needs a reason.',
          'Before telling a group they can use the van, check whether it is already booked that day. If it is, talk with the events team first.',
        ],
      },
    ],
  },
  {
    title: 'Food safety & assembly',
    items: [
      {
        topic: 'Review the toolkit with them',
        points: ['Food safety, setup and supplies: tablecloths, food-safe gloves, hair restraints.'],
      },
      {
        topic: 'Event rules',
        points: [
          'Food-safe gloves and hairnets (beardnets where relevant) for everyone.',
          'Access to sinks for handwashing. Hand sanitizer is NOT sufficient.',
          'Sandwiches are made indoors.',
          'Disposable tablecloths on work surfaces help keep the prep area clean.',
          'Someone to snap photos.',
        ],
      },
      {
        topic: 'Shopping',
        points: [
          'One person who has reviewed the food safety guidelines buys the supplies; others should not bring ingredients.',
          'Buy meat and cheese just before the event and keep it unopened until it is time to make sandwiches.',
          'Plan for coolers, meat and cheese storage, and bread.',
          'When transporting, keep meat and cheese on ice packs in a cooler.',
        ],
      },
      {
        topic: 'Keeping things cold',
        points: [
          'Meat and cheese stay refrigerated until used. Only take out what is needed.',
          'Once sandwiches are made and packed back into the bread bag, they go straight back in the fridge.',
          'Put the last sandwiches in the freezer to cool, or schedule pickup 30+ minutes after making.',
        ],
      },
      {
        topic: 'How to make the sandwiches',
        points: [
          'Deli: bread → cheese → meat → cheese → bread. Two slices of cheese, with the meat in between.',
          'Meat: check the serving size on the package and use that many slices per sandwich (= 2 oz, our required amount).',
          'PB&J: peanut butter on BOTH slices of bread; jelly on one side, kept away from the edges so it doesn\'t leak.',
          'Each sandwich goes in its own sandwich-sized ziploc, stacked 10–12 per stack, back in the bag the loaf came out of.',
          'Teams work in an assembly line.',
          'A runner gets meat and cheese out of the fridge and puts finished sandwiches back.',
          'Mention the recommended PB&J spatulas (link in the toolkit).',
        ],
      },
      {
        topic: 'Labels',
        points: ['Labels go on the outside of each loaf bag (the bag holding the 10–12 bagged sandwiches).'],
      },
    ],
  },
  {
    title: 'Logistics & wrap-up',
    items: [
      {
        topic: 'For the TSP volunteer',
        points: ['Parking or building access details.'],
      },
      { topic: 'How did they hear about us?' },
      {
        topic: 'After the call',
        points: ['Log the call with Log Contact and update the event with what you learned.'],
      },
    ],
  },
];

export function EventIntakeTrainingGuide() {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="mb-8" data-testid="event-intake-training-guide">
      <div className="flex items-center gap-3 mb-4 pb-3 border-b-2 border-[#236383]/30">
        <div className="bg-[#236383]/10 p-3 rounded-lg">
          <BookOpen className="w-7 h-7 text-[#236383]" />
        </div>
        <div className="min-w-0">
          <h2 className="text-2xl font-bold text-gray-900">Event Intake Training Guide</h2>
          <p className="text-sm text-gray-600">
            What to cover on an intake call with a group. Reference only; nothing here is saved.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto shrink-0"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          data-testid="button-toggle-intake-guide"
        >
          {open ? (
            <>
              <ChevronUp className="w-4 h-4 mr-1" /> Hide
            </>
          ) : (
            <>
              <ChevronDown className="w-4 h-4 mr-1" /> Open guide
            </>
          )}
        </Button>
      </div>

      {open && (
        <div className="grid gap-4 md:grid-cols-2">
          {INTAKE_GUIDE_SECTIONS.map((section) => (
            <section
              key={section.title}
              className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm"
            >
              <h3 className="text-lg font-semibold text-[#236383] mb-3">{section.title}</h3>
              <ul className="space-y-3">
                {section.items.map((item) => (
                  <li key={item.topic}>
                    <p className="font-medium text-gray-900">{item.topic}</p>
                    {item.points && item.points.length > 0 && (
                      <ul className="mt-1 ml-4 list-disc space-y-1 text-sm text-gray-700">
                        {item.points.map((point) => (
                          <li key={point}>{point}</li>
                        ))}
                      </ul>
                    )}
                    {item.link && (
                      <a
                        href={item.link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 ml-4 inline-block text-sm font-medium text-[#007E8C] underline hover:text-[#236383]"
                      >
                        {item.link.label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

export default EventIntakeTrainingGuide;
