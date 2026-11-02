import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, Car, Building2, Heart } from 'lucide-react';
import { useLocation } from 'wouter';
import { usePageSession } from '@/hooks/usePageSession';

interface DirectoryOption {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  href: string;
  color: string;
}

const directoryOptions: DirectoryOption[] = [
  {
    id: 'volunteers',
    title: 'Volunteers',
    description: 'View and manage all volunteers in the organization',
    icon: Users,
    href: '/volunteers',
    color: 'bg-[#47B3CB]/20 text-[#236383] border-[#47B3CB]/30',
  },
  {
    id: 'drivers',
    title: 'Drivers',
    description: 'View and manage drivers for sandwich deliveries',
    icon: Car,
    href: '/drivers',
    color: 'bg-[#236383]/20 text-[#236383] border-[#236383]/30',
  },
  {
    id: 'hosts',
    title: 'Hosts',
    description: 'View and manage host locations where sandwiches are made',
    icon: Building2,
    href: '/hosts',
    color: 'bg-[#FBAD3F]/20 text-[#996B26] border-[#FBAD3F]/30',
  },
  {
    id: 'recipients',
    title: 'Recipients',
    description: 'View and manage organizations that receive sandwiches',
    icon: Heart,
    href: '/recipients',
    color: 'bg-[#A31C41]/20 text-[#A31C41] border-[#A31C41]/30',
  },
];

export default function Directory() {
  const [, setLocation] = useLocation();

  const { trackAction } = usePageSession({
    section: 'Directory',
    page: 'Directory Home',
  });

  const handleNavigate = (option: DirectoryOption) => {
    trackAction('Navigate', `Opened ${option.title} directory`);
    setLocation(option.href);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-[#236383]">Directory</h1>
        <p className="text-[#236383]/70 mt-2">
          Access and manage all people and organizations in TSP
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {directoryOptions.map((option) => {
          const Icon = option.icon;
          return (
            <Card
              key={option.id}
              className={`cursor-pointer transition-all hover:shadow-lg hover:scale-[1.02] border-2 ${option.color}`}
              onClick={() => handleNavigate(option)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className={`p-3 rounded-lg ${option.color}`}>
                    <Icon className="h-6 w-6" />
                  </div>
                  <CardTitle className="text-xl">{option.title}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base">
                  {option.description}
                </CardDescription>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
