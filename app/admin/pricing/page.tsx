'use client';

import React, { useEffect, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { Clock, Layers, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/lib/firebase';
import { handleFirestoreError, OperationType } from '@/lib/firestore-errors';
import { formatINR, formatTime12h, generateDocId } from '@/lib/formatters';
import type { Category, TimeSlot } from '@/lib/types';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

const WARM_SWATCHES = [
  { hex: '#D9775B', label: 'Terracotta' },
  { hex: '#7D9B76', label: 'Sage' },
  { hex: '#C89B54', label: 'Ochre' },
  { hex: '#647A8E', label: 'Slate' },
  { hex: '#8C6B78', label: 'Plum' },
  { hex: '#A8644C', label: 'Clay' },
  { hex: '#5B8A72', label: 'Eucalyptus' },
  { hex: '#C25E5E', label: 'Brick' },
];

const DEFAULT_SHIFT_PRESETS = [
  {
    id: 'slot_full_day',
    name: 'Full Day Shift',
    startTime: '08:00',
    endTime: '20:00',
    price: 800,
  },
  {
    id: 'slot_morning',
    name: 'Morning Shift',
    startTime: '08:00',
    endTime: '14:00',
    price: 500,
  },
  {
    id: 'slot_evening',
    name: 'Evening Shift',
    startTime: '14:00',
    endTime: '20:00',
    price: 800,
  },
];

const DEFAULT_CATEGORY_PRESETS = [
  {
    id: 'cat_standard',
    name: 'Standard Desk',
    colorHex: '#7D9B76',
    price: 500,
  },
  {
    id: 'cat_premium',
    name: 'Premium Cabin',
    colorHex: '#D9775B',
    price: 800,
  },
];

export default function PricingPage() {
  const { user, adminProfile } = useAdminAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [loadingCats, setLoadingCats] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(true);

  // Category modal state
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<Category | null>(null);
  const [catName, setCatName] = useState('');
  const [catColor, setCatColor] = useState('#D9775B');
  const [catPrice, setCatPrice] = useState('500');
  const [catError, setCatError] = useState<string | null>(null);
  const [savingCat, setSavingCat] = useState(false);

  // Time Slot modal state
  const [slotModalOpen, setSlotModalOpen] = useState(false);
  const [editingSlot, setEditingSlot] = useState<TimeSlot | null>(null);
  const [slotName, setSlotName] = useState('');
  const [slotStart, setSlotStart] = useState('08:00');
  const [slotEnd, setSlotEnd] = useState('14:00');
  const [slotPrice, setSlotPrice] = useState('500');
  const [slotError, setSlotError] = useState<string | null>(null);
  const [savingSlot, setSavingSlot] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<{
    type: 'category' | 'slot';
    id: string;
    name: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [seeding, setSeeding] = useState(false);

  useEffect(() => {
    if (!user || !adminProfile) return;

    const unsubCats = onSnapshot(
      collection(db, 'categories'),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as Category);
        list.sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));
        setCategories(list);
        setLoadingCats(false);
      },
      (err) => {
        setLoadingCats(false);
        handleFirestoreError(err, OperationType.LIST, 'categories');
      }
    );

    const unsubSlots = onSnapshot(
      collection(db, 'time_slots'),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as TimeSlot);
        list.sort((a, b) => a.startTime.localeCompare(b.startTime));
        setSlots(list);
        setLoadingSlots(false);
      },
      (err) => {
        setLoadingSlots(false);
        handleFirestoreError(err, OperationType.LIST, 'time_slots');
      }
    );

    return () => {
      unsubCats();
      unsubSlots();
    };
  }, [user, adminProfile]);

  const openAddCategory = () => {
    setEditingCat(null);
    setCatName('');
    setCatColor('#D9775B');
    setCatPrice('500');
    setCatError(null);
    setCatModalOpen(true);
  };

  const openEditCategory = (cat: Category) => {
    setEditingCat(cat);
    setCatName(cat.name);
    setCatColor(cat.colorHex);
    setCatPrice(String(cat.price));
    setCatError(null);
    setCatModalOpen(true);
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    setCatError(null);

    const name = catName.trim();
    const colorHex = catColor.trim().toUpperCase();
    const price = Number(catPrice);

    if (name.length < 1 || name.length > 64) {
      setCatError('Category name must be between 1 and 64 characters.');
      return;
    }
    if (!/^#[0-9A-F]{6}$/.test(colorHex)) {
      setCatError('Choose a valid 6-digit hex color (e.g. #D9775B).');
      return;
    }
    if (!Number.isFinite(price) || price < 0 || price > 100000) {
      setCatError('Price must be between 0 and 100,000.');
      return;
    }

    setSavingCat(true);
    try {
      if (editingCat) {
        const path = `categories/${editingCat.id}`;
        try {
          await updateDoc(doc(db, 'categories', editingCat.id), {
            name,
            colorHex,
            price,
            updatedAt: serverTimestamp(),
          });
          toast.success(`Updated category "${name}"`);
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, path);
        }
      } else {
        const newId = generateDocId('cat');
        const path = `categories/${newId}`;
        try {
          await setDoc(doc(db, 'categories', newId), {
            id: newId,
            name,
            colorHex,
            price,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          toast.success(`Created category "${name}"`);
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, path);
        }
      }
      setCatModalOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to save category.';
      setCatError(msg);
      toast.error('Could not save category');
    } finally {
      setSavingCat(false);
    }
  };

  const openAddSlot = () => {
    setEditingSlot(null);
    setSlotName('');
    setSlotStart('08:00');
    setSlotEnd('14:00');
    setSlotPrice('500');
    setSlotError(null);
    setSlotModalOpen(true);
  };

  const openEditSlot = (slot: TimeSlot) => {
    setEditingSlot(slot);
    setSlotName(slot.name);
    setSlotStart(slot.startTime);
    setSlotEnd(slot.endTime);
    setSlotPrice(slot.price !== undefined ? String(slot.price) : '0');
    setSlotError(null);
    setSlotModalOpen(true);
  };

  const handleSaveSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    setSlotError(null);

    const name = slotName.trim();
    const startTime = slotStart.trim();
    const endTime = slotEnd.trim();
    const price = Number(slotPrice);

    if (name.length < 1 || name.length > 64) {
      setSlotError('Shift name must be between 1 and 64 characters.');
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
      setSlotError('Please enter valid start and end times (HH:MM).');
      return;
    }
    if (startTime >= endTime) {
      setSlotError('End time must be after start time.');
      return;
    }
    if (!Number.isFinite(price) || price < 0 || price > 100000) {
      setSlotError('Shift fee must be between 0 and 100,000.');
      return;
    }

    setSavingSlot(true);
    try {
      if (editingSlot) {
        const path = `time_slots/${editingSlot.id}`;
        try {
          await updateDoc(doc(db, 'time_slots', editingSlot.id), {
            name,
            startTime,
            endTime,
            price,
            updatedAt: serverTimestamp(),
          });
          toast.success(`Updated "${name}"`);
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, path);
        }
      } else {
        const newId = generateDocId('slot');
        const path = `time_slots/${newId}`;
        try {
          await setDoc(doc(db, 'time_slots', newId), {
            id: newId,
            name,
            startTime,
            endTime,
            price,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          toast.success(`Added shift "${name}"`);
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, path);
        }
      }
      setSlotModalOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to save time slot.';
      setSlotError(msg);
      toast.error('Could not save time slot');
    } finally {
      setSavingSlot(false);
    }
  };

  const handleLoadShiftPresets = async () => {
    setSeeding(true);
    try {
      const existingIds = new Set(slots.map((s) => s.id));
      const toCreate = DEFAULT_SHIFT_PRESETS.filter((p) => !existingIds.has(p.id));
      if (toCreate.length === 0) {
        toast.info('Default shift plan is already loaded');
        return;
      }
      const batch = writeBatch(db);
      for (const preset of toCreate) {
        batch.set(doc(db, 'time_slots', preset.id), {
          id: preset.id,
          name: preset.name,
          startTime: preset.startTime,
          endTime: preset.endTime,
          price: preset.price,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
      toast.success('Loaded Success Kar Library shift plan');
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.WRITE, 'time_slots');
      } catch {
        toast.error('Could not load default shift plan');
      }
    } finally {
      setSeeding(false);
    }
  };

  const handleLoadCategoryPresets = async () => {
    setSeeding(true);
    try {
      const existingIds = new Set(categories.map((c) => c.id));
      const toCreate = DEFAULT_CATEGORY_PRESETS.filter((p) => !existingIds.has(p.id));
      if (toCreate.length === 0) {
        toast.info('Default seat categories are already loaded');
        return;
      }
      const batch = writeBatch(db);
      for (const preset of toCreate) {
        batch.set(doc(db, 'categories', preset.id), {
          id: preset.id,
          name: preset.name,
          colorHex: preset.colorHex,
          price: preset.price,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
      toast.success('Loaded Standard & Premium seat tiers');
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.WRITE, 'categories');
      } catch {
        toast.error('Could not load default seat categories');
      }
    } finally {
      setSeeding(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const col = deleteTarget.type === 'category' ? 'categories' : 'time_slots';
    const path = `${col}/${deleteTarget.id}`;
    try {
      await deleteDoc(doc(db, col, deleteTarget.id));
      toast.success(`Deleted "${deleteTarget.name}"`);
      setDeleteTarget(null);
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.DELETE, path);
      } catch {
        toast.error('Failed to delete item');
      }
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-10">
      {/* Section 1: Shifts & Time Slots */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="space-y-1">
            <h2 className="font-serif text-2xl font-semibold text-[#2C2A29]">
              Shifts &amp; Time Slots
            </h2>
            <p className="text-sm text-[#6E6762]">
              Define daily booking shifts, operating hours, and shift fees for Success Kar Library.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {slots.length === 0 && !loadingSlots && (
              <Button
                variant="outline"
                disabled={seeding}
                onClick={() => void handleLoadShiftPresets()}
                className="border-[#DDD4CA] bg-[#FDFBF7] text-[#2C2A29] hover:bg-[#F4EFEA] cursor-pointer whitespace-nowrap"
              >
                <Sparkles className="size-4 mr-1.5 text-[#D9775B]" />
                Load Shift Plan
              </Button>
            )}
            <Button
              onClick={openAddSlot}
              className="bg-[#D9775B] hover:bg-[#C46348] text-[#FDFBF7] cursor-pointer whitespace-nowrap"
            >
              <Plus className="size-4 mr-1.5" />
              Add Shift
            </Button>
          </div>
        </div>

        <div className="bg-[#FDFBF7] border border-[#E4DDD5] rounded-xl overflow-hidden">
          {loadingSlots ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((row) => (
                <div key={row} className="h-11 rounded-md bg-[#F4EFEA] animate-pulse" />
              ))}
            </div>
          ) : slots.length === 0 ? (
            <div className="p-10 text-center space-y-4">
              <div className="mx-auto size-11 rounded-lg bg-[#F4EFEA] border border-[#E4DDD5] flex items-center justify-center text-[#D9775B]">
                <Clock className="size-5" />
              </div>
              <div className="space-y-1 max-w-md mx-auto">
                <h3 className="font-serif text-lg font-semibold text-[#2C2A29]">
                  No shifts configured yet
                </h3>
                <p className="text-sm text-[#6E6762]">
                  Load the Success Kar Library shift plan (Full Day ₹800, Morning ₹500, Evening
                  ₹800) or create a custom time slot.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  disabled={seeding}
                  onClick={() => void handleLoadShiftPresets()}
                  className="bg-[#D9775B] hover:bg-[#C46348] text-[#FDFBF7] cursor-pointer"
                >
                  Load Shift Plan (3 Shifts)
                </Button>
                <Button
                  variant="outline"
                  onClick={openAddSlot}
                  className="border-[#DDD4CA] bg-[#FDFBF7] text-[#2C2A29] hover:bg-[#F4EFEA] cursor-pointer"
                >
                  Add Custom Shift
                </Button>
              </div>
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-[#F4EFEA]">
                <TableRow className="border-[#E4DDD5] hover:bg-[#F4EFEA]">
                  <TableHead className="text-[#6E6762] font-medium px-4 h-11">Shift Name</TableHead>
                  <TableHead className="text-[#6E6762] font-medium px-4 h-11">Hours</TableHead>
                  <TableHead className="text-[#6E6762] font-medium px-4 h-11 text-right">
                    Shift Fee
                  </TableHead>
                  <TableHead className="text-[#6E6762] font-medium px-4 h-11 text-right">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {slots.map((slot) => (
                  <TableRow key={slot.id} className="border-[#E4DDD5] hover:bg-[#F4EFEA]/60">
                    <TableCell className="px-4 py-3 font-medium text-[#2C2A29]">
                      {slot.name}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-sm text-[#2C2A29] tabular-nums">
                      {formatTime12h(slot.startTime)} – {formatTime12h(slot.endTime)}
                      <span className="text-[#6E6762] ml-2 text-xs">
                        ({slot.startTime}–{slot.endTime})
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right font-medium text-[#2C2A29] tabular-nums">
                      {formatINR(slot.price ?? 0)}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right">
                      <div className="inline-flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditSlot(slot)}
                          className="h-8 px-2.5 text-[#2C2A29] hover:bg-[#EAE2D9] cursor-pointer"
                        >
                          <Pencil className="size-3.5 mr-1" />
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setDeleteTarget({ type: 'slot', id: slot.id, name: slot.name })
                          }
                          className="h-8 px-2 text-[#C25E5E] hover:text-[#C25E5E] hover:bg-[#C25E5E]/10 cursor-pointer"
                          aria-label={`Delete ${slot.name}`}
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
      </section>

      {/* Section 2: Seat Categories */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="space-y-1">
            <h2 className="font-serif text-2xl font-semibold text-[#2C2A29]">
              Seat Categories
            </h2>
            <p className="text-sm text-[#6E6762]">
              Assign floor-plan desk colors and base category pricing tiers.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {categories.length === 0 && !loadingCats && (
              <Button
                variant="outline"
                disabled={seeding}
                onClick={() => void handleLoadCategoryPresets()}
                className="border-[#DDD4CA] bg-[#FDFBF7] text-[#2C2A29] hover:bg-[#F4EFEA] cursor-pointer whitespace-nowrap"
              >
                Load Default Tiers
              </Button>
            )}
            <Button
              onClick={openAddCategory}
              className="bg-[#D9775B] hover:bg-[#C46348] text-[#FDFBF7] cursor-pointer whitespace-nowrap"
            >
              <Plus className="size-4 mr-1.5" />
              Add Category
            </Button>
          </div>
        </div>

        <div className="bg-[#FDFBF7] border border-[#E4DDD5] rounded-xl overflow-hidden">
          {loadingCats ? (
            <div className="p-6 space-y-3">
              {[1, 2].map((row) => (
                <div key={row} className="h-11 rounded-md bg-[#F4EFEA] animate-pulse" />
              ))}
            </div>
          ) : categories.length === 0 ? (
            <div className="p-10 text-center space-y-4">
              <div className="mx-auto size-11 rounded-lg bg-[#F4EFEA] border border-[#E4DDD5] flex items-center justify-center text-[#D9775B]">
                <Layers className="size-5" />
              </div>
              <div className="space-y-1 max-w-md mx-auto">
                <h3 className="font-serif text-lg font-semibold text-[#2C2A29]">
                  No seat categories created yet
                </h3>
                <p className="text-sm text-[#6E6762]">
                  Create categories like Standard Desk or Premium Cabin with custom colors for the
                  visual floor plan editor.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  disabled={seeding}
                  onClick={() => void handleLoadCategoryPresets()}
                  className="bg-[#D9775B] hover:bg-[#C46348] text-[#FDFBF7] cursor-pointer"
                >
                  Load Standard &amp; Premium
                </Button>
                <Button
                  variant="outline"
                  onClick={openAddCategory}
                  className="border-[#DDD4CA] bg-[#FDFBF7] text-[#2C2A29] hover:bg-[#F4EFEA] cursor-pointer"
                >
                  Add Custom Category
                </Button>
              </div>
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-[#F4EFEA]">
                <TableRow className="border-[#E4DDD5] hover:bg-[#F4EFEA]">
                  <TableHead className="text-[#6E6762] font-medium px-4 h-11">Category</TableHead>
                  <TableHead className="text-[#6E6762] font-medium px-4 h-11">
                    Seat Color
                  </TableHead>
                  <TableHead className="text-[#6E6762] font-medium px-4 h-11 text-right">
                    Category Price
                  </TableHead>
                  <TableHead className="text-[#6E6762] font-medium px-4 h-11 text-right">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((cat) => (
                  <TableRow key={cat.id} className="border-[#E4DDD5] hover:bg-[#F4EFEA]/60">
                    <TableCell className="px-4 py-3 font-medium text-[#2C2A29]">
                      {cat.name}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <div className="inline-flex items-center gap-2.5 text-sm text-[#6E6762]">
                        <span
                          className="inline-block size-4 rounded-sm border border-[#2C2A29]/15 shrink-0"
                          style={{ backgroundColor: cat.colorHex }}
                        />
                        <span className="font-mono text-xs tabular-nums text-[#2C2A29]">
                          {cat.colorHex}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right font-medium text-[#2C2A29] tabular-nums">
                      {formatINR(cat.price)}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right">
                      <div className="inline-flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditCategory(cat)}
                          className="h-8 px-2.5 text-[#2C2A29] hover:bg-[#EAE2D9] cursor-pointer"
                        >
                          <Pencil className="size-3.5 mr-1" />
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setDeleteTarget({ type: 'category', id: cat.id, name: cat.name })
                          }
                          className="h-8 px-2 text-[#C25E5E] hover:text-[#C25E5E] hover:bg-[#C25E5E]/10 cursor-pointer"
                          aria-label={`Delete ${cat.name}`}
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
      </section>

      {/* Add / Edit Category Modal */}
      <Dialog open={catModalOpen} onOpenChange={setCatModalOpen}>
        <DialogContent className="bg-[#FDFBF7] border-[#E4DDD5] text-[#2C2A29] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl text-[#2C2A29]">
              {editingCat ? 'Edit Seat Category' : 'New Seat Category'}
            </DialogTitle>
            <DialogDescription className="text-[#6E6762]">
              Set the category label, base rate, and floor plan seat color.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={(e) => void handleSaveCategory(e)} className="space-y-4">
            {catError && (
              <div className="bg-[#F4EFEA] border border-[#C25E5E] rounded-lg p-3 text-xs text-[#C25E5E]">
                {catError}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="cat-name">Category Name</Label>
              <Input
                id="cat-name"
                value={catName}
                onChange={(e) => setCatName(e.target.value)}
                placeholder="e.g. Premium Cabin"
                maxLength={64}
                required
                className="bg-[#FDFBF7] border-[#DDD4CA]"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cat-price">Price (₹)</Label>
              <Input
                id="cat-price"
                type="number"
                min={0}
                max={100000}
                step={1}
                value={catPrice}
                onChange={(e) => setCatPrice(e.target.value)}
                required
                className="bg-[#FDFBF7] border-[#DDD4CA] tabular-nums"
              />
            </div>

            <div className="space-y-2">
              <Label>Seat Color</Label>
              <div className="flex flex-wrap items-center gap-2">
                {WARM_SWATCHES.map((swatch) => (
                  <button
                    key={swatch.hex}
                    type="button"
                    onClick={() => setCatColor(swatch.hex)}
                    title={swatch.label}
                    className={cn(
                      'size-8 rounded-md border transition-transform cursor-pointer',
                      catColor.toUpperCase() === swatch.hex
                        ? 'border-[#2C2A29] ring-2 ring-[#2C2A29]/20 scale-105'
                        : 'border-[#2C2A29]/15 hover:scale-105'
                    )}
                    style={{ backgroundColor: swatch.hex }}
                  />
                ))}
              </div>

              <div className="flex items-center gap-3 pt-1">
                <input
                  type="color"
                  aria-label="Pick custom color"
                  value={/^#[0-9A-Fa-f]{6}$/.test(catColor) ? catColor : '#D9775B'}
                  onChange={(e) => setCatColor(e.target.value.toUpperCase())}
                  className="h-9 w-12 rounded border border-[#DDD4CA] bg-[#FDFBF7] cursor-pointer p-0.5"
                />
                <Input
                  value={catColor}
                  onChange={(e) => setCatColor(e.target.value)}
                  placeholder="#D9775B"
                  maxLength={7}
                  className="font-mono text-sm bg-[#FDFBF7] border-[#DDD4CA] uppercase"
                />
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCatModalOpen(false)}
                className="border-[#DDD4CA] bg-[#FDFBF7] text-[#2C2A29] cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={savingCat}
                className="bg-[#D9775B] hover:bg-[#C46348] text-[#FDFBF7] cursor-pointer"
              >
                {savingCat ? 'Saving...' : editingCat ? 'Save Category' : 'Create Category'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add / Edit Time Slot Modal */}
      <Dialog open={slotModalOpen} onOpenChange={setSlotModalOpen}>
        <DialogContent className="bg-[#FDFBF7] border-[#E4DDD5] text-[#2C2A29] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl text-[#2C2A29]">
              {editingSlot ? 'Edit Shift / Time Slot' : 'New Shift / Time Slot'}
            </DialogTitle>
            <DialogDescription className="text-[#6E6762]">
              Specify shift name, start and end hours, and fee in INR (₹).
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={(e) => void handleSaveSlot(e)} className="space-y-4">
            {slotError && (
              <div className="bg-[#F4EFEA] border border-[#C25E5E] rounded-lg p-3 text-xs text-[#C25E5E]">
                {slotError}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="slot-name">Shift Name</Label>
              <Input
                id="slot-name"
                value={slotName}
                onChange={(e) => setSlotName(e.target.value)}
                placeholder="e.g. Morning Shift"
                maxLength={64}
                required
                className="bg-[#FDFBF7] border-[#DDD4CA]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="slot-start">Start Time</Label>
                <Input
                  id="slot-start"
                  type="time"
                  value={slotStart}
                  onChange={(e) => setSlotStart(e.target.value)}
                  required
                  className="bg-[#FDFBF7] border-[#DDD4CA] tabular-nums"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="slot-end">End Time</Label>
                <Input
                  id="slot-end"
                  type="time"
                  value={slotEnd}
                  onChange={(e) => setSlotEnd(e.target.value)}
                  required
                  className="bg-[#FDFBF7] border-[#DDD4CA] tabular-nums"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="slot-price">Shift Fee (₹)</Label>
              <Input
                id="slot-price"
                type="number"
                min={0}
                max={100000}
                step={1}
                value={slotPrice}
                onChange={(e) => setSlotPrice(e.target.value)}
                required
                className="bg-[#FDFBF7] border-[#DDD4CA] tabular-nums"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setSlotModalOpen(false)}
                className="border-[#DDD4CA] bg-[#FDFBF7] text-[#2C2A29] cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={savingSlot}
                className="bg-[#D9775B] hover:bg-[#C46348] text-[#FDFBF7] cursor-pointer"
              >
                {savingSlot ? 'Saving...' : editingSlot ? 'Save Shift' : 'Create Shift'}
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
            <DialogTitle className="font-serif text-lg">Confirm Deletion</DialogTitle>
            <DialogDescription className="text-[#6E6762]">
              Delete <span className="font-medium text-[#2C2A29]">{deleteTarget?.name}</span>?
              This action cannot be undone.
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
              onClick={() => void handleConfirmDelete()}
              className="bg-[#C25E5E] hover:bg-[#A94E4E] text-[#FDFBF7] cursor-pointer"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
