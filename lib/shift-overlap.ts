import type { StudentGender, TimeSlot } from '@/lib/types';

export function isFullDaySlot(
  slot: Pick<TimeSlot, 'id' | 'name'> | null | undefined
): boolean {
  if (!slot) return false;
  const normalized = `${slot.id} ${slot.name}`.toLowerCase();
  return /full[\s_-]*day/.test(normalized);
}

export function getShortShiftLabel(shiftName: string): string {
  const trimmed = shiftName.trim();
  if (!trimmed) return 'Booked';
  return trimmed.replace(/\s+shift$/i, '');
}

function parseMinutes(hhmm: string): number | null {
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function doSlotsOverlap(
  slotA: Pick<TimeSlot, 'id' | 'name' | 'startTime' | 'endTime'> | null | undefined,
  slotB: Pick<TimeSlot, 'id' | 'name' | 'startTime' | 'endTime'> | null | undefined
): boolean {
  if (!slotA || !slotB) return false;
  if (slotA.id === slotB.id) return true;
  if (isFullDaySlot(slotA) || isFullDaySlot(slotB)) return true;

  const aStart = parseMinutes(slotA.startTime);
  const aEnd = parseMinutes(slotA.endTime);
  const bStart = parseMinutes(slotB.startTime);
  const bEnd = parseMinutes(slotB.endTime);

  if (aStart !== null && aEnd !== null && bStart !== null && bEnd !== null) {
    return aStart < bEnd && bStart < aEnd;
  }

  return false;
}

export function getBookedSeatFillColor(gender?: StudentGender): string {
  if (gender === 'Male') return '#DC2626'; // Red
  if (gender === 'Female') return '#DB2777'; // Pink
  return '#C25E5E'; // Fallback for Other / unspecified
}
