'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  Ban,
  CheckCircle2,
  Pencil,
  Plus,
  Search,
  Trash2,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { db, getFirebaseDebugTarget } from '@/lib/firebase';
import { handleFirestoreError, OperationType } from '@/lib/firestore-errors';
import { formatINR, generateDocId, getDefaultExpiryDate } from '@/lib/formatters';
import {
  addOneMonth,
  buildNextMonthRenewalUpdate,
  formatExpiryRemainingLabel,
  formatShortMonthDay,
  getDaysRemaining,
  getStudentFeeAmount,
  getStudentFeeStatus,
  getStudentLastPaymentDate,
  getStudentPhoneForWhatsApp,
  getStudentSubscriptionEndDate,
  getTodayDateString,
  isStudentNextCycleRenewed,
} from '@/lib/reminders';
import type { FeeStatus, Student, StudentGender, StudentStatus } from '@/lib/types';
import { useRemindedToday } from '@/hooks/use-reminded-today';
import { useAdminAuth } from '@/components/admin/admin-auth-context';
import { WhatsAppSendButton } from '@/components/admin/whatsapp-send-button';
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

const MEMBERSHIP_PRESETS = [
  'No Plan',
  'Full Day Shift',
  'Morning Shift',
  'Evening Shift',
  'Monthly Pass',
  'Quarterly Pass',
  'Custom',
] as const;

const GENDER_OPTIONS: readonly StudentGender[] = ['Male', 'Female', 'Other'];

interface StudentFormState {
  name: string;
  whatsappNumber: string;
  gender: StudentGender;
  membershipPreset: string;
  customMembership: string;
  admissionDate: string;
  lastPaymentDate: string;
  currentPeriodEndDate: string;
  feeAmount: string;
  feeStatus: FeeStatus;
  nextCycleRenewed: boolean;
  status: StudentStatus;
}

const PRESET_DEFAULT_FEES: Record<string, string> = {
  'Full Day Shift': '800',
  'Morning Shift': '500',
  'Evening Shift': '800',
  'Monthly Pass': '800',
  'Quarterly Pass': '2200',
};

function createInitialForm(): StudentFormState {
  const today = getTodayDateString();
  return {
    name: '',
    whatsappNumber: '',
    gender: 'Male',
    membershipPreset: 'No Plan',
    customMembership: '',
    admissionDate: today,
    lastPaymentDate: today,
    currentPeriodEndDate: addOneMonth(today),
    feeAmount: '800',
    feeStatus: 'paid',
    nextCycleRenewed: false,
    status: 'active',
  };
}

function withTimeout<T>(promise: Promise<T>, ms = 20000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const target = getFirebaseDebugTarget();
      reject(
        new Error(
          `Firestore write timed out after ${Math.round(ms / 1000)}s (project: "${target.projectId}", database: "${target.databaseId}"). Please verify that Cloud Firestore is enabled in this project and that your network/extensions are not blocking firestore.googleapis.com.`
        )
      );
    }, ms);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function formatFirestoreWriteError(err: unknown): string {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code)
      : '';
  const message = err instanceof Error ? err.message : String(err);

  if (code === 'permission-denied' || message.toLowerCase().includes('permission')) {
    return `Permission Denied (${message})`;
  }
  if (code === 'unavailable' || message.toLowerCase().includes('offline')) {
    return `Firestore Unavailable / Offline (${message})`;
  }
  return code ? `${code}: ${message}` : message;
}

