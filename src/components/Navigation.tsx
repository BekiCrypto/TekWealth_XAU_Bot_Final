import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { 
  BarChart3, 
  Bot, 
  Settings as SettingsIcon,
  TrendingUp, 
  Shield,
  LogOut,
  Crown,
  UserCircle
} from 'lucide-react';
import { NotificationBell } from './NotificationBell';

type UserRole = 'admin' | 'subscriber' | null;

interface NavigationProps {
  userRole: UserRole;
  onLogout: () => void;
  userName?: string;
}

interface MenuItem {
  to: string;
  label: string;
  icon: React.ElementType;
}

export function Navigation({ userRole, onLogout, userName }: NavigationProps) {
  const navigate = useNavigate();

  const handleLogoutClick = () => {
    onLogout();
    navigate('/');
  };

  const adminItems: MenuItem[] = [
    { to: '/admin', label: 'Admin Panel', icon: Crown },
    { to: '/analytics', label: 'System Analytics', icon: BarChart3 },
    { to: '/settings', label: 'Global Settings', icon: SettingsIcon },
  ];

  const userItems: MenuItem[] = [
    { to: '/dashboard', label: 'Dashboard', icon: TrendingUp },
    { to: '/bot', label: 'Trading Bot', icon: Bot },
    { to: '/backtesting', label: 'Backtesting', icon: BarChart3 },
    { to: '/settings', label: 'Account Settings', icon: SettingsIcon },
  ];

  const menuItems = userRole === 'admin' ? adminItems : userItems;

  const navLinkClasses = ({ isActive }: { isActive: boolean }) =>
    `w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
      isActive
        ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 shadow-md'
        : 'text-gray-300 hover:bg-gray-800 hover:text-white'
    }`;

  return (
    <nav className="fixed left-0 top-0 h-screen w-64 bg-gray-900 border-r border-gray-800 flex flex-col">
      {/* Header Section */}
      <div className="p-6">
        <div className="flex items-center gap-3 mb-2">
          <NavLink to={userRole === 'admin' ? '/admin' : '/dashboard'} className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-lg flex items-center justify-center">
              <Shield className="w-6 h-6 text-gray-900" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">GoldBot Pro</h1>
              <p className="text-xs text-gray-400 capitalize">{userRole ? `${userRole} Panel` : 'Panel'}</p>
            </div>
          </NavLink>
        </div>
        <div className="mt-4 flex justify-between items-center">
            {userName && (
                 <div className="flex items-center gap-2 text-sm text-gray-300">
                    <UserCircle size={20} />
                    <span>{userName.split(' ')[0]}</span>
                 </div>
            )}
            <div className={!userName ? "ml-auto" : ""}>
                <NotificationBell />
            </div>
        </div>
      </div>

      {/* Navigation Links */}
      <div className="flex-grow p-6 space-y-2 overflow-y-auto">
        {menuItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={navLinkClasses}
            >
              <Icon className="w-5 h-5" />
              <span className="font-medium">{item.label}</span>
            </NavLink>
          );
        })}
      </div>

      {/* Footer Section (Logout) */}
      <div className="p-6 border-t border-gray-800">
        <button
          onClick={handleLogoutClick}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-gray-300 hover:bg-red-600/20 hover:text-red-400 transition-all"
        >
          <LogOut className="w-5 h-5" />
          <span className="font-medium">Logout</span>
        </button>
      </div>
    </nav>
  );
}