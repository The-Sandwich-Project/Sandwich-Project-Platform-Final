import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import {
  Trophy,
  ChevronDown,
  ChevronRight,
  Search,
  Award,
  Star,
  Mail,
  CheckCircle2,
  Send,
  Calendar,
  User,
  Sparkles,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface ChallengeCompletion {
  challengeId: number;
  challengeTitle: string;
  points: number;
  completedAt: Date;
  kudosSent: boolean;
}

interface UserProgress {
  userId: string;
  userName: string;
  email: string;
  role: string;
  totalPoints: number;
  completedChallenges: number;
  completions: ChallengeCompletion[];
}

export default function AdminOnboardingKudos() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());
  const [kudosToSend, setKudosToSend] = useState<{
    userId: string;
    userName: string;
    challengeId: number;
    challengeTitle: string;
  } | null>(null);

  const { data: usersProgress = [], isLoading } = useQuery<UserProgress[]>({
    queryKey: ['/api/onboarding/admin/users-progress'],
  });

  const sendKudosMutation = useMutation({
    mutationFn: async ({
      recipientId,
      challengeId,
      challengeTitle,
    }: {
      recipientId: string;
      challengeId: number;
      challengeTitle: string;
    }) => {
      return apiRequest('POST', '/api/messaging/kudos/send', {
        recipientId,
        content: `Congratulations on completing "${challengeTitle}"! 🎉`,
        contextType: 'onboarding_challenge',
        contextId: String(challengeId),
        entityName: challengeTitle,
      });
    },
    onSuccess: (_, variables) => {
      toast({
        title: 'Kudos Sent! 🎉',
        description: `Congratulations sent to the user for completing "${variables.challengeTitle}"`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/onboarding/admin/users-progress'] });
      setKudosToSend(null);
    },
    onError: (error) => {
      toast({
        title: 'Failed to Send Kudos',
        description: error instanceof Error ? error.message : 'An error occurred',
        variant: 'destructive',
      });
    },
  });

  const toggleUser = (userId: string) => {
    const newExpanded = new Set(expandedUsers);
    if (newExpanded.has(userId)) {
      newExpanded.delete(userId);
    } else {
      newExpanded.add(userId);
    }
    setExpandedUsers(newExpanded);
  };

  const filteredUsers = usersProgress.filter((user) => {
    const query = searchQuery.toLowerCase();
    return (
      user.userName.toLowerCase().includes(query) ||
      user.email.toLowerCase().includes(query) ||
      user.role.toLowerCase().includes(query)
    );
  });

  const usersWithCompletions = filteredUsers.filter(
    (user) => user.completedChallenges > 0
  );

  const getRoleBadgeColor = (role: string) => {
    switch (role.toLowerCase()) {
      case 'admin':
      case 'super_admin':
        return 'bg-[#236383] text-white hover:bg-[#006975]';
      case 'core_team':
        return 'bg-[#236383] text-white hover:bg-[#1a4d6b]';
      default:
        return 'bg-gray-100 text-gray-700 hover:bg-gray-200';
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4 p-6" data-testid="admin-kudos-loading">
        <div className="flex items-center gap-3 mb-6">
          <Skeleton className="h-12 w-12 rounded-lg" />
          <div>
            <Skeleton className="h-8 w-64 mb-2" />
            <Skeleton className="h-4 w-96" />
          </div>
        </div>
        <Skeleton className="h-10 w-full mb-6" />
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <Skeleton className="h-6 w-48 mb-2" />
                  <Skeleton className="h-4 w-64" />
                </div>
                <Skeleton className="h-16 w-32" />
              </div>
            </CardHeader>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6" data-testid="admin-kudos-container">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="bg-gradient-to-br from-[#FBAD3F] to-[#f59e0b] p-3 rounded-lg shadow-lg">
          <Trophy className="h-8 w-8 text-white" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            Onboarding Challenge Kudos
          </h1>
          <p className="text-gray-600 mt-1">
            Send congratulations to users who complete onboarding challenges
          </p>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          placeholder="Search by name, email, or role..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
          data-testid="input-search-users"
        />
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-l-4 border-[#236383]">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Users</p>
                <p className="text-2xl font-bold text-gray-900">
                  {filteredUsers.length}
                </p>
              </div>
              <User className="h-8 w-8 text-[#236383]" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-[#236383]">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">
                  Users with Completions
                </p>
                <p className="text-2xl font-bold text-gray-900">
                  {usersWithCompletions.length}
                </p>
              </div>
              <CheckCircle2 className="h-8 w-8 text-[#236383]" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-[#FBAD3F]">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">
                  Total Completions
                </p>
                <p className="text-2xl font-bold text-gray-900">
                  {filteredUsers.reduce(
                    (sum, user) => sum + user.completedChallenges,
                    0
                  )}
                </p>
              </div>
              <Award className="h-8 w-8 text-[#FBAD3F]" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* User Cards */}
      <ScrollArea className="h-[600px]">
        <div className="space-y-4 pr-4">
          {usersWithCompletions.length === 0 ? (
            <Card className="p-12" data-testid="empty-state">
              <div className="text-center">
                <div className="bg-gray-100 rounded-full w-24 h-24 flex items-center justify-center mx-auto mb-4">
                  <Trophy className="h-12 w-12 text-gray-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  No Challenge Completions Yet
                </h3>
                <p className="text-gray-600 max-w-md mx-auto">
                  {searchQuery
                    ? 'No users match your search criteria.'
                    : 'Users who complete onboarding challenges will appear here.'}
                </p>
              </div>
            </Card>
          ) : (
            usersWithCompletions.map((user) => {
              const isExpanded = expandedUsers.has(user.userId);
              const kudosSentCount = user.completions.filter(
                (c) => c.kudosSent
              ).length;
              const kudosPendingCount = user.completedChallenges - kudosSentCount;

              return (
                <Card
                  key={user.userId}
                  className="hover:shadow-md transition-shadow"
                  data-testid={`card-user-${user.userId}`}
                >
                  <Collapsible
                    open={isExpanded}
                    onOpenChange={() => toggleUser(user.userId)}
                  >
                    <CardHeader>
                      <CollapsibleTrigger className="w-full" asChild>
                        <div className="flex items-center justify-between cursor-pointer group">
                          <div className="flex items-center gap-4 flex-1">
                            <div className="bg-gradient-to-br from-[#236383] to-[#236383] rounded-full w-12 h-12 flex items-center justify-center text-white font-bold text-lg shadow-lg">
                              {user.userName
                                .split(' ')
                                .map((n) => n[0])
                                .join('')
                                .toUpperCase()
                                .slice(0, 2)}
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <h3 className="font-semibold text-lg text-gray-900">
                                  {user.userName}
                                </h3>
                                <Badge
                                  className={getRoleBadgeColor(user.role)}
                                  variant="secondary"
                                >
                                  {user.role}
                                </Badge>
                              </div>
                              <div className="flex items-center gap-2 text-sm text-gray-600">
                                <Mail className="h-4 w-4" />
                                <span>{user.email}</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-6">
                            <div className="text-center">
                              <div className="flex items-center gap-2 text-[#FBAD3F]">
                                <Star className="h-5 w-5 fill-current" />
                                <p className="text-2xl font-bold">
                                  {user.totalPoints}
                                </p>
                              </div>
                              <p className="text-xs text-gray-500">points</p>
                            </div>

                            <div className="text-center">
                              <p className="text-2xl font-bold text-[#236383]">
                                {user.completedChallenges}
                              </p>
                              <p className="text-xs text-gray-500">
                                completed
                              </p>
                            </div>

                            {kudosPendingCount > 0 && (
                              <Badge
                                variant="outline"
                                className="bg-orange-50 text-orange-700 border-orange-200"
                              >
                                {kudosPendingCount} pending kudos
                              </Badge>
                            )}

                            {isExpanded ? (
                              <ChevronDown className="h-5 w-5 text-gray-400 group-hover:text-gray-600" />
                            ) : (
                              <ChevronRight className="h-5 w-5 text-gray-400 group-hover:text-gray-600" />
                            )}
                          </div>
                        </div>
                      </CollapsibleTrigger>
                    </CardHeader>

                    <CollapsibleContent>
                      <CardContent className="pt-0">
                        <div className="border-t pt-4">
                          <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                            <Sparkles className="h-4 w-4 text-[#FBAD3F]" />
                            Completed Challenges
                          </h4>
                          <div className="space-y-2">
                            {user.completions
                              .sort(
                                (a, b) =>
                                  new Date(b.completedAt).getTime() -
                                  new Date(a.completedAt).getTime()
                              )
                              .map((completion) => (
                                <div
                                  key={completion.challengeId}
                                  className={`flex items-center justify-between p-3 rounded-lg border ${
                                    completion.kudosSent
                                      ? 'bg-green-50 border-green-200'
                                      : 'bg-gray-50 border-gray-200'
                                  }`}
                                  data-testid={`challenge-${completion.challengeId}-${user.userId}`}
                                >
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                      <CheckCircle2
                                        className={`h-4 w-4 ${
                                          completion.kudosSent
                                            ? 'text-green-600'
                                            : 'text-gray-400'
                                        }`}
                                      />
                                      <p className="font-medium text-gray-900">
                                        {completion.challengeTitle}
                                      </p>
                                      <Badge
                                        variant="secondary"
                                        className="bg-[#FBAD3F] text-white hover:bg-[#f59e0b]"
                                      >
                                        +{completion.points} pts
                                      </Badge>
                                    </div>
                                    <div className="flex items-center gap-1 text-xs text-gray-500 ml-6">
                                      <Calendar className="h-3 w-3" />
                                      <span>
                                        Completed{' '}
                                        {new Date(
                                          completion.completedAt
                                        ).toLocaleDateString('en-US', {
                                          month: 'short',
                                          day: 'numeric',
                                          year: 'numeric',
                                        })}
                                      </span>
                                    </div>
                                  </div>

                                  <div>
                                    {completion.kudosSent ? (
                                      <Badge className="bg-green-600 hover:bg-green-700">
                                        <CheckCircle2 className="h-3 w-3 mr-1" />
                                        Kudos Sent ✓
                                      </Badge>
                                    ) : (
                                      <Button
                                        size="sm"
                                        onClick={() =>
                                          setKudosToSend({
                                            userId: user.userId,
                                            userName: user.userName,
                                            challengeId: completion.challengeId,
                                            challengeTitle:
                                              completion.challengeTitle,
                                          })
                                        }
                                        disabled={sendKudosMutation.isPending}
                                        className="bg-[#236383] hover:bg-[#006975] text-white"
                                        data-testid={`button-send-kudos-${completion.challengeId}`}
                                      >
                                        <Send className="h-3 w-3 mr-1" />
                                        Send Kudos
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              ))}
                          </div>
                        </div>
                      </CardContent>
                    </CollapsibleContent>
                  </Collapsible>
                </Card>
              );
            })
          )}
        </div>
      </ScrollArea>

      {/* Confirmation Dialog */}
      <AlertDialog
        open={!!kudosToSend}
        onOpenChange={(open) => !open && setKudosToSend(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <div className="bg-[#FBAD3F] p-2 rounded-lg">
                <Trophy className="h-5 w-5 text-white" />
              </div>
              Send Kudos?
            </AlertDialogTitle>
            <AlertDialogDescription className="pt-2">
              {kudosToSend && (
                <div className="space-y-3">
                  <p>
                    You're about to send congratulations to{' '}
                    <span className="font-semibold text-gray-900">
                      {kudosToSend.userName}
                    </span>{' '}
                    for completing:
                  </p>
                  <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                    <p className="font-medium text-gray-900">
                      "{kudosToSend.challengeTitle}"
                    </p>
                  </div>
                  <p className="text-sm text-gray-600">
                    They will receive a notification with your congratulations
                    message.
                  </p>
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-kudos">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (kudosToSend) {
                  sendKudosMutation.mutate({
                    recipientId: kudosToSend.userId,
                    challengeId: kudosToSend.challengeId,
                    challengeTitle: kudosToSend.challengeTitle,
                  });
                }
              }}
              disabled={sendKudosMutation.isPending}
              className="bg-[#236383] hover:bg-[#006975]"
              data-testid="button-confirm-kudos"
            >
              {sendKudosMutation.isPending ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Send Kudos
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
