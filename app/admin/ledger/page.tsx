'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  collection,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import {
  Ban,
  CheckCircle2,
  IndianRupee,
  Receipt,
  Search,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/lib/firebase';
import { handleFirestoreError, OperationType } from '@/lib/firestore-errors';
import { formatINR, getDefaultExpiryDate } from '@/lib/formatters';
import type {
  Booking,
  BookingStatus,
  Floor,
  PaymentStatus,
  Seat,
  Student,
  TimeSlot,
} from '@/lib/types';
import { useAdminAuth } from '@/components/admin/admin-auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

export default function LedgerPage() {
  const { user, adminProfile } = useAdminAuth();

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [loading, setLoading] = useState(true);

  const [dateFilter, setDateFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | BookingStatus>('all');
  const [paymentFilter, setPaymentFilter] = useState<'all' | PaymentStatus>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !adminProfile) return;

    const unsubBookings = onSnapshot(
      collection(db, 'bookings'),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as Booking);
        list.sort((a, b) => b.bookingDate.localeCompare(a.bookingDate));
        setBookings(list);
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        handleFirestoreError(err, OperationType.LIST, 'bookings');
      }
    );

    const unsubStudents = onSnapshot(
      collection(db, 'students'),
      (snap) => setStudents(snap.docs.map((d) => d.data() as Student)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'students')
    );

    const unsubSeats = onSnapshot(
      collection(db, 'seats'),
      (snap) => setSeats(snap.docs.map((d) => d.data() as Seat)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'seats')
    );

    const unsubSlots = onSnapshot(
      collection(db, 'time_slots'),
      (snap) => setSlots(snap.docs.map((d) => d.data() as TimeSlot)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'time_slots')
    );

    const unsubFloors = onSnapshot(
      collection(db, 'floors'),
      (snap) => setFloors(snap.docs.map((d) => d.data() as Floor)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'floors')
    );

    return () => {
      unsubBookings();
      unsubStudents();
      unsubSeats();
      unsubSlots();
      unsubFloors();
    };
  }, [user, adminProfile]);

  const studentMap = useMemo(
    () => new Map(students.map((s) => [s.id, s])),
    [students]
  );
  const seatMap = useMemo(() => new Map(seats.map((s) => [s.id, s])), [seats]);
  const slotMap = useMemo(() => new Map(slots.map((s) => [s.id, s])), [slots]);
  const floorMap = useMemo(
    () => new Map(floors.map((f) => [f.id, f])),
    [floors]
  );

  const filteredBookings = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return bookings.filter((bk) => {
      if (dateFilter && bk.bookingDate !== dateFilter) return false;
      if (statusFilter !== 'all' && bk.status !== statusFilter) return false;
      if (paymentFilter !== 'all' && bk.paymentStatus !== paymentFilter)
        return false;

      if (!q) return true;
      const student = studentMap.get(bk.studentId);
      const seat = seatMap.get(bk.seatId);
      return (
        (student?.name.toLowerCase().includes(q) ?? false) ||
        (student?.phone.toLowerCase().includes(q) ?? false) ||
        (seat?.seatCode.toLowerCase().includes(q) ?? false) ||
        bk.id.toLowerCase().includes(q)
      );
    });
  }, [
    bookings,
    dateFilter,
    statusFilter,
    paymentFilter,
    searchQuery,
    studentMap,
    seatMap,
  ]);

  const summary = useMemo(() => {
    let paid = 0;
    let pending = 0;
    let activeCount = 0;
    for (const bk of filteredBookings) {
      if (bk.status === 'cancelled') continue;
      activeCount += 1;
      if (bk.paymentStatus === 'paid') paid += bk.amount || 0;
      else pending += bk.amount || 0;
    }
    return { paid, pending, activeCount };
  }, [filteredBookings]);

  const handleMarkPaid = async (bk: Booking) => {
    setUpdatingId(bk.id);
    try {
      await updateDoc(doc(db, 'bookings', bk.id), {
        paymentStatus: 'paid',
        updatedAt: serverTimestamp(),
      });
      toast.success('Payment marked as Paid');
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `bookings/${bk.id}`);
      } catch {
        toast.error('Could not update payment status');
      }
    } finally {
      setUpdatingId(null);
    }
  };

  const handleCheckIn = async (bk: Booking) => {
    setUpdatingId(bk.id);
    try {
      await updateDoc(doc(db, 'bookings', bk.id), {
        status: 'checked_in',
        updatedAt: serverTimestamp(),
      });
      toast.success('Student checked in');
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `bookings/${bk.id}`);
      } catch {
        toast.error('Could not check in booking');
      }
    } finally {
      setUpdatingId(null);
    }
  };

  const handleConfirmCancel = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    const bookingRef = doc(db, 'bookings', cancelTarget.id);
    const lockId = `${cancelTarget.seatId}_${cancelTarget.slotId}_${cancelTarget.bookingDate}`;
    const lockRef = doc(db, 'booking_locks', lockId);

    try {
      await runTransaction(db, async (tx) => {
        const [bkSnap, lockSnap] = await Promise.all([
          tx.get(bookingRef),
          tx.get(lockRef),
        ]);

        if (!bkSnap.exists()) {
          throw new Error('BOOKING_NOT_FOUND');
        }

        tx.update(bookingRef, {
          status: 'cancelled',
          updatedAt: serverTimestamp(),
        });

        if (lockSnap.exists()) {
          const lockData = lockSnap.data() as { bookingId?: string };
          if (lockData.bookingId === cancelTarget.id) {
            tx.update(lockRef, {
              bookingId: cancelTarget.id,
              status: 'cancelled',
              updatedAt: serverTimestamp(),
            });
          }
        }
      });

      const seatCode = seatMap.get(cancelTarget.seatId)?.seatCode || 'Seat';
      toast.success(`Cancelled booking and freed ${seatCode}`);
      setCancelTarget(null);
    } catch (err) {
      try {
        handleFirestoreError(
          err,
          OperationType.UPDATE,
          `bookings/${cancelTarget.id}`
        );
      } catch {
        toast.error('Could not cancel booking');
      }
    } finally {
      setCancelling(false);
    }
  };

  const today = getDefaultExpiryDate(0);

  return (
    <div className="space-y-6">
      {/* Header & Summary Strip */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 className="font-serif text-2xl font-semibold text-[#2C2A29]">
            Booking Ledger
          </h2>
          <p className="text-sm text-[#6E6762] tabular-nums">
            {summary.activeCount} active reservations · {formatINR(summary.paid)} collected ·{' '}
            {formatINR(summary.pending)} pending
          </p>
        </div>

        <Link href="/admin/book" className="shrink-0">
          <Button className="bg-[#D9775B] hover:bg-[#C46348] text-[#FDFBF7] cursor-pointer whitespace-nowrap">
            New Counter Booking
          </Button>
        </Link>
      </div>

      {/* Filters Toolbar */}
      <div className="bg-[#F4EFEA] border border-[#E4DDD5] rounded-xl p-3 flex flex-col lg:flex-row items-stretch lg:items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="size-4 text-[#6E6762] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search student name, phone, or seat code..."
            className="pl-9 bg-[#FDFBF7] border-[#DDD4CA]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            aria-label="Filter by booking date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="w-[155px] bg-[#FDFBF7] border-[#DDD4CA] tabular-nums"
          />

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setDateFilter(dateFilter === today ? '' : today)}
            className={cn(
              'h-9 border-[#DDD4CA] cursor-pointer whitespace-nowrap',
              dateFilter === today
                ? 'bg-[#D9775B] text-[#FDFBF7] border-[#D9775B] hover:bg-[#C46348] hover:text-[#FDFBF7]'
                : 'bg-[#FDFBF7] text-[#2C2A29] hover:bg-[#EAE2D9]'
            )}
          >
            Today
          </Button>

          <Select
            value={statusFilter}
            onValueChange={(val) => {
              if (
                val === 'all' ||
                val === 'reserved' ||
                val === 'checked_in' ||
                val === 'cancelled'
              ) {
                setStatusFilter(val);
              }
            }}
          >
            <SelectTrigger className="w-[140px] bg-[#FDFBF7] border-[#DDD4CA]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent className="bg-[#FDFBF7] border-[#E4DDD5]">
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="reserved">Reserved</SelectItem>
              <SelectItem value="checked_in">Checked In</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={paymentFilter}
            onValueChange={(val) => {
              if (val === 'all' || val === 'paid' || val === 'pending') {
                setPaymentFilter(val);
              }
            }}
          >
            <SelectTrigger className="w-[130px] bg-[#FDFBF7] border-[#DDD4CA]">
              <SelectValue placeholder="Payment" />
            </SelectTrigger>
            <SelectContent className="bg-[#FDFBF7] border-[#E4DDD5]">
              <SelectItem value="all">All Payments</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
            </SelectContent>
          </Select>

          {(dateFilter ||
            statusFilter !== 'all' ||
            paymentFilter !== 'all' ||
            searchQuery) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setDateFilter('');
                setStatusFilter('all');
                setPaymentFilter('all');
                setSearchQuery('');
              }}
              className="h-9 text-xs text-[#6E6762] hover:text-[#2C2A29] cursor-pointer"
            >
              Reset
            </Button>
          )}
        </div>
      </div>

      {/* Ledger Table */}
      <div className="bg-[#FDFBF7] border border-[#E4DDD5] rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3, 4, 5].map((row) => (
              <div key={row} className="h-11 rounded-md bg-[#F4EFEA] animate-pulse" />
            ))}
          </div>
        ) : bookings.length === 0 ? (
          <div className="p-12 text-center space-y-4">
            <div className="mx-auto size-11 rounded-lg bg-[#F4EFEA] border border-[#E4DDD5] flex items-center justify-center text-[#D9775B]">
              <Receipt className="size-5" />
            </div>
            <div className="space-y-1 max-w-sm mx-auto">
              <h3 className="font-serif text-lg font-semibold text-[#2C2A29]">
                No bookings recorded yet
              </h3>
              <p className="text-sm text-[#6E6762]">
                Confirm a walk-in booking from the Counter Seat Booking screen to see
                transactions here.
              </p>
            </div>
            <Link href="/admin/book">
              <Button className="bg-[#D9775B] hover:bg-[#C46348] text-[#FDFBF7] cursor-pointer">
                Book First Seat
              </Button>
            </Link>
          </div>
        ) : filteredBookings.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <p className="text-sm text-[#6E6762]">
              No bookings match your current filters.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDateFilter('');
                setStatusFilter('all');
                setPaymentFilter('all');
                setSearchQuery('');
              }}
              className="border-[#DDD4CA] bg-[#FDFBF7] text-[#2C2A29] cursor-pointer"
            >
              Clear Filters
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader className="bg-[#F4EFEA]">
              <TableRow className="border-[#E4DDD5] hover:bg-[#F4EFEA]">
                <TableHead className="text-[#6E6762] font-medium px-4 h-11">
                  Date &amp; Shift
                </TableHead>
                <TableHead className="text-[#6E6762] font-medium px-4 h-11">
                  Seat
                </TableHead>
                <TableHead className="text-[#6E6762] font-medium px-4 h-11">
                  Student
                </TableHead>
                <TableHead className="text-[#6E6762] font-medium px-4 h-11 text-right">
                  Amount
                </TableHead>
                <TableHead className="text-[#6E6762] font-medium px-4 h-11">
                  Payment
                </TableHead>
                <TableHead className="text-[#6E6762] font-medium px-4 h-11">
                  Status
                </TableHead>
                <TableHead className="text-[#6E6762] font-medium px-4 h-11 text-right">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredBookings.map((bk) => {
                const student = studentMap.get(bk.studentId);
                const seat = seatMap.get(bk.seatId);
                const slot = slotMap.get(bk.slotId);
                const floor = floorMap.get(bk.floorId);
                const isCancelled = bk.status === 'cancelled';

                return (
                  <TableRow
                    key={bk.id}
                    className={cn(
                      'border-[#E4DDD5] hover:bg-[#F4EFEA]/60',
                      isCancelled && 'opacity-65'
                    )}
                  >
                    <TableCell className="px-4 py-3 text-sm">
                      <p className="font-medium text-[#2C2A29] tabular-nums">
                        {bk.bookingDate}
                      </p>
                      <p className="text-xs text-[#6E6762]">
                        {slot?.name || bk.slotId}
                      </p>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-sm">
                      <p className="font-medium text-[#2C2A29]">
                        {seat?.seatCode || bk.seatId}
                      </p>
                      <p className="text-xs text-[#6E6762]">
                        {floor?.name || 'Floor'}
                      </p>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-sm">
                      <p className="font-medium text-[#2C2A29]">
                        {student?.name || bk.studentId}
                      </p>
                      {student?.phone && (
                        <p className="text-xs text-[#6E6762] tabular-nums">
                          {student.phone}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right font-medium text-[#2C2A29] tabular-nums">
                      {formatINR(bk.amount)}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-sm">
                      {bk.paymentStatus === 'paid' ? (
                        <span className="inline-flex items-center gap-1.5 font-medium text-[#597752]">
                          <CheckCircle2 className="size-3.5 text-[#7D9B76]" />
                          Paid
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 font-medium text-[#D9775B]">
                          <IndianRupee className="size-3.5" />
                          Pending
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-sm">
                      {bk.status === 'cancelled' ? (
                        <span className="inline-flex items-center gap-1.5 font-medium text-[#C25E5E]">
                          <Ban className="size-3.5" />
                          Cancelled
                        </span>
                      ) : bk.status === 'checked_in' ? (
                        <span className="font-medium text-[#597752]">
                          Checked In
                        </span>
                      ) : (
                        <span className="font-medium text-[#2C2A29]">Reserved</span>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right">
                      {!isCancelled && (
                        <div className="inline-flex items-center justify-end gap-1">
                          {bk.paymentStatus === 'pending' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={updatingId === bk.id}
                              onClick={() => void handleMarkPaid(bk)}
                              className="h-8 px-2.5 text-[#597752] hover:bg-[#7D9B76]/15 cursor-pointer whitespace-nowrap"
                            >
                              Mark Paid
                            </Button>
                          )}
                          {bk.status === 'reserved' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={updatingId === bk.id}
                              onClick={() => void handleCheckIn(bk)}
                              className="h-8 px-2.5 text-[#2C2A29] hover:bg-[#EAE2D9] cursor-pointer whitespace-nowrap"
                            >
                              Check In
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setCancelTarget(bk)}
                            className="h-8 px-2.5 text-[#C25E5E] hover:text-[#C25E5E] hover:bg-[#C25E5E]/10 cursor-pointer whitespace-nowrap"
                          >
                            <XCircle className="size-3.5 mr-1" />
                            Cancel Booking
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Cancel Confirmation Dialog */}
      <Dialog
        open={Boolean(cancelTarget)}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
        }}
      >
        <DialogContent className="bg-[#FDFBF7] border-[#E4DDD5] text-[#2C2A29] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-serif text-lg">Cancel Booking</DialogTitle>
            <DialogDescription className="text-[#6E6762]">
              Cancel reservation for{' '}
              <span className="font-medium text-[#2C2A29]">
                {cancelTarget ? studentMap.get(cancelTarget.studentId)?.name || 'this student' : ''}
              </span>{' '}
              on seat{' '}
              <span className="font-medium text-[#2C2A29]">
                {cancelTarget ? seatMap.get(cancelTarget.seatId)?.seatCode || 'selected' : ''}
              </span>
              ? The seat will immediately become available again for this date and shift.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCancelTarget(null)}
              className="border-[#DDD4CA] bg-[#FDFBF7] text-[#2C2A29] cursor-pointer"
            >
              Keep Booking
            </Button>
            <Button
              type="button"
              disabled={cancelling}
              onClick={() => void handleConfirmCancel()}
              className="bg-[#C25E5E] hover:bg-[#A94E4E] text-[#FDFBF7] cursor-pointer"
            >
              {cancelling ? 'Cancelling...' : 'Cancel Booking'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
