'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAdminAuth } from '@/components/admin/admin-auth-context';
import { AdminLoginCard } from '@/components/admin/admin-login-card';

export default function AdminLoginPage() {
  const router = useRouter();
  const { user, adminProfile, loading } = useAdminAuth();

  useEffect(() => {
    if (!loading && user && adminProfile) {
      router.replace('/admin/dashboard');
    }
  }, [loading, user, adminProfile, router]);

  return <AdminLoginCard />;
}
