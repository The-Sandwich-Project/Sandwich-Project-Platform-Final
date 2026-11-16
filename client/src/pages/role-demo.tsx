import { useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Shield,
  Users,
  Truck,
  Home,
  Heart,
  Eye,
  UserCheck,
  MessageCircle,
  Edit,
  Trash2,
  Phone,
  FileText,
  BarChart3,
} from 'lucide-react';
import {
  USER_ROLES,
  PERMISSIONS,
  getDefaultPermissionsForRole,
  getRoleDisplayName,
} from '@shared/auth-utils';
import { hasPermission } from '@shared/unified-auth-utils';

import { usePageSession } from '@/hooks/usePageSession';
// Sample user objects for each role
const sampleUsers = {
  [USER_ROLES.ADMIN]: {
    id: 'admin-1',
    role: USER_ROLES.ADMIN,
    firstName: 'Sarah',
    lastName: 'Admin',
    email: 'sarah@tsp.org',
    permissions: getDefaultPermissionsForRole(USER_ROLES.ADMIN),
  },
  [USER_ROLES.COMMITTEE_MEMBER]: {
    id: 'committee-1',
    role: USER_ROLES.COMMITTEE_MEMBER,
    firstName: 'Mike',
    lastName: 'Committee',
    email: 'mike@tsp.org',
    permissions: getDefaultPermissionsForRole(USER_ROLES.COMMITTEE_MEMBER),
  },
  [USER_ROLES.HOST]: {
    id: 'host-1',
    role: USER_ROLES.HOST,
    firstName: 'Lisa',
    lastName: 'Host',
    email: 'lisa@community.org',
    permissions: getDefaultPermissionsForRole(USER_ROLES.HOST),
  },
  [USER_ROLES.CORE_TEAM]: {
    id: 'core-team-1',
    role: USER_ROLES.CORE_TEAM,
    firstName: 'Jordan',
    lastName: 'CoreTeam',
    email: 'jordan@tsp.org',
    permissions: getDefaultPermissionsForRole(USER_ROLES.CORE_TEAM),
  },
  [USER_ROLES.DRIVER]: {
    id: 'driver-1',
    role: USER_ROLES.DRIVER,
    firstName: 'Carlos',
    lastName: 'Driver',
    email: 'carlos@volunteers.org',
    permissions: getDefaultPermissionsForRole(USER_ROLES.DRIVER),
  },
  [USER_ROLES.VOLUNTEER]: {
    id: 'volunteer-1',
    role: USER_ROLES.VOLUNTEER,
    firstName: 'Emma',
    lastName: 'Volunteer',
    email: 'emma@helpers.org',
    permissions: getDefaultPermissionsForRole(USER_ROLES.VOLUNTEER),
  },
  [USER_ROLES.RECIPIENT]: {
    id: 'recipient-1',
    role: USER_ROLES.RECIPIENT,
    firstName: 'David',
    lastName: 'Recipient',
    email: 'david@community.org',
    permissions: getDefaultPermissionsForRole(USER_ROLES.RECIPIENT),
  },
  [USER_ROLES.VIEWER]: {
    id: 'viewer-1',
    role: USER_ROLES.VIEWER,
    firstName: 'Alex',
    lastName: 'Viewer',
    email: 'alex@public.org',
    permissions: getDefaultPermissionsForRole(USER_ROLES.VIEWER),
  },
};

const roleIcons = {
  [USER_ROLES.ADMIN]: Shield,
  [USER_ROLES.COMMITTEE_MEMBER]: UserCheck,
  [USER_ROLES.CORE_TEAM]: UserCheck,
  [USER_ROLES.HOST]: Home,
  [USER_ROLES.DRIVER]: Truck,
  [USER_ROLES.VOLUNTEER]: Heart,
  [USER_ROLES.RECIPIENT]: Users,
  [USER_ROLES.VIEWER]: Eye,
};

const roleColors = {
  [USER_ROLES.ADMIN]: 'bg-red-100 text-red-800',
  [USER_ROLES.COMMITTEE_MEMBER]: 'bg-purple-100 text-purple-800',
  [USER_ROLES.CORE_TEAM]: 'bg-purple-100 text-purple-800',
  [USER_ROLES.HOST]: 'bg-brand-primary-light text-brand-primary-dark',
  [USER_ROLES.DRIVER]: 'bg-green-100 text-green-800',
  [USER_ROLES.VOLUNTEER]: 'bg-orange-100 text-orange-800',
  [USER_ROLES.RECIPIENT]: 'bg-yellow-100 text-yellow-800',
  [USER_ROLES.VIEWER]: 'bg-gray-100 text-gray-800',
};

