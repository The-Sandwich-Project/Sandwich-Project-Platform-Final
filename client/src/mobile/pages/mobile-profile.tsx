import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import {
  User,
  Mail,
  Phone,
  MapPin,
  Calendar,
  Shield,
  LogOut,
  ChevronRight,
  Edit,
} from 'lucide-react';
import { MobileShell } from '../components/mobile-shell';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

import { usePageSession } from '@/hooks/usePageSession';
/**
 * Mobile profile screen - view and edit user profile
 */
export function MobileProfile() {
  // Track page session for activity logging
  usePageSession({
    section: 'Mobile',
    page: 'Mobile Profile',
  });

  const [, navigate] = useLocation();
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const profileFields = [
    {
      icon: Mail,
      label: 'Email',
      value: user?.email || 'Not set',
    },
    {
      icon: Phone,
      label: 'Phone',
      value: user?.phone || 'Not set',
    },
    {
      icon: MapPin,
      label: 'Location',
      value: user?.city || user?.area || 'Not set',
    },
    {
      icon: Shield,
      label: 'Role',
      value: user?.role || 'Member',
    },
    {
      icon: Calendar,
      label: 'Member since',
      value: user?.createdAt
        ? format(new Date(user.createdAt), 'MMMM yyyy')
        : 'Unknown',
    },
  ];

  return (
    <MobileShell
      title="My Profile"
      showBack
      showNav
      headerActions={
        <button
          onClick={() => navigate('/profile/edit')}
          className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700"
        >
          <Edit className="w-5 h-5 text-slate-600 dark:text-slate-300" />
        </button>
      }
    >
      <div className="p-4 space-y-4">
        {/* Profile header */}
        <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700 text-center">
          <div className="w-20 h-20 rounded-full bg-brand-primary/10 flex items-center justify-center mx-auto mb-4">
            {user?.profileImageUrl ? (
              <img
                src={user.profileImageUrl}
                alt={user.firstName || 'Profile'}
                className="w-20 h-20 rounded-full object-cover"
              />
            ) : (
              <User className="w-10 h-10 text-brand-primary" />
            )}
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            {user?.firstName} {user?.lastName}
          </h1>
          {user?.email && (
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              {user.email}
            </p>
          )}
        </div>

        {/* Profile fields */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
          {profileFields.map((field) => (
            <div
              key={field.label}
              className="flex items-center gap-3 p-4"
            >
              <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
                <field.icon className="w-5 h-5 text-slate-500 dark:text-slate-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  {field.label}
                </p>
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                  {field.value}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Edit profile link */}
        <button
          onClick={() => navigate('/profile')}
          className={cn(
            "w-full bg-white dark:bg-slate-800 rounded-xl p-4",
            "border border-slate-200 dark:border-slate-700",
            "flex items-center justify-between",
            "active:scale-[0.99] transition-transform"
          )}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-brand-primary/10 flex items-center justify-center">
              <Edit className="w-5 h-5 text-brand-primary" />
            </div>
            <span className="font-medium text-slate-900 dark:text-slate-100">
              Edit full profile
            </span>
          </div>
          <ChevronRight className="w-5 h-5 text-slate-400" />
        </button>

        {/* Logout button */}
        <button
          onClick={handleLogout}
          className={cn(
            "w-full bg-red-50 dark:bg-red-900/20 rounded-xl p-4",
            "border border-red-200 dark:border-red-800",
            "flex items-center justify-center gap-2",
            "text-red-600 dark:text-red-400 font-medium",
            "active:scale-[0.99] transition-transform"
          )}
        >
          <LogOut className="w-5 h-5" />
          Sign Out
        </button>
      </div>
    </MobileShell>
  );
}

export default MobileProfile;
