import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { logger } from '@/lib/logger';

interface ConfirmationDialogProps {
  trigger: React.ReactNode;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void | Promise<void>;
  variant?: 'default' | 'destructive';
  disabled?: boolean;
}

export function ConfirmationDialog({
  trigger,
  title,
  description,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  variant = 'default',
  disabled = false,
}: ConfirmationDialogProps) {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleConfirm = async () => {
    setIsLoading(true);
    try {
      await onConfirm();
      setOpen(false);
    } catch (error) {
      logger.error('Confirmation action failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild disabled={disabled}>
        {trigger}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader className="border-b border-[#236383]/10 pb-4">
          <AlertDialogTitle className="text-[#236383] text-xl">{title}</AlertDialogTitle>
          <AlertDialogDescription className="text-gray-600 mt-2">{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="pt-4">
          <AlertDialogCancel disabled={isLoading} className="border-gray-300 text-gray-700 hover:bg-gray-50">
            {cancelText}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={isLoading}
            className={
              variant === 'destructive' ? 'bg-[#A31C41] hover:bg-[#A31C41]/90 text-white shadow-sm' : 'bg-[#236383] hover:bg-[#236383] text-white shadow-sm'
            }
          >
            {isLoading ? 'Processing...' : confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Hook for programmatic confirmation dialogs
export function useConfirmation() {
  const [dialogState, setDialogState] = useState<{
    open: boolean;
    title: string;
    description: string;
    onConfirm: () => void | Promise<void>;
    onCancel?: () => void;
    variant?: 'default' | 'destructive';
  } | null>(null);

  const confirm = (
    title: string,
    description: string,
    onConfirm: () => void | Promise<void>,
    variant: 'default' | 'destructive' = 'default',
    onCancel?: () => void
  ) => {
    setDialogState({ open: true, title, description, onConfirm, onCancel, variant });
  };

  const handleCancel = () => {
    if (dialogState?.onCancel) {
      dialogState.onCancel();
    }
    setDialogState(null);
  };

  const ConfirmationDialogComponent = dialogState ? (
    <AlertDialog
      open={dialogState.open}
      onOpenChange={(open) => !open && handleCancel()}
    >
      <AlertDialogContent>
        <AlertDialogHeader className="border-b border-[#236383]/10 pb-4">
          <AlertDialogTitle className="text-[#236383] text-xl">{dialogState.title}</AlertDialogTitle>
          <AlertDialogDescription className="text-gray-600 mt-2">
            {dialogState.description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="pt-4">
          <AlertDialogCancel onClick={handleCancel} className="border-gray-300 text-gray-700 hover:bg-gray-50">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={async () => {
              await dialogState.onConfirm();
              setDialogState(null);
            }}
            className={
              dialogState.variant === 'destructive'
                ? 'bg-[#A31C41] hover:bg-[#A31C41]/90 text-white shadow-sm'
                : 'bg-[#236383] hover:bg-[#236383] text-white shadow-sm'
            }
          >
            Confirm
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ) : null;

  return { confirm, ConfirmationDialogComponent };
}
