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
import type {
  Booking,
  Category,
  Floor,
  Seat,
  Student,
  TimeSlot,
} from '@/lib/types';
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
  const [slotBookings, setSlotBookings] = useState<Booking[]>([]);
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

  // Load bookings for selected date + slot
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
        setSlotBookings(
          allForDate.filter(
            (b) => b.slotId === selectedSlotId && b.status !== 'cancelled'
          )
        );
      },
      (err) =>
        handleFirestoreError(err, OperationType.LIST, `bookings?bookingDate=${bookingDate}`)
    );

    return () => unsub();
  }, [user, adminProfile, bookingDate, selectedSlotId]);

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
      return (
        s.name.toLowerCase().includes(q) ||
        s.phone.toLowerCase().includes(q) ||
        s.membershipType.toLowerCase().includes(q)
      );
    });
  }, [students, studentQuery]);

  const activeBookingsBySeatId = useMemo(() => {
    const map = new Map<string, Booking>();
    for (const bk of slotBookings) {
      map.set(bk.seatId, bk);
    }
    return map;
  }, [slotBookings]);

  const bookedSeatIds = useMemo(
    () => new Set(activeBookingsBySeatId.keys()),
    [activeBookingsBySeatId]
  );

  const categoryMap = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories]
  );

  const studentMap = useMemo(
    () => new Map(students.map((s) => [s.id, s])),
    [students]
  );

  const getDefaultFee = (seat: Seat | null) => {
    if (!seat) return 0;
    if (selectedSlot?.price !== undefined && selectedSlot.price > 0) {
      return selectedSlot.price;
    }
    const cat = seat.categoryId ? categoryMap.get(seat.categoryId) : undefined;
    return cat?.price ?? 0;
  };

  const handleSelectSeat = (seat: Seat) => {
    setSelectedSeat(seat);
    const fee = getDefaultFee(seat);
    setCustomAmount(String(fee));
  };

  const handleConfirmBooking = async () => {
    if (!user) return;
    if (!bookingDate || !selectedSlotId || !selectedFloorId) {
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
    if (!selectedSeat || selectedSeat.shape !== 'desk') {
      toast.error('Please click an available desk on the floor map.');
      return;
    }
    if (selectedSeat.status === 'maintenance') {
      toast.error('This seat is currently under maintenance.');
      return;
    }

    const parsedAmount = Number(customAmount);
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0 || parsedAmount > 100000) {
      toast.error('Enter a valid fee between 0 and 100,000.');
      return;
    }

    setConfirming(true);
    const bookingId = generateDocId('bk');
    const lockId = `${selectedSeat.id}_${selectedSlotId}_${bookingDate}`;

    try {
      await runTransaction(db, async (tx) => {
        const seatRef = doc(db, 'seats', selectedSeat.id);
        const lockRef = doc(db, 'booking_locks', lockId);

        const [seatSnap, lockSnap] = await Promise.all([
          tx.get(seatRef),
          tx.get(lockRef),
        ]);

        if (!seatSnap.exists()) {
          throw new Error('SEAT_NOT_FOUND');
        }
        const liveSeat = seatSnap.data() as Seat;
        if (liveSeat.status !== 'active') {
          throw new Error('SEAT_IN_MAINTENANCE');
        }
        if (lockSnap.exists()) {
          const lockData = lockSnap.data() as { status?: string };
          if (lockData.status !== 'cancelled') {
            throw new Error('SEAT_ALREADY_BOOKED');
          }
        }

        const bookingRef = doc(db, 'bookings', bookingId);
        tx.set(bookingRef, {
          id: bookingId,
          studentId: selectedStudent.id,
          seatId: selectedSeat.id,
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

        tx.set(lockRef, {
          id: lockId,
          bookingId,
          seatId: selectedSeat.id,
          floorId: selectedFloorId,
          slotId: selectedSlotId,
          bookingDate,
          status: 'active',
          updatedAt: serverTimestamp(),
        });
      });

      const slotLabel = selectedSlot
        ? `${selectedSlot.name} (${formatTime12h(selectedSlot.startTime)} – ${formatTime12h(selectedSlot.endTime)})`
        : selectedSlotId;

      setCreatedSummary({
        id: bookingId,
        seatCode: selectedSeat.seatCode,
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
        if (err.message === 'SEAT_ALREADY_BOOKED') {
          toast.error('This seat is already booked for the selected date & shift.');
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

  const selectedSeatExistingBooking = selectedSeat
    ? activeBookingsBySeatId.get(selectedSeat.id) || null
    : null;
  const selectedSeatCategory = selectedSeat?.categoryId
    ? categoryMap.get(selectedSeat.categoryId) || null
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
                  {selectedStudent.phone}
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
                            {stu.phone} · {stu.membershipType}
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
                <span className="size-3 rounded-sm bg-[#C25E5E] inline-block" />
                Booked ({bookedCount})
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
              bookedSeatIds={bookedSeatIds}
              selectedSeatId={selectedSeat?.id || null}
              onSelectSeat={handleSelectSeat}
            />
          )}
        </div>

        {/* Right Side Panel: Selected Seat Counter Summary */}
        <aside className="bg-[#FDFBF7] border border-[#E4DDD5] rounded-xl p-5 space-y-5">
          {!selectedSeat ? (
            <div className="py-8 text-center space-y-2">
              <Armchair className="size-7 text-[#7D9B76] mx-auto" />
              <h3 className="font-serif text-lg font-semibold text-[#2C2A29]">
                3. Select an Available Seat
              </h3>
              <p className="text-xs text-[#6E6762] leading-relaxed">
                Click any Sage Green desk on the floor map to review pricing and confirm a
                walk-in reservation.
              </p>
            </div>
          ) : selectedSeatExistingBooking ? (
            <div className="space-y-4">
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-[#C25E5E]">
                  Seat Occupied
                </p>
                <h3 className="font-serif text-2xl font-semibold text-[#2C2A29]">
                  Seat {selectedSeat.seatCode}
                </h3>
              </div>

              <Separator className="bg-[#E4DDD5]" />

              <div className="space-y-2.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#6E6762]">Student</span>
                  <span className="font-medium text-[#2C2A29] text-right">
                    {studentMap.get(selectedSeatExistingBooking.studentId)?.name ||
                      'Registered Student'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#6E6762]">Date</span>
                  <span className="tabular-nums text-[#2C2A29]">
                    {selectedSeatExistingBooking.bookingDate}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#6E6762]">Amount</span>
                  <span className="font-medium tabular-nums text-[#2C2A29]">
                    {formatINR(selectedSeatExistingBooking.amount)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#6E6762]">Payment</span>
                  <span
                    className={cn(
                      'font-medium capitalize',
                      selectedSeatExistingBooking.paymentStatus === 'paid'
                        ? 'text-[#597752]'
                        : 'text-[#D9775B]'
                    )}
                  >
                    {selectedSeatExistingBooking.paymentStatus}
                  </span>
                </div>
              </div>

              {selectedSeatExistingBooking.paymentStatus === 'pending' && (
                <Button
                  type="button"
                  disabled={markingPaid}
                  onClick={() =>
                    void handleMarkAsPaid(selectedSeatExistingBooking.id, false)
                  }
                  className="w-full bg-[#7D9B76] hover:bg-[#6A8863] text-[#FDFBF7] cursor-pointer"
                >
                  {markingPaid ? 'Updating...' : 'Mark as Paid (Cash / UPI)'}
                </Button>
              )}
            </div>
          ) : selectedSeat.status === 'maintenance' ? (
            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-wide text-[#6E6762]">
                Unavailable
              </p>
              <h3 className="font-serif text-xl font-semibold text-[#2C2A29]">
                Seat {selectedSeat.seatCode}
              </h3>
              <p className="text-sm text-[#6E6762]">
                This desk is currently marked for maintenance in the Layout Editor and
                cannot be booked.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-[#597752]">
                  Available for Booking
                </p>
                <h3 className="font-serif text-2xl font-semibold text-[#2C2A29]">
                  Seat {selectedSeat.seatCode}
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
