'use client';

import React, { useMemo, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { MessageCircle, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/lib/firebase';
import { formatINR, generateDocId } from '@/lib/formatters';
import {
  addOneMonth,
  buildInvoiceWhatsAppUrl,
  formatReadableDate,
  getStudentLastPaymentDate,
  getStudentPhoneForWhatsApp,
  getStudentSubscriptionEndDate,
  getTodayDateString,
} from '@/lib/reminders';
import type {
  Booking,
  Invoice,
  InvoicePaymentMode,
  Seat,
  Student,
  TimeSlot,
} from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

const PAYMENT_MODES: readonly InvoicePaymentMode[] = ['UPI', 'Cash', 'Bank/Card'];
const MANUAL_STUDENT_VALUE = '__manual__';

interface InvoiceFormDraft {
  selectedStudentId: string;
  studentName: string;
  studentPhone: string;
  seatLabel: string;
  shiftLabel: string;
  amount: string;
  paymentMode: InvoicePaymentMode;
  validFrom: string;
  validTo: string;
}

export function buildStudentInvoiceDefaults(
  student: Student | null,
  bookings: Booking[],
  seats: Seat[],
  slots: TimeSlot[]
): InvoiceFormDraft {
  const today = getTodayDateString();
  if (!student) {
    return {
      selectedStudentId: MANUAL_STUDENT_VALUE,
      studentName: '',
      studentPhone: '',
      seatLabel: '',
      shiftLabel: '',
      amount: '800',
      paymentMode: 'UPI',
      validFrom: today,
      validTo: addOneMonth(today),
    };
  }

  const studentBookings = bookings
    .filter((b) => b.studentId === student.id && b.status !== 'cancelled')
    .sort((a, b) => b.bookingDate.localeCompare(a.bookingDate));
  const latestBooking = studentBookings[0];

  const seat = latestBooking
    ? seats.find((s) => s.id === latestBooking.seatId)
    : undefined;
  const slot = latestBooking
    ? slots.find((s) => s.id === latestBooking.slotId)
    : undefined;

  const validFrom = getStudentLastPaymentDate(student) || today;
  const validTo = getStudentSubscriptionEndDate(student) || addOneMonth(validFrom);
  const amountVal =
    typeof student.feeAmount === 'number' && !Number.isNaN(student.feeAmount)
      ? student.feeAmount
      : latestBooking && typeof latestBooking.amount === 'number'
        ? latestBooking.amount
        : 800;

  return {
    selectedStudentId: student.id,
    studentName: student.name,
    studentPhone: getStudentPhoneForWhatsApp(student),
    seatLabel: seat?.seatCode ? `Seat ${seat.seatCode}` : '',
    shiftLabel: slot?.name || student.membershipType || '',
    amount: String(amountVal),
    paymentMode: 'UPI',
    validFrom,
    validTo,
  };
}

function getMaxExistingInvoiceSequence(invoices: Invoice[]): number {
  let maxSeq = 0;
  for (const inv of invoices) {
    const match = /^INV-(\d+)$/i.exec((inv.invoiceNumber || '').trim());
    if (match) {
      const n = Number(match[1]);
      if (Number.isFinite(n) && n > maxSeq) {
        maxSeq = n;
      }
    }
  }
  return maxSeq;
}

interface CreateInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  students: Student[];
  bookings: Booking[];
  seats: Seat[];
  slots: TimeSlot[];
  existingInvoices: Invoice[];
  initialStudentId?: string | null;
  onCreated?: (invoice: Invoice) => void;
}

export function CreateInvoiceDialog({
  open,
  onOpenChange,
  students,
  bookings,
  seats,
  slots,
  existingInvoices,
  initialStudentId,
  onCreated,
}: CreateInvoiceDialogProps) {
  const initialStudent = useMemo(
    () =>
      initialStudentId
        ? students.find((s) => s.id === initialStudentId) || null
        : null,
    [initialStudentId, students]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#FDFBF7] border-[#E4DDD5] text-[#2C2A29] sm:max-w-lg max-h-[90vh] overflow-y-auto">
        {open && (
          <CreateInvoiceForm
            key={initialStudent?.id || MANUAL_STUDENT_VALUE}
            initialStudent={initialStudent}
            students={students}
            bookings={bookings}
            seats={seats}
            slots={slots}
            existingInvoices={existingInvoices}
            onClose={() => onOpenChange(false)}
            onCreated={onCreated}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface CreateInvoiceFormProps {
  initialStudent: Student | null;
  students: Student[];
  bookings: Booking[];
  seats: Seat[];
  slots: TimeSlot[];
  existingInvoices: Invoice[];
  onClose: () => void;
  onCreated?: (invoice: Invoice) => void;
}

function CreateInvoiceForm({
  initialStudent,
  students,
  bookings,
  seats,
  slots,
  existingInvoices,
  onClose,
  onCreated,
}: CreateInvoiceFormProps) {
  const [draft, setDraft] = useState<InvoiceFormDraft>(() =>
    buildStudentInvoiceDefaults(initialStudent, bookings, seats, slots)
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const sortedStudents = useMemo(
    () => [...students].sort((a, b) => a.name.localeCompare(b.name)),
    [students]
  );

  const handleStudentChange = (value: string | null) => {
    if (!value || value === MANUAL_STUDENT_VALUE) {
      setDraft(buildStudentInvoiceDefaults(null, bookings, seats, slots));
      return;
    }
    const found = students.find((s) => s.id === value) || null;
    setDraft(buildStudentInvoiceDefaults(found, bookings, seats, slots));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const studentName = draft.studentName.trim();
    const rawDigits = draft.studentPhone.replace(/\D/g, '');
    const seatLabel = draft.seatLabel.trim();
    const shiftLabel = draft.shiftLabel.trim();
    const parsedAmount = Number(draft.amount);

    if (studentName.length < 1 || studentName.length > 120) {
      setFormError('Student name must be between 1 and 120 characters.');
      return;
    }
    if (rawDigits.length < 10 || rawDigits.length > 15) {
      setFormError('Please enter a valid 10-digit WhatsApp / phone number.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.validFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(draft.validTo)) {
      setFormError('Please choose valid From and To billing period dates.');
      return;
    }
    if (draft.validTo < draft.validFrom) {
      setFormError('Billing period end date must be on or after the start date.');
      return;
    }
    if (Number.isNaN(parsedAmount) || parsedAmount < 0 || parsedAmount > 100000) {
      setFormError('Amount must be between ₹0 and ₹1,00,000.');
      return;
    }

    setSaving(true);
    try {
      const today = getTodayDateString();
      const invoiceId = generateDocId('inv');
      const maxExistingSeq = getMaxExistingInvoiceSequence(existingInvoices);
      const studentId =
        draft.selectedStudentId !== MANUAL_STUDENT_VALUE
          ? draft.selectedStudentId
          : '';

      const createdNumber = await runTransaction(db, async (tx) => {
        const counterRef = doc(db, 'counters', 'invoices');
        const counterSnap = await tx.get(counterRef);
        const currentSeq = counterSnap.exists()
          ? Number(counterSnap.data().seq || 0)
          : 0;
        const nextSeq = Math.max(currentSeq, maxExistingSeq) + 1;
        const invoiceNumber = `INV-${String(nextSeq).padStart(4, '0')}`;

        tx.set(counterRef, {
          id: 'invoices',
          seq: nextSeq,
          updatedAt: serverTimestamp(),
        });

        const invoiceRef = doc(db, 'invoices', invoiceId);
        const payload: Record<string, unknown> = {
          id: invoiceId,
          invoiceNumber,
          invoiceDate: today,
          studentName,
          studentPhone: rawDigits,
          seatLabel,
          shiftLabel,
          validFrom: draft.validFrom,
          validTo: draft.validTo,
          amount: parsedAmount,
          paymentMode: draft.paymentMode,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        if (studentId) {
          payload.studentId = studentId;
        }
        tx.set(invoiceRef, payload);
        return invoiceNumber;
      });

      const createdInvoice: Invoice = {
        id: invoiceId,
        invoiceNumber: createdNumber,
        invoiceDate: today,
        ...(studentId ? { studentId } : {}),
        studentName,
        studentPhone: rawDigits,
        seatLabel,
        shiftLabel,
        validFrom: draft.validFrom,
        validTo: draft.validTo,
        amount: parsedAmount,
        paymentMode: draft.paymentMode,
        createdAt: new Date().toISOString(),
      };

      toast.success(`Invoice ${createdNumber} generated for ${studentName}`);
      onClose();
      onCreated?.(createdInvoice);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to generate invoice';
      console.error('Failed to generate invoice:', err);
      setFormError(`Could not generate invoice: ${msg}`);
      toast.error(`Failed to generate invoice: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-serif text-xl text-[#2C2A29]">
          Create Fee Invoice
        </DialogTitle>
        <DialogDescription className="text-[#6E6762]">
          Select an existing student to auto-fill their details, or enter walk-in details manually.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        {formError && (
          <div
            role="alert"
            className="bg-[#F4EFEA] border border-[#C25E5E] rounded-lg p-3 text-xs text-[#C25E5E]"
          >
            {formError}
          </div>
        )}

        <div className="space-y-1.5">
          <Label>Select Student</Label>
          <Select value={draft.selectedStudentId} onValueChange={handleStudentChange}>
            <SelectTrigger className="bg-[#FDFBF7] border-[#DDD4CA] w-full">
              <SelectValue placeholder="Choose student or enter manually">
                {draft.selectedStudentId === MANUAL_STUDENT_VALUE
                  ? 'Manual / Walk-in Entry'
                  : (() => {
                      const selected = students.find(
                        (s) => s.id === draft.selectedStudentId
                      );
                      return selected
                        ? `${selected.name} (${getStudentPhoneForWhatsApp(selected) || 'No phone'})`
                        : 'Choose student or enter manually';
                    })()}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="bg-[#FDFBF7] border-[#E4DDD5]">
              <SelectItem value={MANUAL_STUDENT_VALUE}>
                Manual / Walk-in Entry
              </SelectItem>
              {sortedStudents.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name} ({getStudentPhoneForWhatsApp(s) || 'No phone'})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="inv-student-name">Student Name</Label>
            <Input
              id="inv-student-name"
              value={draft.studentName}
              onChange={(e) =>
                setDraft((d) => ({ ...d, studentName: e.target.value }))
              }
              placeholder="e.g. Aarav Sharma"
              maxLength={120}
              required
              className="bg-[#FDFBF7] border-[#DDD4CA]"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="inv-student-phone">WhatsApp / Phone</Label>
            <Input
              id="inv-student-phone"
              type="tel"
              inputMode="numeric"
              value={draft.studentPhone}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  studentPhone: e.target.value.replace(/\D/g, '').slice(0, 15),
                }))
              }
              placeholder="10-digit number"
              maxLength={15}
              required
              className="bg-[#FDFBF7] border-[#DDD4CA] tabular-nums"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="inv-seat-label">Seat (Optional)</Label>
            <Input
              id="inv-seat-label"
              value={draft.seatLabel}
              onChange={(e) =>
                setDraft((d) => ({ ...d, seatLabel: e.target.value }))
              }
              placeholder="e.g. Seat A-12"
              maxLength={64}
              className="bg-[#FDFBF7] border-[#DDD4CA]"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="inv-shift-label">Shift / Plan</Label>
            <Input
              id="inv-shift-label"
              value={draft.shiftLabel}
              onChange={(e) =>
                setDraft((d) => ({ ...d, shiftLabel: e.target.value }))
              }
              placeholder="e.g. Full Day Shift"
              maxLength={64}
              className="bg-[#FDFBF7] border-[#DDD4CA]"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="inv-amount">Amount Paid (₹)</Label>
            <Input
              id="inv-amount"
              type="number"
              min={0}
              max={100000}
              step={1}
              value={draft.amount}
              onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))}
              required
              className="bg-[#FDFBF7] border-[#DDD4CA] tabular-nums"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Payment Mode</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {PAYMENT_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, paymentMode: mode }))}
                  className={cn(
                    'h-9 px-2 rounded-md border text-xs font-medium transition-colors cursor-pointer whitespace-nowrap',
                    draft.paymentMode === mode
                      ? 'bg-[#D96B4F] border-[#D96B4F] text-white'
                      : 'bg-[#FDFBF7] border-[#DDD4CA] text-[#2C2A29] hover:bg-[#F4EFEA]'
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="inv-valid-from">Billing Period From</Label>
            <Input
              id="inv-valid-from"
              type="date"
              value={draft.validFrom}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  validFrom: e.target.value,
                  validTo: e.target.value ? addOneMonth(e.target.value) : d.validTo,
                }))
              }
              required
              className="bg-[#FDFBF7] border-[#DDD4CA] tabular-nums"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="inv-valid-to">Billing Period To</Label>
            <Input
              id="inv-valid-to"
              type="date"
              value={draft.validTo}
              onChange={(e) => setDraft((d) => ({ ...d, validTo: e.target.value }))}
              required
              className="bg-[#FDFBF7] border-[#DDD4CA] tabular-nums"
            />
          </div>
        </div>

        <DialogFooter className="pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            className="border-[#DDD4CA] bg-[#FDFBF7] text-[#2C2A29] hover:bg-[#F4EFEA] cursor-pointer"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={saving}
            className="bg-[#D96B4F] hover:bg-[#C4583D] text-white cursor-pointer"
          >
            {saving ? 'Generating...' : 'Generate Invoice'}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

const emptySubscribe = () => () => {};

function InvoiceReceiptCard({
  invoice,
  printable = false,
}: {
  invoice: Invoice;
  printable?: boolean;
}) {
  return (
    <div
      id={printable ? 'printable-invoice-receipt' : undefined}
      className={cn(
        'bg-[#FDFBF7] border border-[#E4DDD5] rounded-xl p-6 space-y-5',
        printable && 'bg-white'
      )}
    >
      <div className="flex items-start justify-between gap-4 border-b border-[#E4DDD5] pb-4">
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-wider text-[#6E6762]">
            Official Fee Receipt
          </p>
          <h3 className="font-serif text-2xl font-semibold text-[#2C2A29]">
            Success Kar Library
          </h3>
        </div>
        <div className="text-right tabular-nums space-y-0.5">
          <p className="text-sm font-semibold text-[#2C2A29]">
            {invoice.invoiceNumber}
          </p>
          <p className="text-xs text-[#6E6762]">
            {formatReadableDate(invoice.invoiceDate)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="space-y-0.5">
          <p className="text-xs text-[#6E6762]">Student Name</p>
          <p className="font-medium text-[#2C2A29]">{invoice.studentName}</p>
        </div>
        <div className="space-y-0.5">
          <p className="text-xs text-[#6E6762]">Phone Number</p>
          <p className="font-medium text-[#2C2A29] tabular-nums">
            {invoice.studentPhone}
          </p>
        </div>
        <div className="space-y-0.5">
          <p className="text-xs text-[#6E6762]">Seat</p>
          <p className="font-medium text-[#2C2A29]">
            {invoice.seatLabel || 'General Membership'}
          </p>
        </div>
        <div className="space-y-0.5">
          <p className="text-xs text-[#6E6762]">Shift / Plan</p>
          <p className="font-medium text-[#2C2A29]">
            {invoice.shiftLabel || 'Monthly Plan'}
          </p>
        </div>
        <div className="space-y-0.5">
          <p className="text-xs text-[#6E6762]">Validity Period</p>
          <p className="font-medium text-[#2C2A29] tabular-nums">
            {formatReadableDate(invoice.validFrom)} –{' '}
            {formatReadableDate(invoice.validTo)}
          </p>
        </div>
        <div className="space-y-0.5">
          <p className="text-xs text-[#6E6762]">Payment Mode</p>
          <p className="font-medium text-[#2C2A29]">{invoice.paymentMode}</p>
        </div>
      </div>

      <div className="bg-[#F4EFEA] border border-[#E4DDD5] rounded-lg px-4 py-3.5 flex items-center justify-between">
        <span className="text-sm font-medium text-[#2C2A29]">
          Total Amount Paid
        </span>
        <span className="font-serif text-2xl font-semibold text-[#2C2A29] tabular-nums">
          {formatINR(invoice.amount)}
        </span>
      </div>

      <p className="text-xs text-[#6E6762] text-center pt-1">
        Thank you for studying with Success Kar Library.
      </p>
    </div>
  );
}

interface InvoiceViewModalProps {
  invoice: Invoice | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InvoiceViewModal({
  invoice,
  open,
  onOpenChange,
}: InvoiceViewModalProps) {
  const isClient = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  const handleSendWhatsApp = () => {
    if (!invoice) return;
    const url = buildInvoiceWhatsAppUrl(invoice);
    if (!url) {
      toast.error(`Missing valid phone number for ${invoice.studentName}`);
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="bg-[#FAF7F2] border-[#E4DDD5] text-[#2C2A29] sm:max-w-lg max-h-[92vh] overflow-y-auto print:hidden">
          <DialogHeader className="print:hidden">
            <DialogTitle className="font-serif text-xl text-[#2C2A29]">
              Payment Receipt
            </DialogTitle>
            <DialogDescription className="text-[#6E6762]">
              Print or save as PDF, or share this receipt directly with the student on WhatsApp.
            </DialogDescription>
          </DialogHeader>

          {invoice && (
            <div className="space-y-5">
              <InvoiceReceiptCard invoice={invoice} />

              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 print:hidden">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handlePrint}
                  className="border-[#DDD4CA] bg-[#FDFBF7] text-[#2C2A29] hover:bg-[#F4EFEA] cursor-pointer"
                >
                  <Printer className="size-4 mr-1.5" />
                  Print / Save PDF
                </Button>
                <Button
                  type="button"
                  onClick={handleSendWhatsApp}
                  className="bg-[#16A34A] hover:bg-[#15803D] text-white font-medium cursor-pointer"
                >
                  <MessageCircle className="size-4 mr-1.5" />
                  Send on WhatsApp
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {isClient &&
        open &&
        invoice &&
        createPortal(
          <div
            id="printable-invoice-receipt-root"
            className="hidden print:block"
          >
            <InvoiceReceiptCard invoice={invoice} printable />
          </div>,
          document.body
        )}
    </>
  );
}
