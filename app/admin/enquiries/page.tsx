'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  Calendar,
  Eye,
  MessageCircle,
  MessageSquarePlus,
  Phone,
  Plus,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/lib/firebase';
import { handleFirestoreError, OperationType } from '@/lib/firestore-errors';
import { generateDocId } from '@/lib/formatters';
import {
  buildEnquiryWhatsAppUrl,
  formatReadableDate,
  getTodayDateString,
} from '@/lib/reminders';
import type { Enquiry, EnquiryStatus } from '@/lib/types';
import { useAdminAuth } from '@/components/admin/admin-auth-context';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

const STATUS_LABELS: Record<EnquiryStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  joined: 'Joined',
};

const STATUS_STYLES: Record<EnquiryStatus, string> = {
  new: 'bg-[#D96B4F]/15 text-[#B45339] border-[#D96B4F]/30',
  contacted: 'bg-[#EAE2D9] text-[#2C2A29] border-[#DDD4CA]',
  joined: 'bg-[#7D9B76]/15 text-[#4A6644] border-[#7D9B76]/30',
};

export default function EnquiriesPage() {
  const { user, adminProfile } = useAdminAuth();

  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Quick Add Enquiry Form (strictly 2 input fields: Name & Phone Number)
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);

  // View Enquiry Modal
  const [viewingEnquiry, setViewingEnquiry] = useState<Enquiry | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  useEffect(() => {
    if (!user || !adminProfile) return;

    const unsub = onSnapshot(
      collection(db, 'enquiries'),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as Enquiry);
        list.sort((a, b) => b.enquiryDate.localeCompare(a.enquiryDate));
        setEnquiries(list);
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        handleFirestoreError(err, OperationType.LIST, 'enquiries');
      }
    );

    return () => unsub();
  }, [user, adminProfile]);

  const filteredEnquiries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return enquiries;
    return enquiries.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.phone.toLowerCase().includes(q)
    );
  }, [enquiries, searchQuery]);

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    const digits = phone.replace(/\D/g, '');

    if (trimmedName.length < 1 || trimmedName.length > 120) {
      toast.error('Please enter the visitor name.');
      return;
    }
    if (digits.length < 10 || digits.length > 15) {
      toast.error('Please enter a valid 10-digit phone number.');
      return;
    }

    setSaving(true);
    try {
      const today = getTodayDateString();
      const newId = generateDocId('enq');
      await setDoc(doc(db, 'enquiries', newId), {
        id: newId,
        name: trimmedName,
        phone: digits,
        enquiryDate: today,
        status: 'new',
        createdAt: serverTimestamp(),
      });
      toast.success(`Enquiry recorded for ${trimmedName}`);
      setName('');
      setPhone('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to save enquiry';
      console.error('Failed to save enquiry:', err);
      toast.error(`Failed to save enquiry: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const handleWhatsAppFollowUp = (enquiry: Enquiry) => {
    const url = buildEnquiryWhatsAppUrl(enquiry);
    if (!url) {
      toast.error(`Invalid phone number for ${enquiry.name}`);
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleStatusChange = async (enquiry: Enquiry, nextStatus: EnquiryStatus) => {
    setUpdatingStatus(true);
    try {
      await updateDoc(doc(db, 'enquiries', enquiry.id), {
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });
      setViewingEnquiry((prev) =>
        prev && prev.id === enquiry.id ? { ...prev, status: nextStatus } : prev
      );
      toast.success(`Marked ${enquiry.name} as ${STATUS_LABELS[nextStatus]}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to update status';
      console.error('Failed to update enquiry status:', err);
      toast.error(`Failed to update status: ${msg}`);
    } finally {
      setUpdatingStatus(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="space-y-1">
        <h2 className="font-serif text-2xl font-semibold text-[#2C2A29]">
          Visitor Enquiries
        </h2>
        <p className="text-sm text-[#6E6762]">
          Log walk-in or phone enquiries in seconds and follow up with one click on WhatsApp.
        </p>
      </div>

      {/* Quick Add Enquiry Form (2 input fields + automatic date) */}
      <section className="bg-[#F4EFEA] border border-[#E4DDD5] rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="font-serif text-lg font-semibold text-[#2C2A29]">
              Quick Add Enquiry
            </h3>
            <p className="text-xs text-[#6E6762]">
              Today&apos;s date ({formatReadableDate(getTodayDateString())}) is recorded automatically on save.
            </p>
          </div>
        </div>

        <form
          onSubmit={(e) => void handleQuickAdd(e)}
          className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end"
        >
          <div className="sm:col-span-5 space-y-1.5">
            <Label htmlFor="enquiry-name">Visitor Name</Label>
            <Input
              id="enquiry-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Priya Verma"
              maxLength={120}
              required
              className="bg-[#FDFBF7] border-[#DDD4CA]"
            />
          </div>

          <div className="sm:col-span-4 space-y-1.5">
            <Label htmlFor="enquiry-phone">Phone Number</Label>
            <Input
              id="enquiry-phone"
              type="tel"
              inputMode="numeric"
              value={phone}
              onChange={(e) =>
                setPhone(e.target.value.replace(/\D/g, '').slice(0, 15))
              }
              placeholder="10-digit mobile number"
              maxLength={15}
              required
              className="bg-[#FDFBF7] border-[#DDD4CA] tabular-nums"
            />
          </div>

          <div className="sm:col-span-3">
            <Button
              type="submit"
              disabled={saving}
              className="w-full bg-[#D96B4F] hover:bg-[#C4583D] text-white cursor-pointer whitespace-nowrap"
            >
              <Plus className="size-4 mr-1.5" />
              {saving ? 'Saving...' : 'Save Enquiry'}
            </Button>
          </div>
        </form>
      </section>

      {/* Search Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#F4EFEA] border border-[#E4DDD5] rounded-xl p-3">
        <div className="relative flex-1 max-w-md">
          <Search className="size-4 text-[#6E6762] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search enquiries by name or phone..."
            className="pl-9 bg-[#FDFBF7] border-[#DDD4CA] text-[#2C2A29] placeholder:text-[#6E6762]/70"
          />
        </div>
        <p className="text-xs text-[#6E6762] px-1 tabular-nums">
          {enquiries.length} {enquiries.length === 1 ? 'enquiry' : 'enquiries'} logged
        </p>
      </div>

      {/* Enquiries Table */}
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
        ) : enquiries.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="mx-auto size-11 rounded-lg bg-[#F4EFEA] border border-[#E4DDD5] flex items-center justify-center text-[#D96B4F]">
              <MessageSquarePlus className="size-5" />
            </div>
            <div className="space-y-1 max-w-sm mx-auto">
              <h3 className="font-serif text-lg font-semibold text-[#2C2A29]">
                No enquiries yet
              </h3>
              <p className="text-sm text-[#6E6762]">
                Use the Quick Add Enquiry form above whenever someone visits or calls Success Kar Library.
              </p>
            </div>
          </div>
        ) : filteredEnquiries.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <p className="text-sm text-[#6E6762]">
              No enquiries match your search.
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
                  Name
                </TableHead>
                <TableHead className="text-[#6E6762] font-medium px-4 h-11">
                  Phone
                </TableHead>
                <TableHead className="text-[#6E6762] font-medium px-4 h-11">
                  Date
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
              {filteredEnquiries.map((enquiry) => {
                const status = enquiry.status || 'new';
                return (
                  <TableRow
                    key={enquiry.id}
                    className="border-[#E4DDD5] hover:bg-[#F4EFEA]/60"
                  >
                    <TableCell className="px-4 py-3 font-medium text-[#2C2A29]">
                      {enquiry.name}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-[#2C2A29] tabular-nums">
                      {enquiry.phone}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-sm text-[#6E6762] tabular-nums">
                      {formatReadableDate(enquiry.enquiryDate)}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <span
                        className={cn(
                          'inline-flex items-center px-2 py-0.5 rounded-md border text-xs font-medium',
                          STATUS_STYLES[status]
                        )}
                      >
                        {STATUS_LABELS[status]}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right">
                      <div className="inline-flex items-center justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => handleWhatsAppFollowUp(enquiry)}
                          className="h-8 px-3 bg-[#16A34A] hover:bg-[#15803D] text-white font-medium whitespace-nowrap cursor-pointer"
                        >
                          <MessageCircle className="size-3.5 mr-1.5" />
                          Send WhatsApp
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setViewingEnquiry(enquiry)}
                          className="h-8 px-2.5 border-[#DDD4CA] bg-[#FDFBF7] text-[#2C2A29] hover:bg-[#F4EFEA] cursor-pointer"
                        >
                          <Eye className="size-3.5 mr-1" />
                          View
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* View Enquiry Detail Modal */}
      <Dialog
        open={Boolean(viewingEnquiry)}
        onOpenChange={(open) => {
          if (!open) setViewingEnquiry(null);
        }}
      >
        <DialogContent className="bg-[#FDFBF7] border-[#E4DDD5] text-[#2C2A29] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl text-[#2C2A29]">
              Enquiry Details
            </DialogTitle>
            <DialogDescription className="text-[#6E6762]">
              Update follow-up status or send a polite WhatsApp message.
            </DialogDescription>
          </DialogHeader>

          {viewingEnquiry && (
            <div className="space-y-4">
              <div className="bg-[#F4EFEA] border border-[#E4DDD5] rounded-lg p-4 space-y-3">
                <div>
                  <p className="text-xs text-[#6E6762]">Visitor Name</p>
                  <p className="font-serif text-lg font-semibold text-[#2C2A29]">
                    {viewingEnquiry.name}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="flex items-center gap-2 text-[#2C2A29] tabular-nums">
                    <Phone className="size-3.5 text-[#D96B4F] shrink-0" />
                    <span>{viewingEnquiry.phone}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[#6E6762] tabular-nums">
                    <Calendar className="size-3.5 text-[#D96B4F] shrink-0" />
                    <span>{formatReadableDate(viewingEnquiry.enquiryDate)}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Enquiry Status</Label>
                <Select
                  value={viewingEnquiry.status || 'new'}
                  disabled={updatingStatus}
                  onValueChange={(val) => {
                    if (val === 'new' || val === 'contacted' || val === 'joined') {
                      void handleStatusChange(viewingEnquiry, val);
                    }
                  }}
                >
                  <SelectTrigger className="bg-[#FDFBF7] border-[#DDD4CA] w-full">
                    <SelectValue>
                      {STATUS_LABELS[viewingEnquiry.status || 'new']}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="bg-[#FDFBF7] border-[#E4DDD5]">
                    <SelectItem value="new">New</SelectItem>
                    <SelectItem value="contacted">Contacted</SelectItem>
                    <SelectItem value="joined">Joined</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <DialogFooter className="pt-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setViewingEnquiry(null)}
                  className="border-[#DDD4CA] bg-[#FDFBF7] text-[#2C2A29] hover:bg-[#F4EFEA] cursor-pointer"
                >
                  Close
                </Button>
                <Button
                  type="button"
                  onClick={() => handleWhatsAppFollowUp(viewingEnquiry)}
                  className="bg-[#16A34A] hover:bg-[#15803D] text-white font-medium cursor-pointer"
                >
                  <MessageCircle className="size-4 mr-1.5" />
                  Send WhatsApp
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