export default function StudentsPage() {
  const { user, adminProfile } = useAdminAuth();
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | StudentStatus>('all');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [form, setForm] = useState<StudentFormState>(createInitialForm);
  const [periodEndOverridden, setPeriodEndOverridden] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [renewingId, setRenewingId] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Student | null>(null);
  const [deleting, setDeleting] = useState(false);

  const today = useMemo(() => getDefaultExpiryDate(0), []);
  const { remindedIds, markReminded: handleMarkReminded } = useRemindedToday(today);

  useEffect(() => {
    if (!user || !adminProfile) return;

    const path = 'students';
    const unsub = onSnapshot(
      collection(db, path),
      (snapshot) => {
        const list = snapshot.docs.map((d) => d.data() as Student);
        list.sort((a, b) => a.name.localeCompare(b.name));
        setStudents(list);
        setLoadError(null);
        setLoading(false);
      },
      (error) => {
        const msg = formatFirestoreWriteError(error);
        console.error('Failed to load students from Firestore:', msg, error);
        setLoadError(`Failed to load students: ${msg}`);
        setLoading(false);
        try {
          handleFirestoreError(error, OperationType.LIST, path);
        } catch {
          // Structured error logged to console above
        }
      }
    );

    return () => unsub();
  }, [user, adminProfile]);

  const filteredStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return students.filter((s) => {
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      if (!q) return true;
      const phone = getStudentPhoneForWhatsApp(s).toLowerCase();
      const plan = (s.membershipType || '').toLowerCase();
      return (
        s.name.toLowerCase().includes(q) ||
        phone.includes(q) ||
        plan.includes(q)
      );
    });
  }, [students, searchQuery, statusFilter]);

  const openAddModal = () => {
    setEditingStudent(null);
    setForm(createInitialForm());
    setPeriodEndOverridden(false);
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (student: Student) => {
    const rawPlan = (student.membershipType || '').trim();
    const isPreset =
      rawPlan.length > 0 &&
      MEMBERSHIP_PRESETS.slice(1, -1).includes(
        rawPlan as (typeof MEMBERSHIP_PRESETS)[number]
      );
    const existingEnd = getStudentSubscriptionEndDate(student);
    const existingLastPaid = getStudentLastPaymentDate(student) || today;
    const existingAdmission = student.admissionDate || existingLastPaid;

    setEditingStudent(student);
    setForm({
      name: student.name,
      whatsappNumber: getStudentPhoneForWhatsApp(student),
      gender:
        student.gender === 'Female' || student.gender === 'Other'
          ? student.gender
          : 'Male',
      membershipPreset: !rawPlan ? 'No Plan' : isPreset ? rawPlan : 'Custom',
      customMembership: !rawPlan || isPreset ? '' : rawPlan,
      admissionDate: existingAdmission,
      lastPaymentDate: existingLastPaid,
      currentPeriodEndDate: existingEnd || '',
      feeAmount:
        typeof student.feeAmount === 'number' ? String(student.feeAmount) : '800',
      feeStatus: getStudentFeeStatus(student),
      nextCycleRenewed: isStudentNextCycleRenewed(student),
      status: student.status,
    });
    setPeriodEndOverridden(
      Boolean(existingEnd && existingEnd !== addOneMonth(existingLastPaid))
    );
    setFormError(null);
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const name = form.name.trim();
    const rawDigits = form.whatsappNumber.replace(/\D/g, '');

    if (name.length < 1 || name.length > 120) {
      setFormError('Full Name must be between 1 and 120 characters.');
      return;
    }

    if (!editingStudent) {
      if (!/^\d{10}$/.test(rawDigits)) {
        setFormError('WhatsApp Number must be a valid 10-digit number.');
        return;
      }

      let success = false;
      setSaving(true);
      try {
        const newId = generateDocId('stu');
        const docPath = `students/${newId}`;
        try {
          await withTimeout(
            setDoc(doc(db, 'students', newId), {
              id: newId,
              name,
              whatsappNumber: rawDigits,
              gender: form.gender,
              status: 'active',
              createdAt: serverTimestamp(),
            })
          );
          toast.success(`Added ${name} to directory`);
          success = true;
        } catch (err) {
          console.error('Firestore setDoc failed on students:', err);
          try {
            handleFirestoreError(err, OperationType.CREATE, docPath);
          } catch {
            // Structured error already logged
          }
          throw err;
        }
      } catch (err) {
        const exactError = formatFirestoreWriteError(err);
        console.error('Failed to save student:', exactError, err);
        const displayMsg = `Failed to save student: ${exactError}`;
        setFormError(displayMsg);
        toast.error(displayMsg);
      } finally {
        setSaving(false);
        if (success) {
          setModalOpen(false);
        }
      }
      return;
    }

    // Editing an existing student (supports updating basic details and assigning/updating plan & billing)
    if (rawDigits.length !== 10 && !(rawDigits.length > 10 && rawDigits.length <= 15)) {
      setFormError('WhatsApp Number must be a valid 10-digit number.');
      return;
    }

    const hasPlan = form.membershipPreset !== 'No Plan';
    const membershipType = hasPlan
      ? (
          form.membershipPreset === 'Custom'
            ? form.customMembership
            : form.membershipPreset
        ).trim()
      : '';
    const admissionDate = form.admissionDate.trim();
    const lastPaymentDate = form.lastPaymentDate.trim();
    const currentPeriodEndDate = form.currentPeriodEndDate.trim();
    const parsedFee = Number(form.feeAmount);

    if (hasPlan && (membershipType.length < 1 || membershipType.length > 64)) {
      setFormError('Membership type must be between 1 and 64 characters.');
      return;
    }
    if (admissionDate && !/^\d{4}-\d{2}-\d{2}$/.test(admissionDate)) {
      setFormError('Admission date must be YYYY-MM-DD.');
      return;
    }
    if (lastPaymentDate && !/^\d{4}-\d{2}-\d{2}$/.test(lastPaymentDate)) {
      setFormError('Last payment date must be YYYY-MM-DD.');
      return;
    }
    if (currentPeriodEndDate && !/^\d{4}-\d{2}-\d{2}$/.test(currentPeriodEndDate)) {
      setFormError('Current period end date must be YYYY-MM-DD.');
      return;
    }
    if (hasPlan && !currentPeriodEndDate) {
      setFormError('Please select a Current Period End date for the assigned plan.');
      return;
    }
    if (hasPlan && (Number.isNaN(parsedFee) || parsedFee < 0 || parsedFee > 100000)) {
      setFormError('Fee amount must be between ₹0 and ₹1,00,000.');
      return;
    }

    let success = false;
    setSaving(true);
    try {
      const docPath = `students/${editingStudent.id}`;
      const updatePayload: Record<string, unknown> = {
        name,
        whatsappNumber: rawDigits,
        phone: rawDigits,
        gender: form.gender,
        status: form.status,
        updatedAt: serverTimestamp(),
      };

      if (hasPlan || currentPeriodEndDate) {
        updatePayload.membershipType = membershipType;
        updatePayload.admissionDate = admissionDate;
        updatePayload.lastPaymentDate = lastPaymentDate;
        updatePayload.currentPeriodEndDate = currentPeriodEndDate;
        updatePayload.membershipExpiry = currentPeriodEndDate;
        updatePayload.subscriptionEndDate = currentPeriodEndDate;
        updatePayload.feeAmount = parsedFee;
        updatePayload.feeStatus = form.feeStatus;
        updatePayload.nextCycleRenewed = form.nextCycleRenewed;
      } else if (editingStudent.membershipType || editingStudent.currentPeriodEndDate) {
        updatePayload.membershipType = '';
        updatePayload.currentPeriodEndDate = '';
        updatePayload.membershipExpiry = '';
        updatePayload.subscriptionEndDate = '';
      }

      try {
        await withTimeout(updateDoc(doc(db, 'students', editingStudent.id), updatePayload));
        toast.success(`Updated ${name}`);
        success = true;
      } catch (err) {
        console.error('Firestore updateDoc failed on students:', err);
        try {
          handleFirestoreError(err, OperationType.UPDATE, docPath);
        } catch {
          // Structured error already logged
        }
        throw err;
      }
    } catch (err) {
      const exactError = formatFirestoreWriteError(err);
      console.error('Failed to save student:', exactError, err);
      const displayMsg = `Failed to save student: ${exactError}`;
      setFormError(displayMsg);
      toast.error(displayMsg);
    } finally {
      setSaving(false);
      if (success) {
        setModalOpen(false);
      }
    }
  };

  const handleRenewNextMonth = async (student: Student) => {
    setRenewingId(student.id);
    const docPath = `students/${student.id}`;
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
      const msg = formatFirestoreWriteError(err);
      console.error('Failed to renew student next month:', err);
      try {
        handleFirestoreError(err, OperationType.UPDATE, docPath);
      } catch {
        // logged
      }
      toast.error(`Failed to renew: ${msg}`);
    } finally {
      setRenewingId(null);
    }
  };

  const handleToggleStatus = async (student: Student) => {
    const nextStatus: StudentStatus = student.status === 'active' ? 'blocked' : 'active';
    const docPath = `students/${student.id}`;
    try {
      await updateDoc(doc(db, 'students', student.id), {
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });
      toast.success(
        nextStatus === 'active'
          ? `${student.name} marked Active`
          : `${student.name} marked Blocked`
      );
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, docPath);
      } catch {
        toast.error('Failed to update student status');
      }
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const docPath = `students/${deleteTarget.id}`;
    try {
      await deleteDoc(doc(db, 'students', deleteTarget.id));
      toast.success(`Removed ${deleteTarget.name}`);
      setDeleteTarget(null);
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.DELETE, docPath);
      } catch {
        toast.error('Failed to delete student');
      }
    } finally {
      setDeleting(false);
    }
  };

  const activeCount = students.filter((s) => s.status === 'active').length;
  const blockedCount = students.filter((s) => s.status === 'blocked').length;

  return (
    <div className="space-y-6">
      {/* Header & Primary Action */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 className="font-serif text-2xl font-semibold text-[#2C2A29]">
            Student Directory
          </h2>
          <p className="text-sm text-[#6E6762] tabular-nums">
            {students.length} total members · {activeCount} active · {blockedCount} blocked
          </p>
        </div>

        <Button
          onClick={openAddModal}
          className="bg-[#D9775B] hover:bg-[#C46348] text-[#FDFBF7] whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="size-4 mr-1.5" />
          Add Student
        </Button>
      </div>

      {loadError && (
        <div
          role="alert"
          className="bg-[#F4EFEA] border border-[#C25E5E] rounded-xl p-4 text-sm text-[#C25E5E]"
        >
          {loadError}
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[#F4EFEA] border border-[#E4DDD5] rounded-xl p-3">
        <div className="relative flex-1 max-w-md">
          <Search className="size-4 text-[#6E6762] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by student name, phone, or plan..."
            className="pl-9 bg-[#FDFBF7] border-[#DDD4CA] text-[#2C2A29] placeholder:text-[#6E6762]/70"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#EAE2D9] rounded-lg self-start sm:self-auto">
          {(['all', 'active', 'blocked'] as const).map((filterVal) => (
            <button
              key={filterVal}
              type="button"
              onClick={() => setStatusFilter(filterVal)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize cursor-pointer whitespace-nowrap',
                statusFilter === filterVal
                  ? 'bg-[#FDFBF7] text-[#2C2A29] shadow-xs'
                  : 'text-[#6E6762] hover:text-[#2C2A29]'
              )}
            >
              {filterVal}
            </button>
          ))}
        </div>
      </div>

      {/* Table / Empty / Loading States */}
      <div className="bg-[#FDFBF7] border border-[#E4DDD5] rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3, 4].map((row) => (
              <div
                key={row}
                className="h-11 rounded-md bg-[#F4EFEA] animate-pulse"
              />
            ))}
          </div>
        ) : students.length === 0 ? (
          <div className="p-12 text-center space-y-4">
            <div className="mx-auto size-11 rounded-lg bg-[#F4EFEA] border border-[#E4DDD5] flex items-center justify-center text-[#D9775B]">
              <Users className="size-5" />
            </div>
            <div className="space-y-1 max-w-sm mx-auto">
              <h3 className="font-serif text-lg font-semibold text-[#2C2A29]">
                No students registered yet
              </h3>
              <p className="text-sm text-[#6E6762]">
                Add library members here so librarians can quickly select them during counter
                seat bookings.
              </p>
            </div>
            <Button
              onClick={openAddModal}
              className="bg-[#D9775B] hover:bg-[#C46348] text-[#FDFBF7] cursor-pointer"
            >
              <Plus className="size-4 mr-1.5" />
              Add First Student
            </Button>
          </div>
        ) : filteredStudents.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <p className="text-sm text-[#6E6762]">
              No students match your current search or filter.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearchQuery('');
                setStatusFilter('all');
              }}
              className="border-[#DDD4CA] bg-[#FDFBF7] text-[#2C2A29] hover:bg-[#F4EFEA] cursor-pointer"
            >
              Clear Filters
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader className="bg-[#F4EFEA]">
              <TableRow className="border-[#E4DDD5] hover:bg-[#F4EFEA]">
                <TableHead className="text-[#6E6762] font-medium px-4 h-11">Name</TableHead>
                <TableHead className="text-[#6E6762] font-medium px-4 h-11">Phone</TableHead>
                <TableHead className="text-[#6E6762] font-medium px-4 h-11">Subscription</TableHead>
                <TableHead className="text-[#6E6762] font-medium px-4 h-11">Fee</TableHead>
                <TableHead className="text-[#6E6762] font-medium px-4 h-11">Status</TableHead>
                <TableHead className="text-[#6E6762] font-medium px-4 h-11 text-right">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredStudents.map((student) => {
                const displayPhone = getStudentPhoneForWhatsApp(student);
                const endDate = getStudentSubscriptionEndDate(student);
                const lastPaid = getStudentLastPaymentDate(student);
                const daysRemaining = getDaysRemaining(endDate, today);
                const hasPlanOrFee =
                  Boolean(endDate) ||
                  Boolean(student.membershipType) ||
                  typeof student.feeAmount === 'number';
                const feeAmount = getStudentFeeAmount(student);
                const feeStatus = getStudentFeeStatus(student);
                const cycleRenewed = isStudentNextCycleRenewed(student);
                const isDueSoon =
                  daysRemaining !== null && daysRemaining <= 3 && !cycleRenewed;
                const isRemindedToday =
                  student.lastRemindedDate === today || remindedIds.has(student.id);

                return (
                  <TableRow
                    key={student.id}
                    className="border-[#E4DDD5] hover:bg-[#F4EFEA]/60"
                  >
                    <TableCell className="px-4 py-3 font-medium text-[#2C2A29]">
                      <div className="flex flex-col gap-0.5">
                        <span>{student.name}</span>
                        {student.gender && (
                          <span className="text-xs font-normal text-[#6E6762]">
                            {student.gender}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-[#2C2A29] tabular-nums">
                      {displayPhone || '—'}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-sm text-[#6E6762]">
                      {!student.membershipType && !endDate ? (
                        <span className="text-xs text-[#6E6762]">No plan assigned</span>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          <div>
                            <span className="text-[#2C2A29]">
                              {student.membershipType || 'Monthly Plan'}
                            </span>
                            {endDate && (
                              <>
                                <span aria-hidden="true" className="mx-1.5">
                                  ·
                                </span>
                                <span className="tabular-nums">
                                  Ends {formatShortMonthDay(endDate)}
                                </span>
                              </>
                            )}
                          </div>
                          {lastPaid && (
                            <span className="text-xs text-[#6E6762] tabular-nums">
                              Last paid {formatShortMonthDay(lastPaid)} ({lastPaid})
                            </span>
                          )}
                          {isDueSoon && daysRemaining !== null && (
                            <span
                              className={cn(
                                'text-xs font-medium',
                                daysRemaining <= 0 ? 'text-[#C25E5E]' : 'text-[#D9775B]'
                              )}
                            >
                              {formatExpiryRemainingLabel(daysRemaining)} · Renewal due
                            </span>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-sm tabular-nums">
                      {!hasPlanOrFee ? (
                        <span className="text-xs text-[#6E6762]">Not set</span>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium text-[#2C2A29]">
                            {formatINR(feeAmount)}
                          </span>
                          <span
                            className={cn(
                              'text-xs font-medium capitalize',
                              isDueSoon
                                ? 'text-[#D9775B]'
                                : feeStatus === 'paid'
                                  ? 'text-[#597752]'
                                  : 'text-[#D9775B]'
                            )}
                          >
                            {isDueSoon ? 'Next month due' : feeStatus}
                          </span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      {student.status === 'active' ? (
                        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[#597752]">
                          <CheckCircle2 className="size-3.5 text-[#7D9B76]" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[#C25E5E]">
                          <Ban className="size-3.5 text-[#C25E5E]" />
                          Blocked
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right">
                      <div className="inline-flex items-center justify-end gap-1.5 flex-wrap">
                        {isDueSoon && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={renewingId === student.id}
                            onClick={() => void handleRenewNextMonth(student)}
                            className="h-8 px-2.5 text-xs border-[#DDD4CA] bg-[#FDFBF7] text-[#2C2A29] hover:bg-[#F4EFEA] cursor-pointer whitespace-nowrap"
                          >
                            {renewingId === student.id
                              ? 'Renewing...'
                              : 'Renew Next Month'}
                          </Button>
                        )}
                        <WhatsAppSendButton
                          student={student}
                          todayStr={today}
                          remindedToday={isRemindedToday}
                          onReminded={handleMarkReminded}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditModal(student)}
                          className="h-8 px-2.5 text-[#2C2A29] hover:bg-[#EAE2D9] cursor-pointer"
                          title="Edit student"
                        >
                          <Pencil className="size-3.5 mr-1" />
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleToggleStatus(student)}
                          className="h-8 px-2.5 text-[#6E6762] hover:text-[#2C2A29] hover:bg-[#EAE2D9] cursor-pointer"
                        >
                          {student.status === 'active' ? 'Block' : 'Activate'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteTarget(student)}
                          className="h-8 px-2 text-[#C25E5E] hover:text-[#C25E5E] hover:bg-[#C25E5E]/10 cursor-pointer"
                          aria-label={`Delete ${student.name}`}
                        >
                          <Trash2 className="size-3.5" />
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

      {/* Add / Edit Student Dialog */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="bg-[#FDFBF7] border-[#E4DDD5] text-[#2C2A29] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl text-[#2C2A29]">
              {editingStudent ? 'Edit Student' : 'Add New Student'}
            </DialogTitle>
            <DialogDescription className="text-[#6E6762]">
              {editingStudent
                ? 'Update student contact details, plan, or billing cycle.'
                : 'Register a student with basic contact details.'}
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
              <Label htmlFor="student-name">Full Name</Label>
              <Input
                id="student-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Aarav Sharma"
                maxLength={120}
                required
                className="bg-[#FDFBF7] border-[#DDD4CA]"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="student-whatsapp">WhatsApp Number</Label>
              <Input
                id="student-whatsapp"
                type="tel"
                inputMode="numeric"
                value={form.whatsappNumber}
                onChange={(e) => {
                  const digitsOnly = e.target.value.replace(/\D/g, '').slice(0, editingStudent ? 15 : 10);
                  setForm((f) => ({ ...f, whatsappNumber: digitsOnly }));
                }}
                placeholder="10-digit WhatsApp number (e.g. 9876543210)"
                maxLength={editingStudent ? 15 : 10}
                required
                className="bg-[#FDFBF7] border-[#DDD4CA] tabular-nums"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Gender</Label>
              <Select
                value={form.gender}
                onValueChange={(val) => {
                  if (val === 'Male' || val === 'Female' || val === 'Other') {
                    setForm((f) => ({ ...f, gender: val }));
                  }
                }}
              >
                <SelectTrigger className="bg-[#FDFBF7] border-[#DDD4CA] w-full">
                  <SelectValue placeholder="Select gender" />
                </SelectTrigger>
                <SelectContent className="bg-[#FDFBF7] border-[#E4DDD5]">
                  {GENDER_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {editingStudent && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Membership Plan</Label>
                    <Select
                      value={form.membershipPreset}
                      onValueChange={(val) => {
                        if (!val) return;
                        setForm((f) => {
                          const nextLastPaid = f.lastPaymentDate || today;
                          return {
                            ...f,
                            membershipPreset: val,
                            lastPaymentDate: nextLastPaid,
                            currentPeriodEndDate:
                              val === 'No Plan'
                                ? ''
                                : f.currentPeriodEndDate || addOneMonth(nextLastPaid),
                            feeAmount: PRESET_DEFAULT_FEES[val] || f.feeAmount,
                          };
                        });
                      }}
                    >
                      <SelectTrigger className="bg-[#FDFBF7] border-[#DDD4CA] w-full">
                        <SelectValue placeholder="Select plan" />
                      </SelectTrigger>
                      <SelectContent className="bg-[#FDFBF7] border-[#E4DDD5]">
                        {MEMBERSHIP_PRESETS.map((preset) => (
                          <SelectItem key={preset} value={preset}>
                            {preset}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="student-admission-date">Admission Date</Label>
                    <Input
                      id="student-admission-date"
                      type="date"
                      value={form.admissionDate}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, admissionDate: e.target.value }))
                      }
                      className="bg-[#FDFBF7] border-[#DDD4CA] tabular-nums"
                    />
                  </div>
                </div>

                {form.membershipPreset === 'Custom' && (
                  <div className="space-y-1.5">
                    <Label htmlFor="custom-membership">Custom Plan Name</Label>
                    <Input
                      id="custom-membership"
                      value={form.customMembership}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, customMembership: e.target.value }))
                      }
                      placeholder="e.g. Annual Reading Pass"
                      maxLength={64}
                      required
                      className="bg-[#FDFBF7] border-[#DDD4CA]"
                    />
                  </div>
                )}

                {form.membershipPreset !== 'No Plan' && (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="student-last-payment">Last Payment Date</Label>
                        <Input
                          id="student-last-payment"
                          type="date"
                          value={form.lastPaymentDate}
                          onChange={(e) => {
                            const nextPaid = e.target.value;
                            setForm((f) => ({
                              ...f,
                              lastPaymentDate: nextPaid,
                              currentPeriodEndDate:
                                !periodEndOverridden && nextPaid
                                  ? addOneMonth(nextPaid)
                                  : f.currentPeriodEndDate,
                            }));
                          }}
                          className="bg-[#FDFBF7] border-[#DDD4CA] tabular-nums"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <Label htmlFor="student-expiry">Current Period End</Label>
                          {periodEndOverridden && form.lastPaymentDate ? (
                            <button
                              type="button"
                              onClick={() => {
                                setPeriodEndOverridden(false);
                                setForm((f) => ({
                                  ...f,
                                  currentPeriodEndDate: addOneMonth(f.lastPaymentDate),
                                }));
                              }}
                              className="text-[11px] font-medium text-[#D9775B] hover:underline cursor-pointer"
                            >
                              Auto +1 mo
                            </button>
                          ) : (
                            <span className="text-[11px] text-[#6E6762]">Auto +1 mo</span>
                          )}
                        </div>
                        <Input
                          id="student-expiry"
                          type="date"
                          value={form.currentPeriodEndDate}
                          onChange={(e) => {
                            setPeriodEndOverridden(true);
                            setForm((f) => ({
                              ...f,
                              currentPeriodEndDate: e.target.value,
                            }));
                          }}
                          required
                          className="bg-[#FDFBF7] border-[#DDD4CA] tabular-nums"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="student-fee-amount">Monthly Fee (₹)</Label>
                        <Input
                          id="student-fee-amount"
                          type="number"
                          min={0}
                          max={100000}
                          step={1}
                          value={form.feeAmount}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, feeAmount: e.target.value }))
                          }
                          placeholder="800"
                          required
                          className="bg-[#FDFBF7] border-[#DDD4CA] tabular-nums"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label>Current Period Fee</Label>
                        <Select
                          value={form.feeStatus}
                          onValueChange={(val) => {
                            if (val === 'paid' || val === 'pending') {
                              setForm((f) => ({ ...f, feeStatus: val }));
                            }
                          }}
                        >
                          <SelectTrigger className="bg-[#FDFBF7] border-[#DDD4CA] w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-[#FDFBF7] border-[#E4DDD5]">
                            <SelectItem value="paid">Paid</SelectItem>
                            <SelectItem value="pending">Pending</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                  <div className="space-y-1.5">
                    <Label>Account Status</Label>
                    <Select
                      value={form.status}
                      onValueChange={(val) => {
                        if (val === 'active' || val === 'blocked') {
                          setForm((f) => ({ ...f, status: val }));
                        }
                      }}
                    >
                      <SelectTrigger className="bg-[#FDFBF7] border-[#DDD4CA] w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-[#FDFBF7] border-[#E4DDD5]">
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="blocked">Blocked</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {form.membershipPreset !== 'No Plan' && (
                    <label className="flex items-center gap-2 h-9 px-3 rounded-md border border-[#DDD4CA] bg-[#F4EFEA]/60 text-xs text-[#2C2A29] cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={form.nextCycleRenewed}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            nextCycleRenewed: e.target.checked,
                          }))
                        }
                        className="accent-[#D9775B] size-3.5"
                      />
                      <span>Next cycle already renewed</span>
                    </label>
                  )}
                </div>
              </>
            )}

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setModalOpen(false)}
                className="border-[#DDD4CA] bg-[#FDFBF7] text-[#2C2A29] hover:bg-[#F4EFEA] cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={saving}
                className="bg-[#D9775B] hover:bg-[#C46348] text-[#FDFBF7] cursor-pointer"
              >
                {saving
                  ? 'Saving...'
                  : editingStudent
                    ? 'Save Changes'
                    : 'Create Student'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent className="bg-[#FDFBF7] border-[#E4DDD5] text-[#2C2A29] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-serif text-lg">Remove Student</DialogTitle>
            <DialogDescription className="text-[#6E6762]">
              Remove <span className="font-medium text-[#2C2A29]">{deleteTarget?.name}</span>{' '}
              from the student directory? Existing historical bookings remain in the ledger.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              className="border-[#DDD4CA] bg-[#FDFBF7] text-[#2C2A29] cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={deleting}
              onClick={() => void handleDelete()}
              className="bg-[#C25E5E] hover:bg-[#A94E4E] text-[#FDFBF7] cursor-pointer"
            >
              {deleting ? 'Removing...' : 'Remove'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
