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
import { generateDocId, getDefaultExpiryDate } from '@/lib/formatters';
import type { Student, StudentStatus } from '@/lib/types';
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

const MEMBERSHIP_PRESETS = [
  'Full Day Shift',
  'Morning Shift',
  'Evening Shift',
  'Monthly Pass',
  'Quarterly Pass',
  'Custom',
] as const;

interface StudentFormState {
  name: string;
  phone: string;
  membershipPreset: string;
  customMembership: string;
  membershipExpiry: string;
  status: StudentStatus;
}

const INITIAL_FORM: StudentFormState = {
  name: '',
  phone: '',
  membershipPreset: 'Full Day Shift',
  customMembership: '',
  membershipExpiry: getDefaultExpiryDate(30),
  status: 'active',
};

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
  const [form, setForm] = useState<StudentFormState>(INITIAL_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Student | null>(null);
  const [deleting, setDeleting] = useState(false);

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
      return (
        s.name.toLowerCase().includes(q) ||
        s.phone.toLowerCase().includes(q) ||
        s.membershipType.toLowerCase().includes(q)
      );
    });
  }, [students, searchQuery, statusFilter]);

  const openAddModal = () => {
    setEditingStudent(null);
    setForm({
      ...INITIAL_FORM,
      membershipExpiry: getDefaultExpiryDate(30),
    });
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (student: Student) => {
    const isPreset = MEMBERSHIP_PRESETS.slice(0, -1).includes(
      student.membershipType as (typeof MEMBERSHIP_PRESETS)[number]
    );
    setEditingStudent(student);
    setForm({
      name: student.name,
      phone: student.phone,
      membershipPreset: isPreset ? student.membershipType : 'Custom',
      customMembership: isPreset ? '' : student.membershipType,
      membershipExpiry: student.membershipExpiry,
      status: student.status,
    });
    setFormError(null);
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const name = form.name.trim();
    const phone = form.phone.trim();
    const membershipType = (
      form.membershipPreset === 'Custom' ? form.customMembership : form.membershipPreset
    ).trim();
    const membershipExpiry = form.membershipExpiry.trim();

    if (name.length < 1 || name.length > 120) {
      setFormError('Student name must be between 1 and 120 characters.');
      return;
    }
    if (phone.length < 5 || phone.length > 32) {
      setFormError('Phone number must be between 5 and 32 characters.');
      return;
    }
    if (membershipType.length < 1 || membershipType.length > 64) {
      setFormError('Membership type must be between 1 and 64 characters.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(membershipExpiry)) {
      setFormError('Please select a valid membership expiry date (YYYY-MM-DD).');
      return;
    }

    let success = false;
    setSaving(true);
    try {
      if (editingStudent) {
        const docPath = `students/${editingStudent.id}`;
        try {
          await withTimeout(
            updateDoc(doc(db, 'students', editingStudent.id), {
              name,
              phone,
              membershipType,
              membershipExpiry,
              status: form.status,
              updatedAt: serverTimestamp(),
            })
          );
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
      } else {
        const newId = generateDocId('stu');
        const docPath = `students/${newId}`;
        try {
          await withTimeout(
            setDoc(doc(db, 'students', newId), {
              id: newId,
              name,
              phone,
              membershipType,
              membershipExpiry,
              status: form.status,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
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
                <TableHead className="text-[#6E6762] font-medium px-4 h-11">Membership</TableHead>
                <TableHead className="text-[#6E6762] font-medium px-4 h-11">Status</TableHead>
                <TableHead className="text-[#6E6762] font-medium px-4 h-11 text-right">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredStudents.map((student) => (
                <TableRow
                  key={student.id}
                  className="border-[#E4DDD5] hover:bg-[#F4EFEA]/60"
                >
                  <TableCell className="px-4 py-3 font-medium text-[#2C2A29]">
                    {student.name}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-[#2C2A29] tabular-nums">
                    {student.phone}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-sm text-[#6E6762]">
                    <span className="text-[#2C2A29]">{student.membershipType}</span>
                    <span aria-hidden="true" className="mx-1.5">
                      ·
                    </span>
                    <span className="tabular-nums">Exp {student.membershipExpiry}</span>
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
                    <div className="inline-flex items-center justify-end gap-1">
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
              ))}
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
                ? 'Update student contact details or membership status.'
                : 'Register a walk-in student for library seat bookings.'}
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
              <Label htmlFor="student-phone">Phone Number</Label>
              <Input
                id="student-phone"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="e.g. 9876543210"
                maxLength={32}
                required
                className="bg-[#FDFBF7] border-[#DDD4CA] tabular-nums"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Membership Plan</Label>
                <Select
                  value={form.membershipPreset}
                  onValueChange={(val) => {
                    if (val) setForm((f) => ({ ...f, membershipPreset: val }));
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
                <Label htmlFor="student-expiry">Expiry Date</Label>
                <Input
                  id="student-expiry"
                  type="date"
                  value={form.membershipExpiry}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, membershipExpiry: e.target.value }))
                  }
                  required
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