const permissionCategories = {
  'Core Access': [PERMISSIONS.CONTACTS_VIEW],
  'Data Management': [
    PERMISSIONS.COLLECTIONS_EDIT_ALL,
    PERMISSIONS.COLLECTIONS_DELETE_ALL,
    PERMISSIONS.USERS_EDIT,
  ],
  Communication: [
    PERMISSIONS.CHAT_GENERAL,
    PERMISSIONS.CHAT_COMMITTEE,
    PERMISSIONS.CHAT_HOST,
    PERMISSIONS.CHAT_DRIVER,
    PERMISSIONS.CHAT_RECIPIENT,
  ],
  'Data Viewing': [
    PERMISSIONS.COLLECTIONS_VIEW,
    PERMISSIONS.ANALYTICS_VIEW,
    PERMISSIONS.PROJECTS_VIEW,
  ],
  Tools: [PERMISSIONS.TOOLKIT_ACCESS],
};

const permissionIcons = {
  [PERMISSIONS.CONTACTS_VIEW]: Phone,
  [PERMISSIONS.COLLECTIONS_EDIT_ALL]: Edit,
  [PERMISSIONS.COLLECTIONS_DELETE_ALL]: Trash2,
  [PERMISSIONS.USERS_EDIT]: Users,
  [PERMISSIONS.CHAT_GENERAL]: MessageCircle,
  [PERMISSIONS.CHAT_COMMITTEE]: MessageCircle,
  [PERMISSIONS.CHAT_HOST]: MessageCircle,
  [PERMISSIONS.CHAT_DRIVER]: MessageCircle,
  [PERMISSIONS.CHAT_RECIPIENT]: MessageCircle,
  [PERMISSIONS.COLLECTIONS_VIEW]: FileText,
  [PERMISSIONS.ANALYTICS_VIEW]: BarChart3,
  [PERMISSIONS.PROJECTS_VIEW]: FileText,
  [PERMISSIONS.TOOLKIT_ACCESS]: Heart,
};

