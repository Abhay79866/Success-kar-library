'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  collection,
  doc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  Armchair,
  CheckCircle2,
  ChevronDown,
  Search,
  UserCheck,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/lib/firebase';
import { handleFirestoreError, OperationType } from '@/lib/firestore-errors';
import {
  formatINR,
  formatTime12h,
  generateDocId,
  getDefaultExpiryDate,
} from '@/lib/formatters';
import {
  doSlotsOverlap,
  getBookedSeatColorByGender,
  getShortShiftLabel,
} from '@/lib/shifts';
import type {
  Booking,
  Category,
  Floor,
  Seat,
  Student,
  TimeSlot,
} from '@/lib/types';
import type { BookedSeatDisplayInfo } from '@/components/booking/booking-floor-map';
import { useAdminAuth } from '@/components/admin/admin-auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
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
import { cn } from '@/lib/utils';

const BookingFloorMap = dynamic(
  () => import('@/components/booking/booking-floor-map'),
  {
    ssr: false,
    loading: () => (
      <div className="h-[480px] bg-[#F4EFEA] border border-[#E4DDD5] rounded-xl flex items-center justify-center text-sm text-[#6E6762]">
        Loading floor map...
      </div>
    ),
  }
);

interface CreatedBookingSummary {
  id: string;
  seatCode: string;
  studentName: string;
  slotLabel: string;
  bookingDate: string;
  amount: number;
  paymentStatus: 'paid' | 'pending';
}

