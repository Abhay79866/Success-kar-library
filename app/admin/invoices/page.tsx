'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { Eye, FileText, MessageCircle, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/lib/firebase';
import { handleFirestoreError, OperationType } from '@/lib/firestore-errors';
import { formatINR } from '@/lib/formatters';
import {
  buildInvoiceWhatsAppUrl,
  formatReadableDate,
  formatShortMonthDay,
} from '@/lib/reminders';
import type { Booking, Invoice, Seat, Student, TimeSlot } from '@/lib/types';
import { useAdminAuth } from '@/components/admin/admin-auth-context';
import {
  CreateInvoiceDialog,
  InvoiceViewModal,
} from '@/components/admin/invoice-modals';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export default function InvoicesPage() {
  const { user, adminProfile } = useAdminAuth();

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [viewingInvoice, setViewingInvoice] = useState<Invoice | null>(null);

  useEffect(() => {
    if (!user || !adminProfile) return;

    let loadedCount = 0;
    const markLoaded = () => {
      loadedCount += 1;
      if (loadedCount >= 5) setLoading(false);
    };

    const unsubInvoices = onSnapshot(
      collection(db, 'invoices'),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as Invoice);
        list.sort((a, b) => {
          const dateDiff = b.invoiceDate.localeCompare(a.invoiceDate);
          if (dateDiff !== 0) return dateDiff;
          return b.invoiceNumber.localeCompare(a.invoiceNumber);
        });
        setInvoices(list);
        markLoaded();
      },
      (err) => {
        markLoaded();
        handleFirestoreError(err, OperationType.LIST, 'invoices');
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
        setSlots(snap.docs.map((d) => d.data() as TimeSlot));
        markLoaded();
      },
      (err) => {
        markLoaded();
        handleFirestoreError(err, OperationType.LIST, 'time_slots');
      }
    );

    return () => {
      unsubInvoices();
      unsubStudents();
      unsubBookings();
      unsubSeats();
      unsubSlots();
    };
  }, [user, adminProfile]);

  const filteredInvoices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter(
      (inv) =>
        inv.invoiceNumber.toLowerCase().includes(q) ||
        inv.studentName.toLowerCase().includes(q) ||
        inv.studentPhone.toLowerCase().includes(q) ||
        (inv.seatLabel || '').toLowerCase().includes(q)
    );
  }, [invoices, searchQuery]);

  const handleSendWhatsApp = (invoice: Invoice) => {
    const url = buildInvoiceWhatsAppUrl(invoice);
    if (!url) {
      toast.error(`Missing valid phone number for ${invoice.studentName}`);
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const totalCollected = useMemo(
    () => invoices.reduce((sum, inv) => sum + (inv.amount || 0), 0),
    [invoices]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 className="font-serif text-2xl font-semibold text-[#2C2A29]">
            Fee Invoices &amp; Receipts
          </h2>
          <p className="text-sm text-[#6E6762] tabular-nums">
            {invoices.length} {invoices.length === 1 ? 'invoice' : 'invoices'} issued ·{' '}
            {formatINR(totalCollected)} total billed
          </p>
        </div>

        <Button
          onClick={() => setCreateOpen(true)}
          className="bg-[#D96B4F] hover:bg-[#C4583D] text-white whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="size-4 mr-1.5" />
          Create Invoice
        </Button>
      </div>

      {/* Search Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#F4EFEA] border border-[#E4DDD5] rounded-xl p-3">
        <div className="relative flex-1 max-w-md">
          <Search className="size-4 text-[#6E6762] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by invoice no, student name, phone, or seat..."
            className="pl-9 bg-[#FDFBF7] border-[#DDD4CA] text-[#2C2A29] placeholder:text-[#6E6762]/70"
          />
        </div>
      </div>

      {/* Invoices Table */}
      <div className="bg-[#FDFBF7] border border-[#E4DDD5] rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map((row) => (
              <div
                key={row}
                className="h-11 rounded-md bg-[#F4EFEA] animate-pulse"
              />
            ))}
          </div>
        ) : invoices.length === 0 ? (
          <div className="p-12 text-center space-y-4">
            <div className="mx-auto size-11 rounded-lg bg-[#F4EFEA] border border-[#E4DDD5] flex items-center justify-center text-[#D96B4F]">
              <FileText className="size-5" />
            </div>
            <div className="space-y-1 max-w-sm mx-auto">
              <h3 className="font-serif text-lg font-semibold text-[#2C2A29]">
                No invoices generated yet
              </h3>
              <p className="text-sm text-[#6E6762]">
                Generate numbered receipts for Success Kar Library members and send them directly on WhatsApp.
              </p>
            </div>
            <Button
              onClick={() => setCreateOpen(true)}
              className="bg-[#D96B4F] hover:bg-[#C4583D] text-white cursor-pointer"
            >
              <Plus className="size-4 mr-1.5" />
              Create First Invoice
            </Button>
          </div>
        ) : filteredInvoices.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <p className="text-sm text-[#6E6762]">
              No invoices match your search.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSearchQuery('')}
              className="border-[#DDD4CA] bg-[#FDFBF7] text-[#2C2A29] hover:bg-[#F4EFEA] cursor-pointer"
            >
              Clear Search
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader className="bg-[#F4EFEA]">
              <TableRow className="border-[#E4DDD5] hover:bg-[#F4EFEA]">
                <TableHead className="text-[#6E6762] font-medium px-4 h-11">
                  Invoice No.
                </TableHead>
                <TableHead className="text-[#6E6762] font-medium px-4 h-11">
                  Student
                </TableHead>
                <TableHead className="text-[#6E6762] font-medium px-4 h-11">
                  Seat &amp; Shift
                </TableHead>
                <TableHead className="text-[#6E6762] font-medium px-4 h-11">
                  Validity Period
                </TableHead>
                <TableHead className="text-[#6E6762] font-medium px-4 h-11">
                  Amount
                </TableHead>
                <TableHead className="text-[#6E6762] font-medium px-4 h-11 text-right">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredInvoices.map((invoice) => (
                <TableRow
                  key={invoice.id}
                  className="border-[#E4DDD5] hover:bg-[#F4EFEA]/60"
                >
                  <TableCell className="px-4 py-3 tabular-nums">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-semibold text-[#2C2A29]">
                        {invoice.invoiceNumber}
                      </span>
                      <span className="text-xs text-[#6E6762]">
                        {formatReadableDate(invoice.invoiceDate)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium text-[#2C2A29]">
                        {invoice.studentName}
                      </span>
                      <span className="text-xs text-[#6E6762] tabular-nums">
                        {invoice.studentPhone}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-3 text-sm text-[#2C2A29]">
                    <div className="flex flex-col gap-0.5">
                      <span>{invoice.seatLabel || 'General Membership'}</span>
                      <span className="text-xs text-[#6E6762]">
                        {invoice.shiftLabel || 'Monthly Plan'}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-3 text-sm text-[#6E6762] tabular-nums">
                    {formatShortMonthDay(invoice.validFrom)} –{' '}
                    {formatShortMonthDay(invoice.validTo)}
                  </TableCell>
                  <TableCell className="px-4 py-3 tabular-nums">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-semibold text-[#2C2A29]">
                        {formatINR(invoice.amount)}
                      </span>
                      <span className="text-xs text-[#6E6762]">
                        {invoice.paymentMode}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-3 text-right">
                    <div className="inline-flex items-center justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => handleSendWhatsApp(invoice)}
                        className="h-8 px-3 bg-[#16A34A] hover:bg-[#15803D] text-white font-medium whitespace-nowrap cursor-pointer"
                      >
                        <MessageCircle className="size-3.5 mr-1.5" />
                        Send on WhatsApp
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setViewingInvoice(invoice)}
                        className="h-8 px-2.5 border-[#DDD4CA] bg-[#FDFBF7] text-[#2C2A29] hover:bg-[#F4EFEA] cursor-pointer"
                      >
                        <Eye className="size-3.5 mr-1" />
                        View
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <CreateInvoiceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        students={students}
        bookings={bookings}
        seats={seats}
        slots={slots}
        existingInvoices={invoices}
        onCreated={(created) => setViewingInvoice(created)}
      />

      <InvoiceViewModal
        invoice={viewingInvoice}
        open={Boolean(viewingInvoice)}
        onOpenChange={(open) => {
          if (!open) setViewingInvoice(null);
        }}
      />
    </div>
  );
}
