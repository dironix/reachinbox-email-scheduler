import React from 'react';
import { LogOut, Activity, Hash, CheckCircle2, Mail } from 'lucide-react';
import type { UserProfile } from '../types';

interface HeaderProps {
  user: UserProfile;
  onLogout: () => void;
  onConnectSlack: () => void;
  onDisconnectSlack: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  user,
  onLogout,
  onConnectSlack,
  onDisconnectSlack,
}) => {
  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand Logo */}
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-sm">
            <Mail className="w-5 h-5" />
          </div>
          <div>
            <span className="font-bold text-lg tracking-tight text-slate-900">ReachInbox</span>
            <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
              Scheduler
            </span>
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-3">
          {/* Live BullMQ Dashboard Link */}
          <a
            href="http://localhost:5000/admin/queues"
            target="_blank"
            rel="noreferrer"
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
          >
            <Activity className="w-3.5 h-3.5 text-blue-600" />
            Queue Monitor
          </a>

          {/* Slack OAuth Button */}
          {user.slackConnected ? (
            <button
              onClick={onDisconnectSlack}
              title="Click to disconnect Slack"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition cursor-pointer"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Slack Connected {user.slackChannel ? `(${user.slackChannel})` : ''}
            </button>
          ) : (
            <button
              onClick={onConnectSlack}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg shadow-2xs transition cursor-pointer"
            >
              <Hash className="w-3.5 h-3.5 text-purple-600" />
              Connect Slack
            </button>
          )}

          <div className="h-6 w-px bg-slate-200 mx-1" />

          {/* User Profile */}
          <div className="flex items-center gap-2.5">
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.name}
                className="w-8 h-8 rounded-full border border-slate-200 object-cover"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 font-semibold flex items-center justify-center text-sm">
                {user.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="hidden md:block text-left leading-tight">
              <p className="text-sm font-medium text-slate-900">{user.name}</p>
              <p className="text-xs text-slate-500">{user.email}</p>
            </div>
          </div>

          <button
            onClick={onLogout}
            title="Logout"
            className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};