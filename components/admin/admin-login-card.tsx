'use client';

import React, { useState } from 'react';
import { BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useAdminAuth } from '@/components/admin/admin-auth-context';

export function AdminLoginCard() {
  const { authError, signInWithEmail } = useAdminAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (!email.trim()) {
      setLocalError('Please enter your admin email address.');
      return;
    }
    if (!password) {
      setLocalError('Please enter your password.');
      return;
    }

    setSubmitting(true);
    try {
      await signInWithEmail(email, password);
    } finally {
      setSubmitting(false);
    }
  };

  const displayError = localError || authError;

  return (
    <div className="min-h-screen bg-[#FDFBF7] flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-[#F4EFEA] border border-[#E4DDD5] rounded-xl p-8 space-y-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2.5 text-[#D9775B]">
            <BookOpen className="size-5 shrink-0" />
            <span className="text-xs font-medium tracking-wide uppercase text-[#6E6762]">
              Internal Staff Console
            </span>
          </div>
          <h1 className="font-serif text-3xl font-semibold text-[#2C2A29] tracking-tight">
            Success Kar Library
          </h1>
          <p className="text-sm text-[#6E6762] leading-relaxed">
            Sign in with your librarian email and password to manage floor plans,
            students, and counter seat reservations.
          </p>
        </div>

        {displayError && (
          <div
            role="alert"
            className="bg-[#FDFBF7] border border-[#C25E5E] rounded-lg p-3 text-sm text-[#C25E5E]"
          >
            {displayError}
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="admin-email" className="text-[#2C2A29]">
              Email
            </Label>
            <Input
              id="admin-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="librarian@example.com"
              required
              className="h-10 bg-[#FDFBF7] border-[#DDD4CA] text-[#2C2A29]"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="admin-password" className="text-[#2C2A29]">
              Password
            </Label>
            <Input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="h-10 bg-[#FDFBF7] border-[#DDD4CA] text-[#2C2A29]"
            />
          </div>

          <Button
            type="submit"
            disabled={submitting}
            className="w-full h-11 bg-[#D9775B] hover:bg-[#C46348] text-[#FDFBF7] font-medium cursor-pointer"
          >
            {submitting ? 'Signing In...' : 'Sign In'}
          </Button>
        </form>

        <Separator className="bg-[#E4DDD5]" />

        <p className="text-xs text-[#6E6762] leading-relaxed">
          Admin-only access. Student self-service login is disabled.
        </p>
      </div>
    </div>
  );
}
