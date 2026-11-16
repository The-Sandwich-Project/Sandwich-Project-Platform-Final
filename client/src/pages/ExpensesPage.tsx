import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Plus } from 'lucide-react';
import { ExpenseForm } from '@/components/expenses/ExpenseForm';
import { ExpensesList } from '@/components/expenses/ExpensesList';
import { PageBreadcrumbs } from '@/components/page-breadcrumbs';
import { useOnboardingTracker } from '@/hooks/useOnboardingTracker';

import { usePageSession } from '@/hooks/usePageSession';
export default function ExpensesPage() {
  // Track page session for activity logging
  usePageSession({
    section: 'Operations',
    page: 'Expenses & Receipts',
  });

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { track } = useOnboardingTracker();

  // Track onboarding challenge on page load
  useEffect(() => {
    track('view_expenses');
  }, []);

  const handleExpenseCreated = () => {
    setIsDialogOpen(false);
  };

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-4 sm:space-y-6">
      <PageBreadcrumbs segments={[
        { label: 'Operations' },
        { label: 'Expenses & Receipts' }
      ]} />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Expenses & Receipts</h1>
          <p className="text-sm sm:text-base text-muted-foreground mt-1">
            Track expenses and upload receipts for reimbursement
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="w-full sm:w-auto h-11">
              <Plus className="w-4 h-4 mr-2" />
              Add Expense
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto mx-4 sm:mx-auto">
            <DialogHeader>
              <DialogTitle className="text-lg sm:text-xl">Add New Expense</DialogTitle>
              <DialogDescription className="text-sm">
                Enter expense details and upload a receipt for reimbursement
              </DialogDescription>
            </DialogHeader>
            <ExpenseForm
              onSuccess={handleExpenseCreated}
              onCancel={() => setIsDialogOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>

      <ExpensesList showFilters={true} />
    </div>
  );
}
