'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Armchair,
  BookOpen,
  LayoutDashboard,
  LogOut,
  Map,
  Menu,
  Receipt,
  Tags,
  Users,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAdminAuth } from '@/components/admin/admin-auth-context';
import { AdminLoginCard } from '@/components/admin/admin-login-card';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/book', label: 'Book Seat', icon: Armchair },
  { href: '/admin/students', label: 'Students', icon: Users },
  { href: '/admin/editor', label: 'Layout Editor', icon: Map },
  { href: '/admin/pricing', label: 'Pricing', icon: Tags },
  { href: '/admin/ledger', label: 'Ledger', icon: Receipt },
];

const PAGE_TITLES: Record<string, string> = {
  '/admin/dashboard': 'Dashboard',
  '/admin/book': 'Counter Seat Booking',
  '/admin/students': 'Student Directory',
  '/admin/editor': 'Floor Layout Editor',
  '/admin/pricing': 'Pricing & Time Slots',
  '/admin/ledger': 'Booking Ledger',
};

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, adminProfile, loading, authError, unauthorized, signOut } =
    useAdminAuth();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FDFBF7] flex items-center justify-center p-6">
        <div className="text-center space-y-2">
          <p className="font-serif text-xl text-[#2C2A29]">Folio &amp; Desk</p>
          <p className="text-sm text-[#6E6762]">Verifying librarian session...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AdminLoginCard />;
  }

  if (unauthorized || !adminProfile) {
    return (
      <div className="min-h-screen bg-[#FDFBF7] flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-[#F4EFEA] border border-[#E4DDD5] rounded-xl p-8 space-y-5">
          <div className="space-y-2">
            <h1 className="font-serif text-2xl font-semibold text-[#2C2A29]">
              Access Restricted
            </h1>
            <p className="text-sm text-[#6E6762] leading-relaxed">
              Signed in as <span className="text-[#2C2A29] font-medium">{user.email}</span>,
              which is not registered as an authorized librarian in this system.
            </p>
          </div>
          {authError && (
            <p className="text-xs text-[#C25E5E] bg-[#FDFBF7] border border-[#C25E5E] rounded-md p-3">
              {authError}
            </p>
          )}
          <Button
            variant="outline"
            onClick={() => void signOut()}
            className="w-full border-[#DDD4CA] bg-[#FDFBF7] text-[#2C2A29] hover:bg-[#EAE2D9] cursor-pointer"
          >
            Sign Out and Switch Account
          </Button>
        </div>
      </div>
    );
  }

  const pageTitle = PAGE_TITLES[pathname] || 'Library Administration';
  const roleLabel = adminProfile.role === 'super_admin' ? 'Super Admin' : 'Staff';

  return (
    <div className="min-h-screen bg-[#FDFBF7] text-[#2C2A29] flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 bg-[#F4EFEA] border-r border-[#E4DDD5]">
        <div className="h-16 px-6 flex items-center gap-2.5 border-b border-[#E4DDD5]">
          <BookOpen className="size-5 text-[#D9775B] shrink-0" />
          <Link
            href="/admin/dashboard"
            className="font-serif text-lg font-semibold text-[#2C2A29] whitespace-nowrap"
          >
            Folio &amp; Desk
          </Link>
        </div>

        <nav className="flex-1 px-3 py-5 space-y-1" aria-label="Admin navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors whitespace-nowrap',
                  isActive
                    ? 'bg-[#FDFBF7] text-[#2C2A29] font-medium border border-[#E4DDD5]'
                    : 'text-[#6E6762] hover:text-[#2C2A29] hover:bg-[#EAE2D9]/60'
                )}
              >
                <Icon
                  className={cn('size-4 shrink-0', isActive ? 'text-[#D9775B]' : 'text-[#6E6762]')}
                />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-[#E4DDD5] text-xs text-[#6E6762]">
          <p className="font-medium text-[#2C2A29] truncate">{adminProfile.name}</p>
          <p className="truncate">{roleLabel} · Success Kar Library</p>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-[#2C2A29]/25"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="relative z-10 w-64 bg-[#F4EFEA] border-r border-[#E4DDD5] flex flex-col">
            <div className="h-16 px-5 flex items-center justify-between border-b border-[#E4DDD5]">
              <div className="flex items-center gap-2">
                <BookOpen className="size-5 text-[#D9775B]" />
                <span className="font-serif text-lg font-semibold text-[#2C2A29]">
                  Folio &amp; Desk
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="p-2 rounded-md text-[#6E6762] hover:text-[#2C2A29]"
                aria-label="Close navigation"
              >
                <X className="size-5" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileNavOpen(false)}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors',
                      isActive
                        ? 'bg-[#FDFBF7] text-[#2C2A29] font-medium border border-[#E4DDD5]'
                        : 'text-[#6E6762] hover:text-[#2C2A29] hover:bg-[#EAE2D9]/60'
                    )}
                  >
                    <Icon
                      className={cn(
                        'size-4 shrink-0',
                        isActive ? 'text-[#D9775B]' : 'text-[#6E6762]'
                      )}
                    />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-[#FDFBF7] border-b border-[#E4DDD5] px-4 lg:px-8 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden p-2 rounded-md text-[#2C2A29] hover:bg-[#F4EFEA]"
              aria-label="Open navigation"
            >
              <Menu className="size-5" />
            </button>
            <h1 className="font-serif text-xl font-semibold text-[#2C2A29] truncate">
              {pageTitle}
            </h1>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            <div className="hidden sm:flex items-center gap-2 text-xs text-[#6E6762]">
              <span className="text-[#2C2A29] font-medium">{adminProfile.name}</span>
              <span aria-hidden="true">·</span>
              <span>{roleLabel}</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void signOut()}
              className="border-[#DDD4CA] bg-[#FDFBF7] text-[#2C2A29] hover:bg-[#F4EFEA] whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogOut className="size-3.5 mr-1.5" />
              Sign Out
            </Button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1400px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