export default function BookSeatPage() {
  const { user, adminProfile } = useAdminAuth();

  // Step 1: Date & Time Slot
  const [bookingDate, setBookingDate] = useState<string>(() =>
    getDefaultExpiryDate(0)
  );
  const [selectedSlotId, setSelectedSlotId] = useState<string>('');
  const [selectedFloorId, setSelectedFloorId] = useState<string>('');

  // Step 2: Searchable Student Dropdown
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [studentQuery, setStudentQuery] = useState<string>('');
  const [studentDropdownOpen, setStudentDropdownOpen] = useState<boolean>(false);
  const studentPickerRef = useRef<HTMLDivElement | null>(null);

  // Firestore Live Data
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [dateBookings, setDateBookings] = useState<Booking[]>([]);
  const [loadingMap, setLoadingMap] = useState<boolean>(true);

  // Step 4: Selected Seat Side Panel
  const [selectedSeat, setSelectedSeat] = useState<Seat | null>(null);
  const [customAmount, setCustomAmount] = useState<string>('');
  const [confirming, setConfirming] = useState<boolean>(false);

  // Step 6: Success Modal + Mark as Paid
  const [successModalOpen, setSuccessModalOpen] = useState<boolean>(false);
  const [createdSummary, setCreatedSummary] =
    useState<CreatedBookingSummary | null>(null);
  const [markingPaid, setMarkingPaid] = useState<boolean>(false);

  // Close student dropdown on outside click
  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (
        studentPickerRef.current &&
        !studentPickerRef.current.contains(e.target as Node)
      ) {
        setStudentDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  // Load slots, students, floors, categories
  useEffect(() => {
    if (!user || !adminProfile) return;

    const unsubSlots = onSnapshot(
      collection(db, 'time_slots'),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as TimeSlot);
        list.sort((a, b) => a.startTime.localeCompare(b.startTime));
        setSlots(list);
        setSelectedSlotId((prev) =>
          prev && list.some((s) => s.id === prev) ? prev : list[0]?.id || ''
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'time_slots')
    );

    const unsubStudents = onSnapshot(
      collection(db, 'students'),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as Student);
        list.sort((a, b) => a.name.localeCompare(b.name));
        setStudents(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'students')
    );

    const unsubFloors = onSnapshot(
      collection(db, 'floors'),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as Floor);
        list.sort((a, b) => a.name.localeCompare(b.name));
        setFloors(list);
        setSelectedFloorId((prev) =>
          prev && list.some((f) => f.id === prev) ? prev : list[0]?.id || ''
        );
        if (list.length === 0) setLoadingMap(false);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'floors')
    );

    const unsubCats = onSnapshot(
      collection(db, 'categories'),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as Category);
        setCategories(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'categories')
    );

    return () => {
      unsubSlots();
      unsubStudents();
      unsubFloors();
      unsubCats();
    };
  }, [user, adminProfile]);

  // Load seats for active floor
  useEffect(() => {
    if (!user || !adminProfile || !selectedFloorId) return;

    const q = query(
      collection(db, 'seats'),
      where('floorId', '==', selectedFloorId)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setSeats(snap.docs.map((d) => d.data() as Seat));
        setLoadingMap(false);
      },
      (err) => {
        setLoadingMap(false);
        handleFirestoreError(err, OperationType.LIST, `seats?floorId=${selectedFloorId}`);
      }
    );
    return () => unsub();
  }, [user, adminProfile, selectedFloorId]);

  // Load all active bookings for selected date (so Full Day / Morning / Evening overlaps resolve instantly)
  useEffect(() => {
    if (!user || !adminProfile || !bookingDate) return;

    const q = query(
      collection(db, 'bookings'),
      where('bookingDate', '==', bookingDate)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const allForDate = snap.docs.map((d) => d.data() as Booking);
        setDateBookings(allForDate.filter((b) => b.status !== 'cancelled'));
      },
      (err) =>
        handleFirestoreError(err, OperationType.LIST, `bookings?bookingDate=${bookingDate}`)
    );

    return () => unsub();
  }, [user, adminProfile, bookingDate]);

  const activeFloor = useMemo(
    () => floors.find((f) => f.id === selectedFloorId) || null,
    [floors, selectedFloorId]
  );

  const selectedSlot = useMemo(
    () => slots.find((s) => s.id === selectedSlotId) || null,
    [slots, selectedSlotId]
  );

  const selectedStudent = useMemo(
    () => students.find((s) => s.id === selectedStudentId) || null,
    [students, selectedStudentId]
  );

  const filteredStudents = useMemo(() => {
    const q = studentQuery.trim().toLowerCase();
    return students.filter((s) => {
      if (!q) return true;
      const phone = (s.whatsappNumber || s.phone || '').toLowerCase();
      const plan = (s.membershipType || '').toLowerCase();
      return (
        s.name.toLowerCase().includes(q) ||
        phone.includes(q) ||
        plan.includes(q)
      );
    });
  }, [students, studentQuery]);

  const categoryMap = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories]
  );

  const studentMap = useMemo(
    () => new Map(students.map((s) => [s.id, s])),
    [students]
  );

  const slotMap = useMemo(
    () => new Map(slots.map((s) => [s.id, s])),
    [slots]
  );

  const overlappingSeatBookingsMap = useMemo(() => {
    const map = new Map<string, Booking[]>();
    if (!selectedSlot) return map;

    for (const bk of dateBookings) {
      const bkSlot = slotMap.get(bk.slotId);
      const overlaps = bkSlot
        ? doSlotsOverlap(bkSlot, selectedSlot)
        : bk.slotId === selectedSlot.id;
      if (!overlaps) continue;

      const list = map.get(bk.seatId) || [];
      list.push(bk);
      map.set(bk.seatId, list);
    }

    for (const [, list] of map) {
      list.sort((a, b) => {
        const startA = slotMap.get(a.slotId)?.startTime || '';
        const startB = slotMap.get(b.slotId)?.startTime || '';
        return startA.localeCompare(startB);
      });
    }

    return map;
  }, [dateBookings, selectedSlot, slotMap]);

  const bookedSeatInfoMap = useMemo(() => {
    const map = new Map<string, BookedSeatDisplayInfo>();
    for (const [seatId, seatBookings] of overlappingSeatBookingsMap) {
      const primary = seatBookings[0];
      const student = studentMap.get(primary.studentId);
      const baseName = student?.name || 'Booked';
      const studentName =
        seatBookings.length > 1 ? `${baseName} +${seatBookings.length - 1}` : baseName;
      const shiftLabel = seatBookings
        .map((b) => getShortShiftLabel(slotMap.get(b.slotId)?.name || 'Shift'))
        .join(' & ');

      map.set(seatId, {
        fillColor: getBookedSeatColorByGender(student?.gender),
        studentName,
        shiftLabel,
      });
    }
    return map;
  }, [overlappingSeatBookingsMap, studentMap, slotMap]);

  const bookedSeatIds = useMemo(
    () => new Set(overlappingSeatBookingsMap.keys()),
    [overlappingSeatBookingsMap]
  );

  const activeSelectedSeat = useMemo(() => {
    if (!selectedSeat) return null;
    if (selectedSeat.status !== 'active') return null;
    if (bookedSeatIds.has(selectedSeat.id)) return null;
    return selectedSeat;
  }, [selectedSeat, bookedSeatIds]);

  const getDefaultFee = (seat: Seat | null) => {
    if (!seat) return 0;
    if (selectedSlot?.price !== undefined && selectedSlot.price > 0) {
      return selectedSlot.price;
    }
    const cat = seat.categoryId ? categoryMap.get(seat.categoryId) : undefined;
    return cat?.price ?? 0;
  };

  const handleSelectSeat = (seat: Seat) => {
    if (seat.status === 'maintenance') {
      toast.error(`Seat ${seat.seatCode} is under maintenance and cannot be selected.`);
      setSelectedSeat(null);
      return;
    }
    const info = bookedSeatInfoMap.get(seat.id);
    if (info) {
      toast.error(
        `Seat ${seat.seatCode} is unavailable — booked by ${info.studentName} (${info.shiftLabel}).`
      );
      setSelectedSeat(null);
      return;
    }
    setSelectedSeat(seat);
    const fee = getDefaultFee(seat);
    setCustomAmount(String(fee));
  };

  const handleConfirmBooking = async () => {
    if (!user) return;
    if (!bookingDate || !selectedSlotId || !selectedFloorId || !selectedSlot) {
      toast.error('Select a booking date and shift first.');
      return;
    }
    if (!selectedStudent) {
      toast.error('Please select a student from the dropdown.');
      return;
    }
    if (selectedStudent.status === 'blocked') {
      toast.error('Cannot book a seat for a blocked student.');
      return;
    }
    if (!activeSelectedSeat || activeSelectedSeat.shape !== 'desk') {
      toast.error('Please click an available desk on the floor map.');
      return;
    }

    // Client-side overlap check across all active bookings on this seat & date
    const conflictingForSeat = dateBookings.filter((bk) => {
      if (bk.seatId !== activeSelectedSeat.id) return false;
      const bkSlot = slotMap.get(bk.slotId);
      return bkSlot ? doSlotsOverlap(bkSlot, selectedSlot) : bk.slotId === selectedSlot.id;
    });

    if (conflictingForSeat.length > 0) {
      const conflictShiftNames = conflictingForSeat
        .map((bk) => slotMap.get(bk.slotId)?.name || 'another shift')
        .join(', ');
      toast.error(
        `Seat ${activeSelectedSeat.seatCode} is already booked for ${conflictShiftNames} on ${bookingDate}.`
      );
      setSelectedSeat(null);
      return;
    }

    const parsedAmount = Number(customAmount);
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0 || parsedAmount > 100000) {
      toast.error('Enter a valid fee between 0 and 100,000.');
      return;
    }

    setConfirming(true);
    const bookingId = generateDocId('bk');
    const lockId = `${activeSelectedSeat.id}_${selectedSlotId}_${bookingDate}`;
    const overlappingSlots = slots.filter((s) => doSlotsOverlap(s, selectedSlot));
    const slotsToCheck =
      overlappingSlots.length > 0 ? overlappingSlots : [selectedSlot];

    try {
      await runTransaction(db, async (tx) => {
        const seatRef = doc(db, 'seats', activeSelectedSeat.id);
        const lockRefs = slotsToCheck.map((s) => ({
          slot: s,
          ref: doc(db, 'booking_locks', `${activeSelectedSeat.id}_${s.id}_${bookingDate}`),
        }));

        const [seatSnap, ...lockSnaps] = await Promise.all([
          tx.get(seatRef),
          ...lockRefs.map((entry) => tx.get(entry.ref)),
        ]);

        if (!seatSnap.exists()) {
          throw new Error('SEAT_NOT_FOUND');
        }
        const liveSeat = seatSnap.data() as Seat;
        if (liveSeat.status !== 'active') {
          throw new Error('SEAT_IN_MAINTENANCE');
        }

        for (let i = 0; i < lockSnaps.length; i += 1) {
          const snap = lockSnaps[i];
          if (snap.exists()) {
            const lockData = snap.data() as { status?: string };
            if (lockData.status !== 'cancelled') {
              throw new Error(`SEAT_CONFLICT:${lockRefs[i].slot.name}`);
            }
          }
        }

        const bookingRef = doc(db, 'bookings', bookingId);
        const targetLockRef = doc(db, 'booking_locks', lockId);
        tx.set(bookingRef, {
          id: bookingId,
          studentId: selectedStudent.id,
          seatId: activeSelectedSeat.id,
          floorId: selectedFloorId,
          slotId: selectedSlotId,
          bookingDate,
          amount: parsedAmount,
          paymentStatus: 'pending',
          status: 'reserved',
          bookedBy: user.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        tx.set(targetLockRef, {
          id: lockId,
          bookingId,
          seatId: activeSelectedSeat.id,
          floorId: selectedFloorId,
          slotId: selectedSlotId,
          bookingDate,
          status: 'active',
          updatedAt: serverTimestamp(),
        });
      });

      const slotLabel = `${selectedSlot.name} (${formatTime12h(selectedSlot.startTime)} – ${formatTime12h(selectedSlot.endTime)})`;

      setCreatedSummary({
        id: bookingId,
        seatCode: activeSelectedSeat.seatCode,
        studentName: selectedStudent.name,
        slotLabel,
        bookingDate,
        amount: parsedAmount,
        paymentStatus: 'pending',
      });
      setSuccessModalOpen(true);
      setSelectedSeat(null);
    } catch (err) {
      if (err instanceof Error) {
        if (err.message.startsWith('SEAT_CONFLICT:')) {
          const conflictName = err.message.slice('SEAT_CONFLICT:'.length);
          toast.error(
            `Seat ${activeSelectedSeat.seatCode} is already booked for ${conflictName} on ${bookingDate}.`
          );
          setSelectedSeat(null);
          return;
        }
        if (err.message === 'SEAT_IN_MAINTENANCE') {
          toast.error('This seat was moved to maintenance.');
          return;
        }
        if (err.message === 'SEAT_NOT_FOUND') {
          toast.error('Seat record no longer exists.');
          return;
        }
      }
      try {
        handleFirestoreError(err, OperationType.WRITE, `bookings/${bookingId}`);
      } catch {
        toast.error('Could not complete booking transaction.');
      }
    } finally {
      setConfirming(false);
    }
  };

  const handleMarkAsPaid = async (bookingId: string, fromModal = false) => {
    setMarkingPaid(true);
    try {
      await updateDoc(doc(db, 'bookings', bookingId), {
        paymentStatus: 'paid',
        updatedAt: serverTimestamp(),
      });
      if (fromModal && createdSummary && createdSummary.id === bookingId) {
        setCreatedSummary({ ...createdSummary, paymentStatus: 'paid' });
      }
      toast.success('Payment marked as Paid (Cash / UPI)');
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `bookings/${bookingId}`);
      } catch {
        toast.error('Could not update payment status');
      }
    } finally {
      setMarkingPaid(false);
    }
  };

  const deskSeats = seats.filter((s) => s.shape === 'desk');
  const availableCount = deskSeats.filter(
    (s) => s.status === 'active' && !bookedSeatIds.has(s.id)
  ).length;
  const bookedCount = deskSeats.filter((s) => bookedSeatIds.has(s.id)).length;

  const occupiedSeatRows = useMemo(() => {
    const deskMap = new Map(deskSeats.map((s) => [s.id, s]));
    const rows: Array<{
      seat: Seat;
      booking: Booking;
      student: Student | undefined;
      shiftLabel: string;
    }> = [];
    for (const [seatId, bks] of overlappingSeatBookingsMap) {
      const seat = deskMap.get(seatId);
      if (!seat) continue;
      for (const bk of bks) {
        rows.push({
          seat,
          booking: bk,
          student: studentMap.get(bk.studentId),
          shiftLabel: getShortShiftLabel(slotMap.get(bk.slotId)?.name || 'Shift'),
        });
      }
    }
    rows.sort((a, b) => a.seat.seatCode.localeCompare(b.seat.seatCode));
    return rows;
  }, [deskSeats, overlappingSeatBookingsMap, studentMap, slotMap]);

  const selectedSeatCategory = activeSelectedSeat?.categoryId
    ? categoryMap.get(activeSelectedSeat.categoryId) || null
    : null;

  return (
    <div className="space-y-5">
      {/* Step 1 & Step 2 Control Bar */}
      <div className="bg-[#FDFBF7] border border-[#E4DDD5] rounded-xl p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[180px_260px_1fr_200px] gap-4 items-end">
        {/* Step 1A: Date */}
        <div className="space-y-1.5">
          <Label htmlFor="pos-date" className="text-xs font-medium text-[#6E6762]">
            1. Booking Date
          </Label>
          <Input
            id="pos-date"
            type="date"
            value={bookingDate}
            onChange={(e) => {
              setBookingDate(e.target.value);
              setSelectedSeat(null);
            }}
            className="bg-[#FDFBF7] border-[#DDD4CA] h-10 tabular-nums"
          />
        </div>

        {/* Step 1B: Time Slot */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-[#6E6762]">
            Shift / Time Slot
          </Label>
          {slots.length === 0 ? (
            <Link
              href="/admin/pricing"
              className="flex items-center h-10 px-3 rounded-md border border-[#DDD4CA] bg-[#F4EFEA] text-xs text-[#D9775B] font-medium"
            >
              Configure shifts in Pricing →
            </Link>
          ) : (
            <Select
              value={selectedSlotId}
              onValueChange={(val) => {
                if (!val) return;
                setSelectedSlotId(val);
                setSelectedSeat(null);
              }}
            >
              <SelectTrigger className="bg-[#FDFBF7] border-[#DDD4CA] h-10 w-full">
                <SelectValue placeholder="Choose shift" />
              </SelectTrigger>
              <SelectContent className="bg-[#FDFBF7] border-[#E4DDD5]">
                {slots.map((slot) => (
                  <SelectItem key={slot.id} value={slot.id}>
                    {slot.name} ({formatTime12h(slot.startTime)}–
                    {formatTime12h(slot.endTime)})
                    {slot.price ? ` · ${formatINR(slot.price)}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Step 2: Searchable Student Dropdown */}
        <div className="space-y-1.5 relative" ref={studentPickerRef}>
          <Label className="text-xs font-medium text-[#6E6762]">
            2. Walk-in Student (Search by Name or Phone)
          </Label>
          <button
            type="button"
            onClick={() => setStudentDropdownOpen((o) => !o)}
            className="w-full h-10 px-3 rounded-md border border-[#DDD4CA] bg-[#FDFBF7] flex items-center justify-between gap-2 text-sm text-left hover:border-[#D9775B] transition-colors cursor-pointer"
          >
            {selectedStudent ? (
              <span className="truncate text-[#2C2A29] font-medium">
                {selectedStudent.name} ·{' '}
                <span className="font-normal text-[#6E6762] tabular-nums">
                  {selectedStudent.whatsappNumber || selectedStudent.phone || '—'}
                </span>
              </span>
            ) : (
              <span className="text-[#6E6762]">Select a student...</span>
            )}
            <div className="flex items-center gap-1 shrink-0">
              {selectedStudent && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedStudentId('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation();
                      setSelectedStudentId('');
                    }
                  }}
                  className="p-0.5 rounded hover:bg-[#F4EFEA] text-[#6E6762]"
                  aria-label="Clear selected student"
                >
                  <X className="size-3.5" />
                </span>
              )}
              <ChevronDown className="size-4 text-[#6E6762]" />
            </div>
          </button>

          {studentDropdownOpen && (
            <div className="absolute z-40 left-0 right-0 mt-1.5 bg-[#FDFBF7] border border-[#E4DDD5] rounded-xl shadow-lg overflow-hidden">
              <div className="p-2 border-b border-[#E4DDD5] bg-[#F4EFEA]">
                <div className="relative">
                  <Search className="size-3.5 text-[#6E6762] absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <Input
                    autoFocus
                    value={studentQuery}
                    onChange={(e) => setStudentQuery(e.target.value)}
                    placeholder="Type student name or phone..."
                    className="pl-8 h-8 text-sm bg-[#FDFBF7] border-[#DDD4CA]"
                  />
                </div>
              </div>
              <div className="max-h-60 overflow-y-auto divide-y divide-[#E4DDD5]/60">
                {filteredStudents.length === 0 ? (
                  <div className="p-4 text-center text-xs text-[#6E6762] space-y-2">
                    <p>No matching students found.</p>
                    <Link
                      href="/admin/students"
                      className="inline-block text-[#D9775B] font-medium hover:underline"
                    >
                      Register new student →
                    </Link>
                  </div>
                ) : (
                  filteredStudents.map((stu) => {
                    const isBlocked = stu.status === 'blocked';
                    return (
                      <button
                        key={stu.id}
                        type="button"
                        disabled={isBlocked}
                        onClick={() => {
                          setSelectedStudentId(stu.id);
                          setStudentDropdownOpen(false);
                        }}
                        className={cn(
                          'w-full px-3 py-2.5 text-left flex items-center justify-between gap-2 text-sm transition-colors',
                          isBlocked
                            ? 'opacity-50 cursor-not-allowed bg-[#F4EFEA]'
                            : 'hover:bg-[#F4EFEA] cursor-pointer',
                          selectedStudentId === stu.id && 'bg-[#F4EFEA]'
                        )}
                      >
                        <div className="min-w-0">
                          <p className="font-medium text-[#2C2A29] truncate">
                            {stu.name}
                          </p>
                          <p className="text-xs text-[#6E6762] truncate tabular-nums">
                            {[
                              stu.whatsappNumber || stu.phone,
                              stu.membershipType || 'No plan',
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        </div>
                        {isBlocked ? (
                          <span className="text-xs text-[#C25E5E] font-medium shrink-0">
                            Blocked
                          </span>
                        ) : selectedStudentId === stu.id ? (
                          <UserCheck className="size-4 text-[#7D9B76] shrink-0" />
                        ) : null}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* Floor Switcher */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-[#6E6762]">
            Reading Floor
          </Label>
          {floors.length === 0 ? (
            <Link
              href="/admin/editor"
              className="flex items-center h-10 px-3 rounded-md border border-[#DDD4CA] bg-[#F4EFEA] text-xs text-[#D9775B] font-medium"
            >
              Build floor plan →
            </Link>
          ) : (
            <Select
              value={selectedFloorId}
              onValueChange={(val) => {
                if (!val) return;
                setSelectedFloorId(val);
                setSelectedSeat(null);
              }}
            >
              <SelectTrigger className="bg-[#FDFBF7] border-[#DDD4CA] h-10 w-full">
                <SelectValue placeholder="Choose floor" />
              </SelectTrigger>
              <SelectContent className="bg-[#FDFBF7] border-[#E4DDD5]">
                {floors.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* Step 3 & Step 4: Interactive Map + Booking Counter Side Panel */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4 items-start">
        <div className="min-w-0 space-y-3">
          {/* Status Legend Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-xs text-[#6E6762]">
            <div className="flex flex-wrap items-center gap-4">
              <span className="inline-flex items-center gap-1.5 text-[#2C2A29]">
                <span className="size-3 rounded-sm bg-[#7D9B76] inline-block" />
                Available ({availableCount})
              </span>
              <span className="inline-flex items-center gap-1.5 text-[#2C2A29]">
                <span className="size-3 rounded-sm bg-[#DC2626] inline-block" />
                Male
              </span>
              <span className="inline-flex items-center gap-1.5 text-[#2C2A29]">
                <span className="size-3 rounded-sm bg-[#DB2777] inline-block" />
                Female
              </span>
              <span className="inline-flex items-center gap-1.5 text-[#2C2A29]">
                <span className="size-3 rounded-sm bg-[#C25E5E] inline-block" />
                Other / Booked ({bookedCount})
              </span>
              <span className="inline-flex items-center gap-1.5 text-[#6E6762]">
                <span className="size-3 rounded-sm bg-[#9C948D] inline-block" />
                Maintenance
              </span>
            </div>
            <span className="tabular-nums">
              {deskSeats.length} total seats on floor
            </span>
          </div>

          {loadingMap ? (
            <div className="h-[480px] bg-[#F4EFEA] border border-[#E4DDD5] rounded-xl flex items-center justify-center text-sm text-[#6E6762]">
              Loading floor layout...
            </div>
          ) : !activeFloor || deskSeats.length === 0 ? (
            <div className="h-[420px] bg-[#F4EFEA] border border-[#E4DDD5] rounded-xl flex flex-col items-center justify-center p-8 text-center space-y-3">
              <Armchair className="size-8 text-[#D9775B]" />
              <h3 className="font-serif text-lg font-semibold text-[#2C2A29]">
                No seats published on this floor yet
              </h3>
              <p className="text-sm text-[#6E6762] max-w-sm">
                Design desks in the Visual Layout Editor and click Publish Layout so
                they appear here for counter booking.
              </p>
              <Link
                href="/admin/editor"
                className="inline-flex items-center h-9 px-4 rounded-lg bg-[#D9775B] hover:bg-[#C46348] text-[#FDFBF7] text-sm font-medium"
              >
                Open Layout Editor
              </Link>
            </div>
          ) : (
            <BookingFloorMap
              widthPx={activeFloor.widthPx}
              heightPx={activeFloor.heightPx}
              seats={seats}
              categories={categories}
              bookedSeatInfoMap={bookedSeatInfoMap}
              selectedSeatId={activeSelectedSeat?.id || null}
              onSelectSeat={handleSelectSeat}
            />
          )}
        </div>

        {/* Right Side Panel: Selected Seat Counter Summary */}
        <aside className="bg-[#FDFBF7] border border-[#E4DDD5] rounded-xl p-5 space-y-5">
          {!activeSelectedSeat ? (
            <div className="space-y-4">
              <div className="py-6 text-center space-y-2">
                <Armchair className="size-7 text-[#7D9B76] mx-auto" />
                <h3 className="font-serif text-lg font-semibold text-[#2C2A29]">
                  3. Select an Available Seat
                </h3>
                <p className="text-xs text-[#6E6762] leading-relaxed">
                  Click any Sage Green desk on the floor map to review pricing and confirm a
                  walk-in reservation. Booked seats (Red = Male, Pink = Female) cannot be
                  selected for overlapping shifts.
                </p>
              </div>

              {occupiedSeatRows.length > 0 && (
                <>
                  <Separator className="bg-[#E4DDD5]" />
                  <div className="space-y-2.5">
                    <p className="text-xs font-medium uppercase tracking-wide text-[#6E6762]">
                      Occupied / Overlapping ({occupiedSeatRows.length})
                    </p>
                    <div className="max-h-64 overflow-y-auto divide-y divide-[#E4DDD5]/70 pr-1">
                      {occupiedSeatRows.map(({ seat, booking, student, shiftLabel }) => {
                        const dotColor = getBookedSeatColorByGender(student?.gender);
                        return (
                          <div
                            key={booking.id}
                            className="py-2 flex items-center justify-between gap-2 text-xs"
                          >
                            <div className="min-w-0">
                              <p className="font-medium text-[#2C2A29] flex items-center gap-1.5 truncate">
                                <span
                                  className="size-2.5 rounded-full shrink-0"
                                  style={{ backgroundColor: dotColor }}
                                />
                                <span>
                                  {seat.seatCode} · {student?.name || 'Student'}
                                </span>
                              </p>
                              <p className="text-[#6E6762] pl-4 tabular-nums">
                                {shiftLabel} · {formatINR(booking.amount)} ·{' '}
                                <span
                                  className={cn(
                                    'capitalize font-medium',
                                    booking.paymentStatus === 'paid'
                                      ? 'text-[#597752]'
                                      : 'text-[#D9775B]'
                                  )}
                                >
                                  {booking.paymentStatus}
                                </span>
                              </p>
                            </div>
                            {booking.paymentStatus === 'pending' && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={markingPaid}
                                onClick={() => void handleMarkAsPaid(booking.id, false)}
                                className="h-7 px-2 text-[11px] border-[#DDD4CA] bg-[#FDFBF7] text-[#2C2A29] hover:bg-[#F4EFEA] cursor-pointer shrink-0"
                              >
                                Mark Paid
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-[#597752]">
                  Available for Booking
                </p>
                <h3 className="font-serif text-2xl font-semibold text-[#2C2A29]">
                  Seat {activeSelectedSeat.seatCode}
                </h3>
                {selectedSeatCategory && (
                  <p className="text-xs text-[#6E6762]">
                    Tier: {selectedSeatCategory.name}
                  </p>
                )}
              </div>

              <Separator className="bg-[#E4DDD5]" />

              <div className="space-y-2.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#6E6762]">Student</span>
                  <span className="font-medium text-[#2C2A29] text-right truncate">
                    {selectedStudent ? selectedStudent.name : 'Not selected'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#6E6762]">Date</span>
                  <span className="tabular-nums text-[#2C2A29]">{bookingDate}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#6E6762]">Shift</span>
                  <span className="text-right text-[#2C2A29]">
                    {selectedSlot ? selectedSlot.name : 'Not selected'}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pos-fee" className="text-xs text-[#6E6762]">
                  Booking Fee (₹)
                </Label>
                <Input
                  id="pos-fee"
                  type="number"
                  min={0}
                  max={100000}
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  className="bg-[#FDFBF7] border-[#DDD4CA] font-medium text-base tabular-nums"
                />
              </div>

              <Button
                type="button"
                disabled={confirming || !selectedStudent || !selectedSlotId}
                onClick={() => void handleConfirmBooking()}
                className="w-full h-11 bg-[#D9775B] hover:bg-[#C46348] text-[#FDFBF7] font-medium cursor-pointer"
              >
                {confirming ? 'Confirming Seat...' : 'Confirm Booking'}
              </Button>

              {!selectedStudent && (
                <p className="text-xs text-[#C25E5E]">
                  Select a student in Step 2 above to enable confirmation.
                </p>
              )}
            </div>
          )}
        </aside>
      </div>

      {/* Step 6: Booking Confirmed Modal with Mark as Paid */}
      <Dialog open={successModalOpen} onOpenChange={setSuccessModalOpen}>
        <DialogContent className="bg-[#FDFBF7] border-[#E4DDD5] text-[#2C2A29] sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2 text-[#7D9B76]">
              <CheckCircle2 className="size-5" />
              <span className="text-xs font-medium uppercase tracking-wide">
                Reservation Confirmed
              </span>
            </div>
            <DialogTitle className="font-serif text-2xl text-[#2C2A29]">
              Seat {createdSummary?.seatCode} Booked
            </DialogTitle>
            <DialogDescription className="text-[#6E6762]">
              The seat has been locked for this shift and recorded in the ledger.
            </DialogDescription>
          </DialogHeader>

          {createdSummary && (
            <div className="bg-[#F4EFEA] border border-[#E4DDD5] rounded-lg p-4 space-y-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[#6E6762]">Student</span>
                <span className="font-medium text-[#2C2A29]">
                  {createdSummary.studentName}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[#6E6762]">Date</span>
                <span className="tabular-nums text-[#2C2A29]">
                  {createdSummary.bookingDate}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[#6E6762]">Shift</span>
                <span className="text-right text-[#2C2A29]">
                  {createdSummary.slotLabel}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[#6E6762]">Amount</span>
                <span className="font-semibold tabular-nums text-[#2C2A29]">
                  {formatINR(createdSummary.amount)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[#6E6762]">Payment Status</span>
                <span
                  className={cn(
                    'font-medium capitalize',
                    createdSummary.paymentStatus === 'paid'
                      ? 'text-[#597752]'
                      : 'text-[#D9775B]'
                  )}
                >
                  {createdSummary.paymentStatus}
                </span>
              </div>
            </div>
          )}

          <DialogFooter className="flex-col sm:flex-row gap-2">
            {createdSummary?.paymentStatus === 'pending' && (
              <Button
                type="button"
                disabled={markingPaid}
                onClick={() => void handleMarkAsPaid(createdSummary.id, true)}
                className="bg-[#7D9B76] hover:bg-[#6A8863] text-[#FDFBF7] cursor-pointer"
              >
                {markingPaid ? 'Recording...' : 'Mark as Paid (Cash / UPI)'}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => setSuccessModalOpen(false)}
              className="border-[#DDD4CA] bg-[#FDFBF7] text-[#2C2A29] hover:bg-[#F4EFEA] cursor-pointer"
            >
              {createdSummary?.paymentStatus === 'paid'
                ? 'Done'
                : 'Keep as Pending & Close'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
