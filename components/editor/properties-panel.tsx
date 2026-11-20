'use client';

import React from 'react';
import { Copy, Trash2 } from 'lucide-react';
import type { Category, SeatStatus } from '@/lib/types';
import type { CanvasSeatItem } from '@/components/editor/floor-canvas';
import { formatINR } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface PropertiesPanelProps {
  selectedItem: CanvasSeatItem | null;
  categories: Category[];
  floorWidth: number;
  floorHeight: number;
  totalDesks: number;
  activeDesks: number;
  onChange: (id: string, patch: Partial<CanvasSeatItem>) => void;
  onDuplicate: (item: CanvasSeatItem) => void;
  onDelete: (id: string) => void;
  onChangeFloorSize: (width: number, height: number) => void;
}

export function PropertiesPanel({
  selectedItem,
  categories,
  floorWidth,
  floorHeight,
  totalDesks,
  activeDesks,
  onChange,
  onDuplicate,
  onDelete,
  onChangeFloorSize,
}: PropertiesPanelProps) {
  if (!selectedItem) {
    return (
      <aside className="bg-[#FDFBF7] border border-[#E4DDD5] rounded-xl p-5 space-y-5 h-fit">
        <div className="space-y-1">
          <h3 className="font-serif text-lg font-semibold text-[#2C2A29]">
            Floor Inspector
          </h3>
          <p className="text-xs text-[#6E6762]">
            Click any desk or wall on the canvas to edit its properties, or drag a shape from the
            toolbar.
          </p>
        </div>

        <Separator className="bg-[#E4DDD5]" />

        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-[#6E6762]">Total Desks</span>
            <span className="font-medium text-[#2C2A29] tabular-nums">{totalDesks}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[#6E6762]">Active Bookable</span>
            <span className="font-medium text-[#597752] tabular-nums">{activeDesks}</span>
          </div>
        </div>

        <Separator className="bg-[#E4DDD5]" />

        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-wide text-[#6E6762]">
            Canvas Dimensions (px)
          </p>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="space-y-1">
              <Label htmlFor="floor-w" className="text-xs text-[#6E6762]">
                Width
              </Label>
              <Input
                id="floor-w"
                type="number"
                min={400}
                max={3000}
                step={20}
                value={floorWidth}
                onChange={(e) => {
                  const val = Math.max(400, Math.min(3000, Number(e.target.value) || 400));
                  onChangeFloorSize(val, floorHeight);
                }}
                className="bg-[#FDFBF7] border-[#DDD4CA] h-8 text-sm tabular-nums"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="floor-h" className="text-xs text-[#6E6762]">
                Height
              </Label>
              <Input
                id="floor-h"
                type="number"
                min={300}
                max={2400}
                step={20}
                value={floorHeight}
                onChange={(e) => {
                  const val = Math.max(300, Math.min(2400, Number(e.target.value) || 300));
                  onChangeFloorSize(floorWidth, val);
                }}
                className="bg-[#FDFBF7] border-[#DDD4CA] h-8 text-sm tabular-nums"
              />
            </div>
          </div>
        </div>

        <Separator className="bg-[#E4DDD5]" />

        <div className="space-y-2.5">
          <p className="text-xs font-medium uppercase tracking-wide text-[#6E6762]">
            Seat Category Colors
          </p>
          {categories.length === 0 ? (
            <p className="text-xs text-[#6E6762]">
              No categories configured yet. Add them in Pricing.
            </p>
          ) : (
            <div className="space-y-2">
              {categories.map((cat) => (
                <div
                  key={cat.id}
                  className="flex items-center justify-between text-xs text-[#2C2A29]"
                >
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="size-3.5 rounded-sm border border-[#2C2A29]/15 shrink-0"
                      style={{ backgroundColor: cat.colorHex }}
                    />
                    <span>{cat.name}</span>
                  </span>
                  <span className="text-[#6E6762] tabular-nums">{formatINR(cat.price)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    );
  }

  const shapeLabel =
    selectedItem.shape.charAt(0).toUpperCase() + selectedItem.shape.slice(1);

  return (
    <aside className="bg-[#FDFBF7] border border-[#E4DDD5] rounded-xl p-5 space-y-5 h-fit">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-[#6E6762]">
            {shapeLabel} Properties
          </p>
          <h3 className="font-serif text-lg font-semibold text-[#2C2A29]">
            {selectedItem.seatCode}
          </h3>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onDelete(selectedItem.id)}
          className="h-8 px-2 text-[#C25E5E] hover:text-[#C25E5E] hover:bg-[#C25E5E]/10 cursor-pointer"
          title="Delete element"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      <Separator className="bg-[#E4DDD5]" />

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="prop-code">
            {selectedItem.shape === 'desk' ? 'Seat Code' : 'Element Label'}
          </Label>
          <Input
            id="prop-code"
            value={selectedItem.seatCode}
            maxLength={32}
            onChange={(e) =>
              onChange(selectedItem.id, { seatCode: e.target.value })
            }
            placeholder="e.g. A-01"
            className="bg-[#FDFBF7] border-[#DDD4CA]"
          />
        </div>

        {selectedItem.shape === 'desk' && (
          <>
            <div className="space-y-1.5">
              <Label>Seat Category</Label>
              <Select
                value={selectedItem.categoryId || 'none'}
                onValueChange={(val) => {
                  if (!val) return;
                  onChange(selectedItem.id, {
                    categoryId: val === 'none' ? '' : val,
                  });
                }}
              >
                <SelectTrigger className="bg-[#FDFBF7] border-[#DDD4CA] w-full">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent className="bg-[#FDFBF7] border-[#E4DDD5]">
                  <SelectItem value="none">Unassigned (Default Sage)</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name} ({formatINR(cat.price)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Desk Status</Label>
              <Select
                value={selectedItem.status}
                onValueChange={(val) => {
                  if (val === 'active' || val === 'maintenance') {
                    onChange(selectedItem.id, { status: val as SeatStatus });
                  }
                }}
              >
                <SelectTrigger className="bg-[#FDFBF7] border-[#DDD4CA] w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#FDFBF7] border-[#E4DDD5]">
                  <SelectItem value="active">Active (Bookable)</SelectItem>
                  <SelectItem value="maintenance">Maintenance</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </>
        )}

        <div className="grid grid-cols-2 gap-2.5">
          <div className="space-y-1.5">
            <Label htmlFor="prop-w">Width (px)</Label>
            <Input
              id="prop-w"
              type="number"
              min={16}
              max={1200}
              value={selectedItem.width}
              onChange={(e) => {
                const w = Math.max(16, Math.min(1200, Number(e.target.value) || 16));
                onChange(selectedItem.id, { width: w });
              }}
              className="bg-[#FDFBF7] border-[#DDD4CA] tabular-nums"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prop-h">Height (px)</Label>
            <Input
              id="prop-h"
              type="number"
              min={12}
              max={1200}
              value={selectedItem.height}
              onChange={(e) => {
                const h = Math.max(12, Math.min(1200, Number(e.target.value) || 12));
                onChange(selectedItem.id, { height: h });
              }}
              className="bg-[#FDFBF7] border-[#DDD4CA] tabular-nums"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div className="space-y-1.5">
            <Label htmlFor="prop-x">X Position</Label>
            <Input
              id="prop-x"
              type="number"
              min={0}
              max={floorWidth}
              value={selectedItem.x}
              onChange={(e) => {
                const x = Math.max(0, Math.min(floorWidth, Number(e.target.value) || 0));
                onChange(selectedItem.id, { x });
              }}
              className="bg-[#FDFBF7] border-[#DDD4CA] tabular-nums"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prop-y">Y Position</Label>
            <Input
              id="prop-y"
              type="number"
              min={0}
              max={floorHeight}
              value={selectedItem.y}
              onChange={(e) => {
                const y = Math.max(0, Math.min(floorHeight, Number(e.target.value) || 0));
                onChange(selectedItem.id, { y });
              }}
              className="bg-[#FDFBF7] border-[#DDD4CA] tabular-nums"
            />
          </div>
        </div>
      </div>

      <Separator className="bg-[#E4DDD5]" />

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onDuplicate(selectedItem)}
          className="flex-1 border-[#DDD4CA] bg-[#FDFBF7] text-[#2C2A29] hover:bg-[#F4EFEA] cursor-pointer"
        >
          <Copy className="size-3.5 mr-1.5" />
          Duplicate
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onDelete(selectedItem.id)}
          className="border-[#C25E5E]/40 bg-[#FDFBF7] text-[#C25E5E] hover:bg-[#C25E5E]/10 cursor-pointer"
        >
          Delete
        </Button>
      </div>
    </aside>
  );
}
