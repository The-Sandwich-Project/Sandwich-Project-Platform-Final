import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import {
  FileText,
  Trash2,
  CheckCircle,
  XCircle,
  Clock,
  DollarSign,
  ExternalLink,
  Filter,

  Info,
} from 'lucide-react';
import { format } from 'date-fns';
import { logger } from '@/lib/logger';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getExpenseDefaults, getRoleViewDescription } from '@shared/role-view-defaults';

interface Expense {
  id: number;
  contextType?: string;
  contextId?: number;
  description: string;
  amount: string;
  category?: string;
  vendor?: string;
  purchaseDate?: string;
  receiptUrl?: string;
  receiptFileName?: string;
  uploadedBy: string;
  uploaderName?: string;
  uploadedAt: string;
  status: string;
  notes?: string;
  approvedBy?: string;
  approvedAt?: string;
}

interface ExpensesListProps {
  contextType?: 'event' | 'project' | 'general';
  contextId?: number;
  showFilters?: boolean;
}

export function ExpensesList({
  contextType,
  contextId,
  showFilters = true,
}: ExpensesListProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Get role-based defaults for expenses
  const expenseDefaults = useMemo(() => {
    if (!user?.role) {
      return getExpenseDefaults('viewer');
    }
    return getExpenseDefaults(user.role);
  }, [user?.role]);

  const [statusFilter, setStatusFilter] = useState<string>(expenseDefaults.defaultStatusFilter);
  const [categoryFilter, setCategoryFilter] = useState<string>(expenseDefaults.defaultCategoryFilter);

  // Sync filters with role defaults when user loads (handles async user fetch)
  useEffect(() => {
    setStatusFilter(expenseDefaults.defaultStatusFilter);
    setCategoryFilter(expenseDefaults.defaultCategoryFilter);
  }, [expenseDefaults.defaultStatusFilter, expenseDefaults.defaultCategoryFilter]);

  // Build query params
  const queryParams = new URLSearchParams();
  if (contextType) queryParams.append('contextType', contextType);
  if (contextId) queryParams.append('contextId', contextId.toString());
  if (statusFilter !== 'all') queryParams.append('status', statusFilter);
  if (categoryFilter !== 'all') queryParams.append('category', categoryFilter);

  // Fetch expenses
  const { data: rawExpenses = [], isLoading } = useQuery<Expense[]>({
    queryKey: ['expenses', contextType, contextId, statusFilter, categoryFilter],
    queryFn: async () => {
      const response = await fetch(`/api/expenses?${queryParams}`);
      if (!response.ok) {
        throw new Error('Failed to fetch expenses');
      }
      return response.json();
    },
  });

  // Apply role-based sorting - show user's own expenses first if role specifies
  const expenses = useMemo(() => {
    if (!expenseDefaults.showOwnFirst || !user?.id) {
      return rawExpenses;
    }

    // Sort so user's own expenses appear first
    return [...rawExpenses].sort((a, b) => {
      const aIsOwn = a.uploadedBy === user.id;
      const bIsOwn = b.uploadedBy === user.id;

      if (aIsOwn && !bIsOwn) return -1;
      if (!aIsOwn && bIsOwn) return 1;

      // If both are own or both are not own, maintain original order (by date)
      return new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime();
    });
  }, [rawExpenses, expenseDefaults.showOwnFirst, user?.id]);

  // Delete expense mutation
  const deleteMutation = useMutation({
    mutationFn: async (expenseId: number) => {
      const response = await fetch(`/api/expenses/${expenseId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete expense');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      toast({
        title: 'Expense deleted',
        description: 'Expense has been deleted successfully',
      });
    },
    onError: (error: Error) => {
      logger.error('Error deleting expense', error);
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Approve expense mutation
  const approveMutation = useMutation({
    mutationFn: async (expenseId: number) => {
      const response = await fetch(`/api/expenses/${expenseId}/approve`, {
        method: 'PATCH',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to approve expense');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      toast({
        title: 'Expense approved',
        description: 'Expense has been approved successfully',
      });
    },
    onError: (error: Error) => {
      logger.error('Error approving expense', error);
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return (
          <Badge variant="default" className="bg-green-500">
            <CheckCircle className="w-3 h-3 mr-1" />
            Approved
          </Badge>
        );
      case 'rejected':
        return (
          <Badge variant="destructive">
            <XCircle className="w-3 h-3 mr-1" />
            Rejected
          </Badge>
        );
      case 'reimbursed':
        return (
          <Badge variant="default" className="bg-blue-500">
            <DollarSign className="w-3 h-3 mr-1" />
            Reimbursed
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary">
            <Clock className="w-3 h-3 mr-1" />
            Pending
          </Badge>
        );
    }
  };

  const getCategoryBadge = (category?: string) => {
    if (!category) return null;
    const colors: Record<string, string> = {
      food: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
      supplies: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
      transport: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
      reimbursement: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      other: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
    };
    return (
      <span className={`text-xs px-2 py-1 rounded ${colors[category] || colors.other}`}>
        {category.charAt(0).toUpperCase() + category.slice(1)}
      </span>
    );
  };

  const totalAmount = expenses.reduce((sum, expense) => sum + parseFloat(expense.amount), 0);

  if (isLoading) {
    return <div className="text-center py-8">Loading expenses...</div>;
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <CardTitle>Expenses</CardTitle>
            <CardDescription>
              {expenses.length} expense{expenses.length !== 1 ? 's' : ''} totaling ${totalAmount.toFixed(2)}
            </CardDescription>
          </div>
          {showFilters && (
            <div className="flex gap-2 flex-wrap">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[110px] sm:w-[140px]">
                  <Filter className="w-4 h-4 mr-1 sm:mr-2 flex-shrink-0" />
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="reimbursed">Reimbursed</SelectItem>
                </SelectContent>
              </Select>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[110px] sm:w-[140px]">
                  <Filter className="w-4 h-4 mr-1 sm:mr-2 flex-shrink-0" />
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  <SelectItem value="food">Food</SelectItem>
                  <SelectItem value="supplies">Supplies</SelectItem>
                  <SelectItem value="transport">Transport</SelectItem>
                  <SelectItem value="reimbursement">Reimbursement</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {/* Role-customized view indicator */}
        {user?.role && user.role !== 'super_admin' && user.role !== 'admin' && (
          <div className="mb-4 p-3 rounded border-l-4" style={{
            backgroundColor: 'rgba(0, 126, 140, 0.08)',
            borderLeftColor: '#007E8C'
          }}>
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#007E8C' }} />
              <p className="text-sm" style={{ color: '#236383' }}>
                {getRoleViewDescription(user.role, 'expenses')}
              </p>
            </div>
          </div>
        )}

        {expenses.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No expenses found
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Receipt</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {expenses.map((expense) => (
                <TableRow key={expense.id}>
                  <TableCell>
                    <div className="space-y-1">
                      <div className="font-medium">{expense.description}</div>
                      {expense.vendor && (
                        <div className="text-xs text-muted-foreground">
                          {expense.vendor}
                        </div>
                      )}
                      {expense.uploaderName && (
                        <div className="text-xs text-muted-foreground">
                          by {expense.uploaderName}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">
                    ${parseFloat(expense.amount).toFixed(2)}
                  </TableCell>
                  <TableCell>
                    {getCategoryBadge(expense.category)}
                  </TableCell>
                  <TableCell>
                    {expense.purchaseDate
                      ? format(new Date(expense.purchaseDate), 'MMM d, yyyy')
                      : format(new Date(expense.uploadedAt), 'MMM d, yyyy')}
                  </TableCell>
                  <TableCell>{getStatusBadge(expense.status)}</TableCell>
                  <TableCell>
                    {expense.receiptUrl ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        asChild
                      >
                        <a
                          href={expense.receiptUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <FileText className="w-4 h-4 mr-1" />
                          View
                          <ExternalLink className="w-3 h-3 ml-1" />
                        </a>
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">No receipt</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {expense.status === 'pending' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => approveMutation.mutate(expense.id)}
                          disabled={approveMutation.isPending}
                        >
                          <CheckCircle className="w-4 h-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteMutation.mutate(expense.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
