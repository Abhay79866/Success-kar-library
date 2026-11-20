'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  Armchair,
  DoorOpen,
  Grid3X3,
  Minus,
  Plus,
  Save,
  Square,
} from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/lib/firebase';
import { handleFirestoreError, OperationType } from '@/lib/firestore-errors';
import { generateDocId } from '@/lib/formatters';
import type { Category, Floor, Seat, SeatShape } from '@/lib/types';
import type { CanvasSeatItem } from '@/components/editor/floor-canvas';
import { PropertiesPanel } from '@/components/editor/properties-panel';
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
import { cn } from '@/lib/utils';

const FloorCanvas = dynamic(() => import('@/components/editor/floor-canvas'), {
  ssr: false,
  loading: () => (
    <div className="h-[520px] bg-[#F4EFEA] border border-[#E4DDD5] rounded-xl flex items-center justify-center text-sm text-[#6E6762]">
      Loading layout canvas...
    </div>
  ),
});

const DEFAULT_FLOOR: Floor = {
  id: 'floor_main',
  name: 'Main Reading Hall',
  widthPx: 960,
  heightPx: 600,
  layoutVersion: 1,
  updatedAt: null,
};

const SHAPE_DEFAULTS: Record<
  SeatShape,
  { width: number; height: number; prefix: string }
> = {
  desk: { width: 64, height: 48, prefix: 'A' },
  wall: { width: 160, height: 16, prefix: 'Wall' },
  door: { width: 60, height: 16, prefix: 'Door' },
  pillar: { width: 40, height: 40, prefix: 'Pillar' },
};

