import React, { useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BarChart3, User, Calendar, ArrowUpDown } from 'lucide-react';
import type { EventRequest } from '@shared/schema';

interface AdminOverviewDialogProps {
  isOpen: boolean;
  onClose: () => void;
  eventRequests: EventRequest[];
}

interface TspContactStats {
  userId: string;
  name: string;
  totalAssigned: number;
  byStatus: {
    new: number;
    in_process: number;
    scheduled: number;
    completed: number;
    declined: number;
  };
  events: EventRequest[];
}

export function AdminOverviewDialog({
  isOpen,
  onClose,
  eventRequests,
}: AdminOverviewDialogProps) {
  const [sortBy, setSortBy] = useState<'name' | 'total' | 'new' | 'in_process'>('total');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [statusFilter, setStatusFilter] = useState<'all' | 'new' | 'in_process' | 'scheduled'>('all');

  const handleSort = (field: 'name' | 'total' | 'new' | 'in_process') => {
    if (sortBy === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDirection('desc');
    }
  };

  const tspContactStats = useMemo(() => {
    const statsMap = new Map<string, TspContactStats>();

    // Process all event requests
    const filteredRequests = statusFilter === 'all'
      ? eventRequests
      : eventRequests.filter(e => e.status?.toLowerCase() === statusFilter);

    filteredRequests.forEach((event) => {
      const contactId = event.tspContact || event.customTspContact;
      if (!contactId) return;

      if (!statsMap.has(contactId)) {
        statsMap.set(contactId, {
          userId: contactId,
          name: event.tspContactName || contactId,
          totalAssigned: 0,
          byStatus: {
            new: 0,
            in_process: 0,
            scheduled: 0,
            completed: 0,
            declined: 0,
          },
          events: [],
        });
      }

      const stats = statsMap.get(contactId)!;
      stats.totalAssigned++;

      // Count by status
      const status = event.status?.toLowerCase() || 'new';
      if (status in stats.byStatus) {
        stats.byStatus[status as keyof typeof stats.byStatus]++;
      }

      stats.events.push(event);
    });

    // Convert to array and apply sorting
    const sortedStats = Array.from(statsMap.values()).sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'total':
          comparison = a.totalAssigned - b.totalAssigned;
          break;
        case 'new':
          comparison = a.byStatus.new - b.byStatus.new;
          break;
        case 'in_process':
          comparison = a.byStatus.in_process - b.byStatus.in_process;
          break;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return sortedStats;
  }, [eventRequests, sortBy, sortDirection, statusFilter]);

  const totalAssigned = eventRequests.filter(e => e.tspContact || e.customTspContact).length;
  const totalUnassigned = eventRequests.filter(e => !e.tspContact && !e.customTspContact).length;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-[95vw] max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-brand-primary flex items-center gap-3">
            <BarChart3 className="w-6 h-6" />
            TSP Contact Assignment Overview
          </DialogTitle>
          <DialogDescription>
            View workload distribution across TSP contacts for event request management
          </DialogDescription>
        </DialogHeader>

        {/* Summary Stats */}
        <div className="grid grid-cols-1 xs:grid-cols-3 gap-3 sm:gap-4 mb-6">
          <div className="premium-card-flat p-4">
            <div className="text-sm text-slate-600">Total Events</div>
            <div className="text-2xl font-bold text-brand-primary">{eventRequests.length}</div>
          </div>
          <div className="premium-card-flat p-4">
            <div className="text-sm text-slate-600">Assigned</div>
            <div className="text-2xl font-bold text-tsp-teal">{totalAssigned}</div>
          </div>
          <div className="premium-card-flat p-4">
            <div className="text-sm text-slate-600">Unassigned</div>
            <div className="text-2xl font-bold text-tsp-navy">{totalUnassigned}</div>
          </div>
        </div>

        {/* Filter and Sort Controls */}
        <div className="flex gap-4 items-center mb-4">
          <div className="flex gap-2 items-center">
            <span className="text-sm font-medium text-slate-600">Filter:</span>
            <div className="flex gap-1">
              <Button
                variant={statusFilter === 'all' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter('all')}
              >
                All
              </Button>
              <Button
                variant={statusFilter === 'new' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter('new')}
              >
                New
              </Button>
              <Button
                variant={statusFilter === 'in_process' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter('in_process')}
              >
                In Process
              </Button>
              <Button
                variant={statusFilter === 'scheduled' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter('scheduled')}
              >
                Scheduled
              </Button>
            </div>
          </div>
        </div>

        {/* Sort Controls */}
        <div className="flex gap-2 mb-4 flex-wrap">
          <span className="text-sm font-medium text-slate-600 self-center">Sort by:</span>
          <Button
            variant={sortBy === 'total' ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleSort('total')}
          >
            Total {sortBy === 'total' && <ArrowUpDown className="w-3 h-3 ml-1" />}
          </Button>
          <Button
            variant={sortBy === 'name' ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleSort('name')}
          >
            Name {sortBy === 'name' && <ArrowUpDown className="w-3 h-3 ml-1" />}
          </Button>
          <Button
            variant={sortBy === 'new' ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleSort('new')}
          >
            New {sortBy === 'new' && <ArrowUpDown className="w-3 h-3 ml-1" />}
          </Button>
          <Button
            variant={sortBy === 'in_process' ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleSort('in_process')}
          >
            In Process {sortBy === 'in_process' && <ArrowUpDown className="w-3 h-3 ml-1" />}
          </Button>
        </div>

        {/* TSP Contact Stats Table */}
        <div className="space-y-3">
          <h3 className="font-semibold text-lg text-brand-primary">Assignment by TSP Contact</h3>

          {tspContactStats.length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              No TSP contact assignments found
            </div>
          ) : (
            <div className="space-y-2">
              {tspContactStats.map((stat) => (
                <div
                  key={stat.userId}
                  className="premium-card-flat p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-brand-primary/10 flex items-center justify-center">
                        <User className="w-5 h-5 text-brand-primary" />
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900">{stat.name}</div>
                        <div className="text-sm text-slate-500">
                          <Calendar className="w-3 h-3 inline mr-1" />
                          {stat.totalAssigned} {stat.totalAssigned === 1 ? 'event' : 'events'} assigned
                        </div>
                      </div>
                    </div>
                    <Badge className="bg-brand-primary text-white">
                      {stat.totalAssigned}
                    </Badge>
                  </div>

                  {/* Status Breakdown */}
                  <div className="flex flex-wrap gap-2 ml-13">
                    {stat.byStatus.new > 0 && (
                      <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                        New: {stat.byStatus.new}
                      </Badge>
                    )}
                    {stat.byStatus.in_process > 0 && (
                      <Badge variant="outline" className="text-xs bg-yellow-50 text-yellow-700 border-yellow-200">
                        In Process: {stat.byStatus.in_process}
                      </Badge>
                    )}
                    {stat.byStatus.scheduled > 0 && (
                      <Badge variant="outline" className="text-xs bg-tsp-mist text-tsp-navy border-tsp-teal/30">
                        Scheduled: {stat.byStatus.scheduled}
                      </Badge>
                    )}
                    {stat.byStatus.completed > 0 && (
                      <Badge variant="outline" className="text-xs bg-tsp-sky/15 text-tsp-teal border-tsp-sky">
                        Completed: {stat.byStatus.completed}
                      </Badge>
                    )}
                    {stat.byStatus.declined > 0 && (
                      <Badge variant="outline" className="text-xs bg-red-50 text-red-700 border-red-200">
                        Declined: {stat.byStatus.declined}
                      </Badge>
                    )}

                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end pt-4 border-t mt-6">
          <Button onClick={onClose} className="premium-btn-primary">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