function RoleView({ user }: { user: any }) {
  const Icon = roleIcons[user.role as keyof typeof roleIcons];
  const colorClass = roleColors[user.role as keyof typeof roleColors];

  return (
    <div className="space-y-6">
      {/* User Info */}
      <Card>
        <CardHeader>
          <div className="flex items-center space-x-3">
            <Icon className="w-8 h-8 text-brand-primary" />
            <div>
              <CardTitle className="text-xl">
                {user.firstName} {user.lastName}
              </CardTitle>
              <CardDescription>{user.email}</CardDescription>
            </div>
            <Badge className={colorClass}>
              {user.role.replace('_', ' ').toUpperCase()}
            </Badge>
          </div>
        </CardHeader>
      </Card>

      {/* Dashboard Access Simulation */}
      <Card>
        <CardHeader>
          <CardTitle>Dashboard Access</CardTitle>
          <CardDescription>
            What this user would see in the main dashboard
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {/* Phone Directory */}
            <div
              className={`p-4 rounded-lg border ${
                hasPermission(user, PERMISSIONS.CONTACTS_VIEW)
                  ? 'bg-green-50 border-green-200'
                  : 'bg-gray-50 border-gray-200 opacity-50'
              }`}
            >
              <Phone className="w-6 h-6 mb-2" />
              <div className="font-medium">Phone Directory</div>
              <div className="text-sm text-gray-600">
                {hasPermission(user, PERMISSIONS.CONTACTS_VIEW)
                  ? 'Full Access'
                  : 'No Access'}
              </div>
            </div>

            {/* Data Editing */}
            <div
              className={`p-4 rounded-lg border ${
                hasPermission(user, PERMISSIONS.COLLECTIONS_EDIT_ALL)
                  ? 'bg-green-50 border-green-200'
                  : 'bg-gray-50 border-gray-200 opacity-50'
              }`}
            >
              <Edit className="w-6 h-6 mb-2" />
              <div className="font-medium">Edit Data</div>
              <div className="text-sm text-gray-600">
                {hasPermission(user, PERMISSIONS.COLLECTIONS_EDIT_ALL)
                  ? 'Can Edit'
                  : 'Read Only'}
              </div>
            </div>

            {/* Reports */}
            <div
              className={`p-4 rounded-lg border ${
                hasPermission(user, PERMISSIONS.ANALYTICS_VIEW)
                  ? 'bg-green-50 border-green-200'
                  : 'bg-gray-50 border-gray-200 opacity-50'
              }`}
            >
              <BarChart3 className="w-6 h-6 mb-2" />
              <div className="font-medium">Reports</div>
              <div className="text-sm text-gray-600">
                {hasPermission(user, PERMISSIONS.ANALYTICS_VIEW)
                  ? 'Can View'
                  : 'No Access'}
              </div>
            </div>

            {/* Collections */}
            <div
              className={`p-4 rounded-lg border ${
                hasPermission(user, PERMISSIONS.COLLECTIONS_VIEW)
                  ? 'bg-green-50 border-green-200'
                  : 'bg-gray-50 border-gray-200 opacity-50'
              }`}
            >
              <FileText className="w-6 h-6 mb-2" />
              <div className="font-medium">Collections</div>
              <div className="text-sm text-gray-600">
                {hasPermission(user, PERMISSIONS.COLLECTIONS_VIEW)
                  ? 'Can View'
                  : 'No Access'}
              </div>
            </div>

            {/* User Management */}
            <div
              className={`p-4 rounded-lg border ${
                hasPermission(user, PERMISSIONS.USERS_EDIT)
                  ? 'bg-green-50 border-green-200'
                  : 'bg-gray-50 border-gray-200 opacity-50'
              }`}
            >
              <Users className="w-6 h-6 mb-2" />
              <div className="font-medium">User Management</div>
              <div className="text-sm text-gray-600">
                {hasPermission(user, PERMISSIONS.USERS_EDIT)
                  ? 'Full Access'
                  : 'No Access'}
              </div>
            </div>

            {/* Toolkit */}
            <div
              className={`p-4 rounded-lg border ${
                hasPermission(user, PERMISSIONS.TOOLKIT_ACCESS)
                  ? 'bg-green-50 border-green-200'
                  : 'bg-gray-50 border-gray-200 opacity-50'
              }`}
            >
              <Heart className="w-6 h-6 mb-2" />
              <div className="font-medium">Volunteer Toolkit</div>
              <div className="text-sm text-gray-600">
                {hasPermission(user, PERMISSIONS.TOOLKIT_ACCESS)
                  ? 'Can Access'
                  : 'No Access'}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Chat Access */}
      <Card>
        <CardHeader>
          <CardTitle>Communication Access</CardTitle>
          <CardDescription>
            Available chat channels for this role
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              {
                perm: PERMISSIONS.CHAT_GENERAL,
                name: 'General Chat',
                desc: 'Open discussion for all members',
              },
              {
                perm: PERMISSIONS.CHAT_COMMITTEE,
                name: 'Committee Chat',
                desc: 'Committee members only',
              },
              {
                perm: PERMISSIONS.CHAT_HOST,
                name: 'Host Chat',
                desc: 'Host coordination channel',
              },
              {
                perm: PERMISSIONS.CHAT_DRIVER,
                name: 'Driver Chat',
                desc: 'Driver coordination channel',
              },
              {
                perm: PERMISSIONS.CHAT_RECIPIENT,
                name: 'Recipient Chat',
                desc: 'Support and updates for recipients',
              },
            ].map((chat) => (
              <div
                key={chat.perm}
                className={`p-3 rounded-lg border ${
                  hasPermission(user, chat.perm)
                    ? 'bg-brand-primary-lighter border-brand-primary-border'
                    : 'bg-gray-50 border-gray-200 opacity-50'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <MessageCircle className="w-4 h-4" />
                  <span className="font-medium">{chat.name}</span>
                  {hasPermission(user, chat.perm) && (
                    <Badge variant="secondary" className="text-xs">
                      Access
                    </Badge>
                  )}
                </div>
                <div className="text-sm text-gray-600 mt-1">{chat.desc}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Detailed Permissions */}
      <Card>
        <CardHeader>
          <CardTitle>Detailed Permissions</CardTitle>
          <CardDescription>
            Complete breakdown of what this role can access
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Object.entries(permissionCategories).map(
              ([category, permissions]) => (
                <div key={category}>
                  <h4 className="font-medium mb-2">{category}</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {permissions.map((permission) => {
                      const hasAccess = hasPermission(user, permission);
                      const PermIcon = permissionIcons[permission];
                      return (
                        <div
                          key={permission}
                          className={`flex items-center space-x-2 p-2 rounded ${
                            hasAccess ? 'bg-green-50' : 'bg-gray-50'
                          }`}
                        >
                          <PermIcon
                            className={`w-4 h-4 ${
                              hasAccess ? 'text-green-600' : 'text-gray-400'
                            }`}
                          />
                          <span
                            className={`text-sm ${
                              hasAccess ? 'text-green-800' : 'text-gray-500'
                            }`}
                          >
                            {permission
                              .replace(/_/g, ' ')
                              .replace(/\b\w/g, (l) => l.toUpperCase())}
                          </span>
                          <Badge
                            variant={hasAccess ? 'default' : 'secondary'}
                            className="text-xs"
                          >
                            {hasAccess ? '✓' : '✗'}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function RoleDemo() {
  // Track page session for activity logging
  usePageSession({
    section: 'Administration',
    page: 'Role Demo',
  });

  const [selectedRole, setSelectedRole] = useState<string>(USER_ROLES.ADMIN);

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Role Access Demonstration
        </h1>
        <p className="text-gray-600">
          View how different user roles experience the application with varying
          permissions and access levels.
        </p>
      </div>

      <Tabs
        value={selectedRole}
        onValueChange={(value) => setSelectedRole(value)}
        className="space-y-6"
      >
        <TabsList className="grid grid-cols-4 lg:grid-cols-7 w-full">
          {Object.values(USER_ROLES).map((role) => {
            const Icon = roleIcons[role];
            return (
              <TabsTrigger
                key={role}
                value={role}
                className="flex items-center space-x-1"
              >
                <Icon className="w-4 h-4" />
                <span className="hidden md:inline">
                  {role.replace('_', ' ')}
                </span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        {Object.values(USER_ROLES).map((role) => (
          <TabsContent key={role} value={role}>
            <RoleView user={sampleUsers[role]} />
          </TabsContent>
        ))}
      </Tabs>

      {/* Role Comparison Summary */}
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Role Comparison Summary</CardTitle>
          <CardDescription>
            Quick overview of what each role can do
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">Role</th>
                  <th className="text-center p-2">Phone Directory</th>
                  <th className="text-center p-2">Edit Data</th>
                  <th className="text-center p-2">Committee Chat</th>
                  <th className="text-center p-2">Host/Driver Chat</th>
                  <th className="text-center p-2">Manage Users</th>
                </tr>
              </thead>
              <tbody>
                {Object.values(USER_ROLES).map((role) => {
                  const user = sampleUsers[role];
                  const Icon = roleIcons[role];
                  return (
                    <tr key={role} className="border-b">
                      <td className="p-2">
                        <div className="flex items-center space-x-2">
                          <Icon className="w-4 h-4" />
                          <span className="font-medium">
                            {role.replace('_', ' ')}
                          </span>
                        </div>
                      </td>
                      <td className="text-center p-2">
                        {hasPermission(user, PERMISSIONS.CONTACTS_VIEW)
                          ? '✅'
                          : '❌'}
                      </td>
                      <td className="text-center p-2">
                        {hasPermission(user, PERMISSIONS.COLLECTIONS_EDIT_ALL)
                          ? '✅'
                          : '❌'}
                      </td>
                      <td className="text-center p-2">
                        {hasPermission(user, PERMISSIONS.CHAT_COMMITTEE)
                          ? '✅'
                          : '❌'}
                      </td>
                      <td className="text-center p-2">
                        {hasPermission(user, PERMISSIONS.CHAT_HOST) ||
                        hasPermission(user, PERMISSIONS.CHAT_DRIVER)
                          ? '✅'
                          : '❌'}
                      </td>
                      <td className="text-center p-2">
                        {hasPermission(user, PERMISSIONS.USERS_EDIT)
                          ? '✅'
                          : '❌'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