export default function LayoutEditorPage() {
  const { user, adminProfile } = useAdminAuth();

  const [floors, setFloors] = useState<Floor[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeFloorId, setActiveFloorId] = useState<string>('floor_main');
  const [draftSize, setDraftSize] = useState<{
    floorId: string;
    width: number;
    height: number;
  } | null>(null);

  const [items, setItems] = useState<CanvasSeatItem[]>([]);
  const [persistedIds, setPersistedIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snapToGrid, setSnapToGrid] = useState<boolean>(true);
  const [dirty, setDirty] = useState<boolean>(false);
  const [publishing, setPublishing] = useState<boolean>(false);
  const [loadedFloorId, setLoadedFloorId] = useState<string | null>(null);

  const [newFloorOpen, setNewFloorOpen] = useState(false);
  const [newFloorName, setNewFloorName] = useState('');
  const [creatingFloor, setCreatingFloor] = useState(false);

  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const activeFloor = useMemo(
    () => floors.find((f) => f.id === activeFloorId) || DEFAULT_FLOOR,
    [floors, activeFloorId]
  );

  const floorName = activeFloor.name;
  const floorWidth =
    draftSize && draftSize.floorId === activeFloorId
      ? draftSize.width
      : activeFloor.widthPx;
  const floorHeight =
    draftSize && draftSize.floorId === activeFloorId
      ? draftSize.height
      : activeFloor.heightPx;
  const loadingSeats = loadedFloorId !== activeFloorId;

  // Listen to categories & floors
  useEffect(() => {
    if (!user || !adminProfile) return;

    const unsubCats = onSnapshot(
      collection(db, 'categories'),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as Category);
        list.sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));
        setCategories(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'categories')
    );

    const unsubFloors = onSnapshot(
      collection(db, 'floors'),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as Floor);
        list.sort((a, b) => a.name.localeCompare(b.name));
        setFloors(list);
        if (list.length > 0 && !list.some((f) => f.id === activeFloorId)) {
          setActiveFloorId(list[0].id);
        }
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'floors')
    );

    return () => {
      unsubCats();
      unsubFloors();
    };
  }, [user, adminProfile, activeFloorId]);

  // Listen to seats for the active floor
  useEffect(() => {
    if (!user || !adminProfile || !activeFloorId) return;

    const seatsQuery = query(
      collection(db, 'seats'),
      where('floorId', '==', activeFloorId)
    );

    const unsub = onSnapshot(
      seatsQuery,
      (snap) => {
        const loaded = snap.docs.map((d) => {
          const s = d.data() as Seat;
          const defaults = SHAPE_DEFAULTS[s.shape] || SHAPE_DEFAULTS.desk;
          return {
            id: s.id,
            floorId: s.floorId,
            seatCode: s.seatCode,
            x: s.x,
            y: s.y,
            width: s.width ?? defaults.width,
            height: s.height ?? defaults.height,
            shape: s.shape,
            categoryId: s.categoryId || '',
            status: s.status || 'active',
          } satisfies CanvasSeatItem;
        });

        setPersistedIds(new Set(loaded.map((item) => item.id)));
        if (!dirtyRef.current) {
          setItems(loaded);
        }
        setLoadedFloorId(activeFloorId);
      },
      (err) => {
        setLoadedFloorId(activeFloorId);
        handleFirestoreError(err, OperationType.LIST, `seats?floorId=${activeFloorId}`);
      }
    );

    return () => unsub();
  }, [user, adminProfile, activeFloorId]);

  const nextSeatCode = useCallback(
    (shape: SeatShape, currentItems: CanvasSeatItem[]): string => {
      if (shape === 'desk') {
        const deskCount = currentItems.filter((i) => i.shape === 'desk').length + 1;
        let idx = deskCount;
        const used = new Set(currentItems.map((i) => i.seatCode.toUpperCase()));
        while (used.has(`A-${String(idx).padStart(2, '0')}`)) {
          idx += 1;
        }
        return `A-${String(idx).padStart(2, '0')}`;
      }
      const count = currentItems.filter((i) => i.shape === shape).length + 1;
      return `${SHAPE_DEFAULTS[shape].prefix}-${count}`;
    },
    []
  );

  const addElement = useCallback(
    (shape: SeatShape, x?: number, y?: number) => {
      const defaults = SHAPE_DEFAULTS[shape];
      const defaultCategoryId =
        shape === 'desk' && categories.length > 0 ? categories[0].id : '';

      setItems((prev) => {
        const offset = (prev.length % 8) * 20;
        const posX = x ?? Math.min(floorWidth - defaults.width, 60 + offset);
        const posY = y ?? Math.min(floorHeight - defaults.height, 60 + offset);
        const newItem: CanvasSeatItem = {
          id: generateDocId('seat'),
          floorId: activeFloorId,
          seatCode: nextSeatCode(shape, prev),
          x: posX,
          y: posY,
          width: defaults.width,
          height: defaults.height,
          shape,
          categoryId: defaultCategoryId,
          status: 'active',
        };
        setSelectedId(newItem.id);
        return [...prev, newItem];
      });
      setDirty(true);
    },
    [activeFloorId, categories, floorHeight, floorWidth, nextSeatCode]
  );

  const handleChangeItem = useCallback(
    (id: string, patch: Partial<CanvasSeatItem>) => {
      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
      );
      setDirty(true);
    },
    []
  );

  const handleDuplicateItem = useCallback(
    (item: CanvasSeatItem) => {
      setItems((prev) => {
        const copy: CanvasSeatItem = {
          ...item,
          id: generateDocId('seat'),
          seatCode: nextSeatCode(item.shape, prev),
          x: Math.min(floorWidth - item.width, item.x + 20),
          y: Math.min(floorHeight - item.height, item.y + 20),
        };
        setSelectedId(copy.id);
        return [...prev, copy];
      });
      setDirty(true);
    },
    [floorHeight, floorWidth, nextSeatCode]
  );

  const handleDeleteItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
    setSelectedId((curr) => (curr === id ? null : curr));
    setDirty(true);
  }, []);

  // Keyboard Delete/Backspace shortcut
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!selectedId) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        handleDeleteItem(selectedId);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, handleDeleteItem]);

  const handlePublishLayout = async () => {
    for (const item of items) {
      if (!item.seatCode.trim() || item.seatCode.trim().length > 32) {
        toast.error('Every element must have a valid Seat Code (1–32 chars).');
        setSelectedId(item.id);
        return;
      }
    }

    setPublishing(true);
    try {
      const existingFloor = floors.find((f) => f.id === activeFloorId);
      const floorRef = doc(db, 'floors', activeFloorId);

      // Step 1: Ensure parent floor exists/updates first so seat rules' exists() check passes
      try {
        if (existingFloor) {
          await updateDoc(floorRef, {
            name: floorName.trim() || 'Main Reading Hall',
            widthPx: floorWidth,
            heightPx: floorHeight,
            layoutVersion: (existingFloor.layoutVersion || 1) + 1,
            updatedAt: serverTimestamp(),
          });
        } else {
          await setDoc(floorRef, {
            id: activeFloorId,
            name: floorName.trim() || 'Main Reading Hall',
            widthPx: floorWidth,
            heightPx: floorHeight,
            layoutVersion: 1,
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        handleFirestoreError(
          err,
          existingFloor ? OperationType.UPDATE : OperationType.CREATE,
          `floors/${activeFloorId}`
        );
      }

      // Step 2: Prepare batch operations (chunked <= 400 ops per batch for Vercel & Firestore safety)
      const currentIds = new Set(items.map((i) => i.id));
      const deletedIds = Array.from(persistedIds).filter((id) => !currentIds.has(id));

      type BatchOp =
        | { kind: 'create'; item: CanvasSeatItem }
        | { kind: 'update'; item: CanvasSeatItem }
        | { kind: 'delete'; id: string };

      const ops: BatchOp[] = [
        ...items.map((item): BatchOp =>
          persistedIds.has(item.id)
            ? { kind: 'update', item }
            : { kind: 'create', item }
        ),
        ...deletedIds.map((id): BatchOp => ({ kind: 'delete', id })),
      ];

      const CHUNK_SIZE = 400;
      for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
        const chunk = ops.slice(i, i + CHUNK_SIZE);
        const batch = writeBatch(db);

        for (const op of chunk) {
          if (op.kind === 'create') {
            batch.set(doc(db, 'seats', op.item.id), {
              id: op.item.id,
              floorId: activeFloorId,
              seatCode: op.item.seatCode.trim(),
              x: Math.round(op.item.x),
              y: Math.round(op.item.y),
              width: Math.round(op.item.width),
              height: Math.round(op.item.height),
              shape: op.item.shape,
              categoryId: op.item.categoryId || '',
              status: op.item.status,
              updatedAt: serverTimestamp(),
            });
          } else if (op.kind === 'update') {
            batch.update(doc(db, 'seats', op.item.id), {
              seatCode: op.item.seatCode.trim(),
              x: Math.round(op.item.x),
              y: Math.round(op.item.y),
              width: Math.round(op.item.width),
              height: Math.round(op.item.height),
              shape: op.item.shape,
              categoryId: op.item.categoryId || '',
              status: op.item.status,
              updatedAt: serverTimestamp(),
            });
          } else {
            batch.delete(doc(db, 'seats', op.id));
          }
        }

        try {
          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, 'seats');
        }
      }

      setPersistedIds(currentIds);
      setDirty(false);
      setDraftSize(null);
      toast.success(`Published ${items.length} elements for ${floorName}`);
    } catch (err) {
      console.error('Publish layout error:', err);
      toast.error('Failed to publish floor layout');
    } finally {
      setPublishing(false);
    }
  };

  const handleCreateFloor = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newFloorName.trim();
    if (!trimmed) return;
    setCreatingFloor(true);
    const newId = generateDocId('floor');
    try {
      await setDoc(doc(db, 'floors', newId), {
        id: newId,
        name: trimmed,
        widthPx: 960,
        heightPx: 600,
        layoutVersion: 1,
        updatedAt: serverTimestamp(),
      });
      setDirty(false);
      setSelectedId(null);
      setActiveFloorId(newId);
      setNewFloorName('');
      setNewFloorOpen(false);
      toast.success(`Created floor "${trimmed}"`);
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.CREATE, `floors/${newId}`);
      } catch {
        toast.error('Could not create floor');
      }
    } finally {
      setCreatingFloor(false);
    }
  };

  const selectedItem = useMemo(
    () => items.find((i) => i.id === selectedId) || null,
    [items, selectedId]
  );

  const totalDesks = items.filter((i) => i.shape === 'desk').length;
  const activeDesks = items.filter(
    (i) => i.shape === 'desk' && i.status === 'active'
  ).length;

  const floorOptions = floors.length > 0 ? floors : [DEFAULT_FLOOR];

  const toolButtons: {
    shape: SeatShape;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { shape: 'desk', label: 'Add Desk', icon: Armchair },
    { shape: 'wall', label: 'Add Wall', icon: Minus },
    { shape: 'door', label: 'Add Door', icon: DoorOpen },
    { shape: 'pillar', label: 'Add Pillar', icon: Square },
  ];

  return (
    <div className="space-y-4">
      {/* Top Editor Action Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-[#FDFBF7] border border-[#E4DDD5] rounded-xl p-3">
        {/* Floor Selector + Shapes Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 mr-1">
            <Select
              value={activeFloorId}
              onValueChange={(val) => {
                if (!val) return;
                setDirty(false);
                setSelectedId(null);
                setActiveFloorId(val);
              }}
            >
              <SelectTrigger className="bg-[#F4EFEA] border-[#DDD4CA] h-9 w-[190px] text-sm font-medium">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#FDFBF7] border-[#E4DDD5]">
                {floorOptions.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setNewFloorOpen(true)}
              className="h-9 px-2.5 border-[#DDD4CA] bg-[#FDFBF7] text-[#2C2A29] hover:bg-[#F4EFEA] cursor-pointer"
              title="Add new floor"
            >
              <Plus className="size-4" />
            </Button>
          </div>

          <div className="h-6 w-px bg-[#E4DDD5] hidden sm:block mx-1" />

          {toolButtons.map((tool) => {
            const Icon = tool.icon;
            return (
              <button
                key={tool.shape}
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-library-shape', tool.shape);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => addElement(tool.shape)}
                title={`Click or drag onto canvas to ${tool.label.toLowerCase()}`}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-[#DDD4CA] bg-[#FDFBF7] hover:bg-[#F4EFEA] hover:border-[#D9775B] text-xs font-medium text-[#2C2A29] transition-colors cursor-grab active:cursor-grabbing whitespace-nowrap"
              >
                <Icon className="size-3.5 text-[#D9775B]" />
                <span>{tool.label}</span>
              </button>
            );
          })}
        </div>

        {/* Grid Toggle + Publish Button */}
        <div className="flex items-center justify-between lg:justify-end gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setSnapToGrid((v) => !v)}
            className={cn(
              'inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-xs font-medium transition-colors cursor-pointer whitespace-nowrap',
              snapToGrid
                ? 'bg-[#F4EFEA] border-[#D9775B] text-[#2C2A29]'
                : 'bg-[#FDFBF7] border-[#DDD4CA] text-[#6E6762]'
            )}
          >
            <Grid3X3 className="size-3.5" />
            <span>Snap Grid: {snapToGrid ? 'On' : 'Off'}</span>
          </button>

          {dirty && (
            <span className="text-xs font-medium text-[#D9775B] whitespace-nowrap">
              Unsaved changes
            </span>
          )}

          <Button
            type="button"
            disabled={publishing}
            onClick={() => void handlePublishLayout()}
            className="h-9 bg-[#D9775B] hover:bg-[#C46348] text-[#FDFBF7] whitespace-nowrap cursor-pointer"
          >
            <Save className="size-4 mr-1.5" />
            {publishing ? 'Publishing...' : 'Publish Layout'}
          </Button>
        </div>
      </div>

      {/* Main Split Workspace: Konva Canvas + Right Properties Inspector */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-4 items-start">
        <div className="min-w-0 space-y-2">
          {loadingSeats && items.length === 0 ? (
            <div className="h-[520px] bg-[#F4EFEA] border border-[#E4DDD5] rounded-xl flex items-center justify-center text-sm text-[#6E6762]">
              Loading floor plan...
            </div>
          ) : (
            <FloorCanvas
              widthPx={floorWidth}
              heightPx={floorHeight}
              items={items}
              categories={categories}
              selectedId={selectedId}
              snapToGrid={snapToGrid}
              onSelect={setSelectedId}
              onChangeItem={handleChangeItem}
              onDropTool={(shape, x, y) => addElement(shape, x, y)}
            />
          )}
          <p className="text-xs text-[#6E6762]">
            Drag toolbar shapes onto the Soft Sand grid or click to add. Drag elements to
            position, use corner handles to resize, and press Delete to remove the selected item.
          </p>
        </div>

        <PropertiesPanel
          selectedItem={selectedItem}
          categories={categories}
          floorWidth={floorWidth}
          floorHeight={floorHeight}
          totalDesks={totalDesks}
          activeDesks={activeDesks}
          onChange={handleChangeItem}
          onDuplicate={handleDuplicateItem}
          onDelete={handleDeleteItem}
          onChangeFloorSize={(w, h) => {
            setDraftSize({ floorId: activeFloorId, width: w, height: h });
            setDirty(true);
          }}
        />
      </div>

      {/* Add New Floor Modal */}
      <Dialog open={newFloorOpen} onOpenChange={setNewFloorOpen}>
        <DialogContent className="bg-[#FDFBF7] border-[#E4DDD5] text-[#2C2A29] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-serif text-lg">Add Library Floor</DialogTitle>
            <DialogDescription className="text-[#6E6762]">
              Create a separate reading hall or floor plan canvas.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => void handleCreateFloor(e)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-floor-name">Floor Name</Label>
              <Input
                id="new-floor-name"
                value={newFloorName}
                onChange={(e) => setNewFloorName(e.target.value)}
                placeholder="e.g. First Floor Quiet Zone"
                maxLength={120}
                required
                className="bg-[#FDFBF7] border-[#DDD4CA]"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setNewFloorOpen(false)}
                className="border-[#DDD4CA] bg-[#FDFBF7] text-[#2C2A29] cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={creatingFloor}
                className="bg-[#D9775B] hover:bg-[#C46348] text-[#FDFBF7] cursor-pointer"
              >
                {creatingFloor ? 'Creating...' : 'Create Floor'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
