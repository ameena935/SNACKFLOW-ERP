import React from "react";
import { AuthUser } from "../lib/auth";

interface LayoutProps {
  user: AuthUser;
  onLogout: () => void;
  title: string;
  rightSlot?: React.ReactNode;
  children: React.ReactNode;
}

export function Layout({ user, onLogout, title, rightSlot, children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-xl font-bold text-brand-700">CrispLedger</span>
            <span className="hidden sm:inline-block text-gray-300">|</span>
            <span className="hidden sm:inline-block text-sm font-medium text-gray-700">{title}</span>
          </div>

          <div className="flex items-center gap-3">
            {rightSlot}
            <div className="text-right hidden sm:block">
              <div className="text-sm font-medium text-gray-900">{user.name}</div>
              <div className="text-xs text-gray-500">{user.email}</div>
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-brand-100 text-brand-800">
              {user.role}
            </span>
            <button onClick={onLogout} className="btn-secondary text-xs px-3 py-1.5">
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </main>
    </div>
  );
}
