'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { getTodayDateString, saveRemindedTodayId } from '@/lib/reminders';

const REMINDED_STORAGE_PREFIX = 'sk_whatsapp_reminded_';
const CUSTOM_EVENT = 'sk-reminded-updated';
const EMPTY_JSON = '[]';

export function useRemindedToday(todayStr: string = getTodayDateString()) {
  const subscribe = useCallback((callback: () => void) => {
    if (typeof window === 'undefined') return () => {};
    const onChange = () => callback();
    window.addEventListener('storage', onChange);
    window.addEventListener(CUSTOM_EVENT, onChange);
    return () => {
      window.removeEventListener('storage', onChange);
      window.removeEventListener(CUSTOM_EVENT, onChange);
    };
  }, []);

  const getSnapshot = useCallback(() => {
    if (typeof window === 'undefined') return EMPTY_JSON;
    try {
      return window.localStorage.getItem(`${REMINDED_STORAGE_PREFIX}${todayStr}`) || EMPTY_JSON;
    } catch {
      return EMPTY_JSON;
    }
  }, [todayStr]);

  const rawJson = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_JSON);

  const remindedIds = useMemo(() => {
    try {
      const parsed = JSON.parse(rawJson);
      return Array.isArray(parsed)
        ? new Set(parsed.filter((v): v is string => typeof v === 'string'))
        : new Set<string>();
    } catch {
      return new Set<string>();
    }
  }, [rawJson]);

  const markReminded = useCallback(
    (studentId: string) => {
      saveRemindedTodayId(studentId, todayStr);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(CUSTOM_EVENT));
      }
      void updateDoc(doc(db, 'students', studentId), {
        lastRemindedDate: todayStr,
        updatedAt: serverTimestamp(),
      }).catch(() => {
        // Local tracking already persisted
      });
    },
    [todayStr]
  );

  return { remindedIds, markReminded };
}
