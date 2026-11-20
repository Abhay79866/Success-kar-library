'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { auth, testConnection } from '@/lib/firebase';
import type { AdminProfile } from '@/lib/types';

interface AdminAuthContextValue {
  user: User | null;
  adminProfile: AdminProfile | null;
  loading: boolean;
  authError: string | null;
  unauthorized: boolean;
  signInWithEmail: (email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
}

const AdminAuthContext = createContext<AdminAuthContextValue | undefined>(undefined);

function formatAuthError(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = String((err as { code?: string }).code);
    switch (code) {
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
        return 'Invalid email or password. Please check your credentials and try again.';
      case 'auth/invalid-email':
        return 'Please enter a valid email address.';
      case 'auth/user-disabled':
        return 'This account has been disabled in Firebase Authentication.';
      case 'auth/too-many-requests':
        return 'Too many failed sign-in attempts. Please wait a moment and try again.';
      case 'auth/operation-not-allowed':
        return 'Email/Password sign-in is not enabled in Firebase Authentication yet.';
      case 'auth/network-request-failed':
        return 'Network error while contacting Firebase Authentication.';
      default:
        break;
    }
  }
  return err instanceof Error ? err.message : 'Sign-in failed. Please try again.';
}

export function AdminAuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [adminProfile, setAdminProfile] = useState<AdminProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);

  useEffect(() => {
    void testConnection();

    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setAuthError(null);
      setUnauthorized(false);

      if (!firebaseUser) {
        setUser(null);
        setAdminProfile(null);
        setLoading(false);
        return;
      }

      const derivedProfile: AdminProfile = {
        id: firebaseUser.uid,
        email: firebaseUser.email || 'librarian@library.local',
        name:
          firebaseUser.displayName ||
          (firebaseUser.email ? firebaseUser.email.split('@')[0] : 'Librarian'),
        role: 'super_admin',
        createdAt: null,
        updatedAt: null,
      };

      setUser(firebaseUser);
      setAdminProfile(derivedProfile);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const signInWithEmail = async (email: string, password: string): Promise<boolean> => {
    setAuthError(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      return true;
    } catch (err) {
      setAuthError(formatAuthError(err));
      return false;
    }
  };

  const signOut = async () => {
    setAuthError(null);
    await firebaseSignOut(auth);
  };

  return (
    <AdminAuthContext.Provider
      value={{
        user,
        adminProfile,
        loading,
        authError,
        unauthorized,
        signInWithEmail,
        signOut,
      }}
    >
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) {
    throw new Error('useAdminAuth must be used inside AdminAuthProvider');
  }
  return ctx;
}
