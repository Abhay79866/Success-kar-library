import type { StudentGender, TimeSlot } from '@/lib/types';

export function isFullDaySlot(
  slot: Pick<TimeSlot, 'name' | 'startTime' | 'endTime'> | null | undefined
): boolean {
  if (!slot) return false;
  return /full[\s_-]*day|all[\s_-]*day/i.test(slot.name);
}

function parseTimeToMinutes(hhmm: string): number | null {
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return null;
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

export function doSlotsOverlap(
  slotA: Pick<TimeSlot, 'id' | 'name' | 'startTime' | 'endTime'> | null | undefined,
  slotB: Pick<TimeSlot, 'id' | 'name' | 'startTime' | 'endTime'> | null | undefined
): boolean {
  if (!slotA || !slotB) return false;
  if (slotA.id === slotB.id) return true;

  // Full Day overlaps with every shift (Full Day, Morning, Evening, etc.)
  if (isFullDaySlot(slotA) || isFullDaySlot(slotB)) {
    return true;
  }

  const startA = parseTimeToMinutes(slotA.startTime);
  const endARaw = parseTimeToMinutes(slotA.endTime);
  const startB = parseTimeToMinutes(slotB.startTime);
  const endBRaw = parseTimeToMinutes(slotB.endTime);

  if (startA === null || endARaw === null || startB === null || endBRaw === null) {
    return false;
  }

  const endA = endARaw <= startA ? endARaw + 1440 : endARaw;
  const endB = endBRaw <= startB ? endBRaw + 1440 : endBRaw;

  return startA < endB && startB < endA;
}

export function getShortShiftLabel(slotName: string): string {
  const trimmed = slotName.trim();
  if (/full[\s_-]*day/i.test(trimmed)) return 'Full Day';
  if (/morning/i.test(trimmed)) return 'Morning';
  if (/evening/i.test(trimmed)) return 'Evening';
  if (/afternoon/i.test(trimmed)) return 'Afternoon';
  return trimmed.replace(/\s+shift$/i, '').trim() || trimmed;
}

export function getBookedSeatColorByGender(gender?: StudentGender | string): string {
  if (gender === 'Male') return '#DC2626'; // Red for Male
  if (gender === 'Female') return '#DB2777'; // Pink for Female
  return '#C25E5E'; // Default warm brick for Other / unspecified
}
