'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, doc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';
import {
  Armchair,
  ArrowRight,
  BellRing,
  CalendarCheck,
  CheckCircle2,
  FileText,
  IndianRupee,
  MessageSquarePlus,
  Percent,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/lib/firebase';
import { handleFirestoreError, OperationType } from '@/lib/firestore-errors';
import { formatINR, formatTime12h, getDefaultExpiryDate } from '@/lib/formatters';
import {
  buildNextMonthRenewalUpdate,
  formatExpiryRemainingLabel,
  formatShortMonthDay,
  getStudentFeeAmount,
  getStudentLastPaymentDate,
  getStudentPhoneForWhatsApp,
  isExpiringOrNextRenewalDue,
} from '@/lib/reminders';
import type { Booking, Seat, Student, TimeSlot } from '@/lib/types';
import { useRemindedToday } from '@/hooks/use-reminded-today';
import { useAdminAuth } from '@/components/admin/admin-auth-context';
import { WhatsAppSendButton } from '@/components/admin/whatsapp-send-button';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function AdminDashboardPage() {
  const { user, adminProfile } = useAdminAuth();

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [renewingId, setRenewingId] = useState<string | null>(null);

  const today = useMemo(() => getDefaultExpiryDate(0), []);
  const { remindedIds, markReminded: handleMarkReminded } = useRemindedToday(today);

  useEffect(() => {
    if (!user || !adminProfile) return;

    let loadedCount = 0;
    const markLoaded = () => {
      loadedCount += 1;
      if (loadedCount >= 4) setLoading(false);
    };

    const unsubBookings = onSnapshot(
      collection(db, 'bookings'),
      (snap) => {
        setBookings(snap.docs.map((d) => d.data() as Booking));
        markLoaded();
      },
      (err) => {
        markLoaded();
        handleFirestoreError(err, OperationType.LIST, 'bookings');
      }
    );

    const unsubSeats = onSnapshot(
      collection(db, 'seats'),
      (snap) => {
        setSeats(snap.docs.map((d) => d.data() as Seat));
        markLoaded();
      },
      (err) => {
        markLoaded();
        handleFirestoreError(err, OperationType.LIST, 'seats');
      }
    );

    const unsubSlots = onSnapshot(
      collection(db, 'time_slots'),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as TimeSlot);
        list.sort((a, b) => a.startTime.localeCompare(b.startTime));
        setSlots(list);
        markLoaded();
      },
      (err) => {
        markLoaded();
        handleFirestoreError(err, OperationType.LIST, 'time_slots');
      }
    );

    const unsubStudents = onSnapshot(
      collection(db, 'students'),
      (snap) => {
        setStudents(snap.docs.map((d) => d.data() as Student));
        markLoaded();
      },
      (err) => {
        markLoaded();
        handleFirestoreError(err, OperationType.LIST, 'students');
      }
    );

    return () => {
      unsubBookings();
      unsubSeats();
      unsubSlots();
      unsubStudents();
    };
  }, [user, adminProfile]);

  const activeDesks = useMemo(
    () => seats.filter((s) => s.shape === 'desk' && s.status === 'active'),
    [seats]
  );

  const todaysActiveBookings = useMemo(
    () =>
      bookings.filter(
        (b) => b.bookingDate === today && b.status !== 'cancelled'
      ),
    [bookings, today]
  );

  const todaysPaidRevenue = useMemo(
    () =>
      todaysActiveBookings
        .filter((b) => b.paymentStatus === 'paid')
        .reduce((sum, b) => sum + (b.amount || 0), 0),
    [todaysActiveBookings]
  );

  const todaysPendingRevenue = useMemo(
    () =>
      todaysActiveBookings
        .filter((b) => b.paymentStatus === 'pending')
        .reduce((sum, b) => sum + (b.amount || 0), 0),
    [todaysActiveBookings]
  );

  const uniqueOccupiedSeatsToday = useMemo(() => {
    const set = new Set<string>();
    for (const b of todaysActiveBookings) {
      set.add(b.seatId);
    }
    return set.size;
  }, [todaysActiveBookings]);

  const occupancyPct = useMemo(() => {
    if (activeDesks.length === 0) return 0;
    return Math.min(
      100,
      Math.round((uniqueOccupiedSeatsToday / activeDesks.length) * 100)
    );
  }, [activeDesks.length, uniqueOccupiedSeatsToday]);

  const activeStudentsCount = useMemo(
    () => students.filter((s) => s.status === 'active').length,
    [students]
  );

  const seatMap = useMemo(() => new Map(seats.map((s) => [s.id, s])), [seats]);
  const studentMap = useMemo(
    () => new Map(students.map((s) => [s.id, s])),
    [students]
  );
  const slotMap = useMemo(() => new Map(slots.map((s) => [s.id, s])), [slots]);

  const shiftStats = useMemo(() => {
    return slots.map((slot) => {
      const slotItems = todaysActiveBookings.filter((b) => b.slotId === slot.id);
      const revenue = slotItems
        .filter((b) => b.paymentStatus === 'paid')
        .reduce((acc, b) => acc + (b.amount || 0), 0);
      return {
        slot,
        count: slotItems.length,
        revenue,
      };
    });
  }, [slots, todaysActiveBookings]);

  const recentBookings = useMemo(() => {
    const list = [...bookings];
    list.sort((a, b) => b.bookingDate.localeCompare(a.bookingDate));
    return list.slice(0, 6);
  }, [bookings]);

  const expiringStudents = useMemo(() => {
    const items: Array<{
      student: Student;
      daysRemaining: number;
      endDate: string;
      lastPaymentDate: string;
      amount: number;
    }> = [];

    for (const student of students) {
      const check = isExpiringOrNextRenewalDue(student, today);
      if (check.eligible && check.daysRemaining !== null) {
        items.push({
          student,
          daysRemaining: check.daysRemaining,
          endDate: check.endDate,
          lastPaymentDate: getStudentLastPaymentDate(student),
          amount: getStudentFeeAmount(student),
        });
      }
    }

    items.sort((a, b) => a.daysRemaining - b.daysRemaining);
    return items;
  }, [students, today]);

  const handleRenewNextMonth = async (student: Student) => {
    setRenewingId(student.id);
    try {
      const updatePayload = buildNextMonthRenewalUpdate(student, today);
      await updateDoc(doc(db, 'students', student.id), {
        ...updatePayload,
        updatedAt: serverTimestamp(),
      });
      toast.success(
        `Renewed ${student.name} through ${formatShortMonthDay(updatePayload.currentPeriodEndDate)}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to renew subscription';
      console.error('Failed to renew student next month:', err);
      toast.error(`Failed to renew: ${msg}`);
    } finally {
      setRenewingId(null);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header Row */}
      <section className="bg-[#F4EFEA] border border-[#E4DDD5] rounded-xl p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs font-medium tracking-wide uppercase text-[#6E6762] tabular-nums">
            Success Kar Library · {today}
          </p>
          <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-[#2C2A29]">
            Counter Overview
          </h2>
          <p className="text-sm text-[#6E6762]">
            Signed in as {adminProfile?.name || 'Librarian'} · Live occupancy and collection summary.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <Link href="/admin/book">
            <Button className="bg-[#D96B4F] hover:bg-[#C4583D] text-white cursor-pointer whitespace-nowrap">
              <Armchair className="size-4 mr-1.5" />
              Book Seat
            </Button>
          </Link>
          <Link href="/admin/enquiries">
            <Button
              variant="outline"
              className="border-[#DDD4CA] bg-[#FDFBF7] text-[#2C2A29] hover:bg-[#EAE2D9] cursor-pointer whitespace-nowrap"
            >
              <MessageSquarePlus className="size-4 mr-1.5 text-[#D96B4F]" />
              Enquiries
            </Button>
          </Link>
          <Link href="/admin/invoices">
            <Button
              variant="outline"
              className="border-[#DDD4CA] bg-[#FDFBF7] text-[#2C2A29] hover:bg-[#EAE2D9] cursor-pointer whitespace-nowrap"
            >
              <FileText className="size-4 mr-1.5 text-[#D96B4F]" />
              Invoices
            </Button>
          </Link>
          <Link href="/admin/ledger">
            <Button
              variant="outline"
              className="border-[#DDD4CA] bg-[#FDFBF7] text-[#2C2A29] hover:bg-[#EAE2D9] cursor-pointer whitespace-nowrap"
            >
              Open Ledger
            </Button>
          </Link>
        </div>
      </section>

      {/* Primary KPI Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-[#FDFBF7] border border-[#E4DDD5] rounded-xl p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-[#6E6762]">
            <span>Today&apos;s Revenue</span>
            <IndianRupee className="size-4 text-[#7D9B76]" />
          </div>
          <p className="font-serif text-3xl font-semibold text-[#2C2A29] tabular-nums">
            {loading ? '—' : formatINR(todaysPaidRevenue)}
          </p>
          <p className="text-xs text-[#6E6762] tabular-nums">
            {formatINR(todaysPendingRevenue)} pending today
          </p>
        </div>

        <div className="bg-[#FDFBF7] border border-[#E4DDD5] rounded-xl p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-[#6E6762]">
            <span>Today&apos;s Bookings</span>
            <CalendarCheck className="size-4 text-[#D9775B]" />
          </div>
          <p className="font-serif text-3xl font-semibold text-[#2C2A29] tabular-nums">
            {loading ? '—' : todaysActiveBookings.length}
          </p>
          <p className="text-xs text-[#6E6762] tabular-nums">
            {bookings.filter((b) => b.status !== 'cancelled').length} active all-time
          </p>
        </div>

        <div className="bg-[#FDFBF7] border border-[#E4DDD5] rounded-xl p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-[#6E6762]">
            <span>Occupancy Today</span>
            <Percent className="size-4 text-[#D9775B]" />
          </div>
          <p className="font-serif text-3xl font-semibold text-[#2C2A29] tabular-nums">
            {loading ? '—' : `${occupancyPct}%`}
          </p>
          <p className="text-xs text-[#6E6762] tabular-nums">
            {uniqueOccupiedSeatsToday} / {activeDesks.length} active desks occupied
          </p>
        </div>

        <div className="bg-[#FDFBF7] border border-[#E4DDD5] rounded-xl p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-[#6E6762]">
            <span>Active Students</span>
            <Users className="size-4 text-[#7D9B76]" />
          </div>
          <p className="font-serif text-3xl font-semibold text-[#2C2A29] tabular-nums">
            {loading ? '—' : activeStudentsCount}
          </p>
          <p className="text-xs text-[#6E6762] tabular-nums">
            {students.length} total registered
          </p>
        </div>
      </section>

      {/* Subscription Ending Soon — Next Month Renewal Due */}
      <section
        aria-label="Subscription Ending Soon — Next Month Renewal Due"
        className={cn(
          'rounded-xl border p-5 space-y-4',
          expiringStudents.length > 0
            ? 'bg-[#F4EFEA] border-[#D9775B]/50'
            : 'bg-[#FDFBF7] border-[#E4DDD5]'
        )}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-start gap-3">
            <div className="size-9 rounded-lg bg-[#FDFBF7] border border-[#E4DDD5] flex items-center justify-center text-[#D9775B] shrink-0 mt-0.5">
              <BellRing className="size-4" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-serif text-lg font-semibold text-[#2C2A29]">
                  Subscription Ending Soon — Next Month Renewal Due
                </h3>
                {!loading && expiringStudents.length > 0 && (
                  <span className="text-xs font-medium px-2 py-0.5 rounded-md bg-[#D9775B]/15 text-[#B45339] tabular-nums">
                    {expiringStudents.length} due
                  </span>
                )}
              </div>
              <p className="text-xs text-[#6E6762]">
                Members whose current monthly cycle ends within 3 days (or is overdue) and next month is not yet renewed.
              </p>
            </div>
          </div>

          <Link
            href="/admin/students"
            className="inline-flex items-center text-xs font-medium text-[#D9775B] hover:underline shrink-0"
          >
            Manage all students
            <ArrowRight className="size-3.5 ml-1" />
          </Link>
        </div>

        {loading ? (
          <div className="h-14 rounded-lg bg-[#FDFBF7]/70 border border-[#E4DDD5] animate-pulse" />
        ) : expiringStudents.length === 0 ? (
          <div className="bg-[#FDFBF7] border border-[#E4DDD5] rounded-lg px-4 py-3 flex items-center gap-2 text-sm text-[#6E6762]">
            <CheckCircle2 className="size-4 text-[#7D9B76] shrink-0" />
            <span>No student billing cycles ending within the next 3 days.</span>
          </div>
        ) : (
          <div className="bg-[#FDFBF7] border border-[#E4DDD5] rounded-lg divide-y divide-[#E4DDD5]">
            {expiringStudents.map(
              ({ student, daysRemaining, endDate, lastPaymentDate, amount }) => {
                const isRemindedToday =
                  student.lastRemindedDate === today || remindedIds.has(student.id);
                const isUrgent = daysRemaining <= 0;
                const shortEndDate = formatShortMonthDay(endDate);
                return (
                  <div
                    key={student.id}
                    className="px-4 py-3 flex flex-col md:flex-row md:items-center justify-between gap-3"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-sm text-[#2C2A29]">
                          {student.name}
                        </p>
                        <span
                          className={cn(
                            'text-xs font-medium px-2 py-0.5 rounded-md',
                            isUrgent
                              ? 'bg-[#C25E5E]/15 text-[#A54545]'
                              : 'bg-[#D9775B]/15 text-[#B45339]'
                          )}
                        >
                          {formatExpiryRemainingLabel(daysRemaining)}
                        </span>
                      </div>
                      <p className="text-xs text-[#6E6762] tabular-nums">
                        Ends {shortEndDate} ({endDate}) · {getStudentPhoneForWhatsApp(student)} ·{' '}
                        {student.membershipType || 'Monthly Plan'}
                        {lastPaymentDate ? ` · Last paid ${formatShortMonthDay(lastPaymentDate)}` : ''}
                      </p>
                    </div>

                    <div className="flex items-center justify-between md:justify-end gap-3 shrink-0 flex-wrap">
                      <div className="text-left md:text-right tabular-nums">
                        <p className="text-sm font-semibold text-[#2C2A29]">
                          {formatINR(amount)}
                        </p>
                        <p className="text-[11px] text-[#D9775B] font-medium">
                          Next Month Fee
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={renewingId === student.id}
                          onClick={() => void handleRenewNextMonth(student)}
                          className="h-8 px-2.5 text-xs border-[#DDD4CA] bg-[#FDFBF7] text-[#2C2A29] hover:bg-[#F4EFEA] cursor-pointer whitespace-nowrap"
                        >
                          {renewingId === student.id ? 'Renewing...' : 'Renew Next Month'}
                        </Button>

                        <WhatsAppSendButton
                          student={student}
                          todayStr={today}
                          remindedToday={isRemindedToday}
                          onReminded={handleMarkReminded}
                        />
                      </div>
                    </div>
                  </div>
                );
              }
            )}
          </div>
        )}
      </section>

      {/* Two-Column Breakdown */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Today by Shift */}
        <div className="bg-[#FDFBF7] border border-[#E4DDD5] rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-serif text-lg font-semibold text-[#2C2A29]">
              Today by Shift
            </h3>
            <Link
              href="/admin/pricing"
              className="text-xs font-medium text-[#D9775B] hover:underline"
            >
              Manage shifts
            </Link>
          </div>

          {shiftStats.length === 0 ? (
            <p className="text-sm text-[#6E6762] py-6 text-center">
              No time slots configured yet.
            </p>
          ) : (
            <div className="divide-y divide-[#E4DDD5]">
              {shiftStats.map(({ slot, count, revenue }) => (
                <div
                  key={slot.id}
                  className="py-3 flex items-center justify-between gap-4 text-sm"
                >
                  <div>
                    <p className="font-medium text-[#2C2A29]">{slot.name}</p>
                    <p className="text-xs text-[#6E6762] tabular-nums">
                      {formatTime12h(slot.startTime)} – {formatTime12h(slot.endTime)}
                    </p>
                  </div>
                  <div className="text-right tabular-nums">
                    <p className="font-medium text-[#2C2A29]">
                      {count} {count === 1 ? 'seat' : 'seats'}
                    </p>
                    <p className="text-xs text-[#597752]">{formatINR(revenue)} paid</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Bookings */}
        <div className="bg-[#FDFBF7] border border-[#E4DDD5] rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-serif text-lg font-semibold text-[#2C2A29]">
              Recent Bookings
            </h3>
            <Link
              href="/admin/ledger"
              className="inline-flex items-center text-xs font-medium text-[#D9775B] hover:underline"
            >
              View full ledger
              <ArrowRight className="size-3.5 ml-1" />
            </Link>
          </div>

          {recentBookings.length === 0 ? (
            <div className="py-8 text-center space-y-2">
              <p className="text-sm text-[#6E6762]">No bookings recorded yet.</p>
              <Link
                href="/admin/book"
                className="inline-block text-xs font-medium text-[#D9775B] hover:underline"
              >
                Create first counter booking →
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-[#E4DDD5]">
              {recentBookings.map((bk) => {
                const seat = seatMap.get(bk.seatId);
                const student = studentMap.get(bk.studentId);
                const slot = slotMap.get(bk.slotId);
                return (
                  <div
                    key={bk.id}
                    className="py-3 flex items-center justify-between gap-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-[#2C2A29] truncate">
                        Seat {seat?.seatCode || '—'} ·{' '}
                        {student?.name || 'Student'}
                      </p>
                      <p className="text-xs text-[#6E6762] tabular-nums truncate">
                        {bk.bookingDate} · {slot?.name || 'Shift'}
                      </p>
                    </div>
                    <div className="text-right shrink-0 tabular-nums">
                      <p className="font-medium text-[#2C2A29]">
                        {formatINR(bk.amount)}
                      </p>
                      <p
                        className={cn(
                          'text-xs capitalize',
                          bk.status === 'cancelled'
                            ? 'text-[#C25E5E]'
                            : bk.paymentStatus === 'paid'
                              ? 'text-[#597752]'
                              : 'text-[#D9775B]'
                        )}
                      >
                        {bk.status === 'cancelled'
                          ? 'Cancelled'
                          : bk.paymentStatus}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
