import { formatINR, getDefaultExpiryDate } from '@/lib/formatters';
import type { Enquiry, FeeStatus, Invoice, Student } from '@/lib/types';

const REMINDED_STORAGE_PREFIX = 'sk_whatsapp_reminded_';

function parseUtcDateMs(yyyyMmDd: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(yyyyMmDd)) return null;
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function getTodayDateString(): string {
  return getDefaultExpiryDate(0);
}

export function addOneMonth(yyyyMmDd: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyyMmDd.trim());
  if (!match) return getDefaultExpiryDate(30);

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1; // 0-11
  const day = Number(match[3]);

  const targetMonthStart = new Date(Date.UTC(year, monthIndex + 1, 1));
  const lastDayOfTargetMonth = new Date(
    Date.UTC(
      targetMonthStart.getUTCFullYear(),
      targetMonthStart.getUTCMonth() + 1,
      0
    )
  ).getUTCDate();
  const clampedDay = Math.min(day, lastDayOfTargetMonth);

  const result = new Date(
    Date.UTC(
      targetMonthStart.getUTCFullYear(),
      targetMonthStart.getUTCMonth(),
      clampedDay
    )
  );
  const y = result.getUTCFullYear();
  const m = String(result.getUTCMonth() + 1).padStart(2, '0');
  const d = String(result.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatShortMonthDay(yyyyMmDd: string): string {
  const ms = parseUtcDateMs(yyyyMmDd);
  if (ms === null) return yyyyMmDd;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(ms));
}

export function formatReadableDate(yyyyMmDd: string): string {
  const ms = parseUtcDateMs(yyyyMmDd);
  if (ms === null) return yyyyMmDd;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(ms));
}

export function getStudentSubscriptionEndDate(student: Student): string {
  return (
    student.currentPeriodEndDate ||
    student.subscriptionEndDate ||
    student.membershipExpiry ||
    ''
  ).trim();
}

export function getStudentLastPaymentDate(student: Student): string {
  return (student.lastPaymentDate || student.admissionDate || '').trim();
}

export function getStudentFeeAmount(student: Student): number {
  return typeof student.feeAmount === 'number' && !Number.isNaN(student.feeAmount)
    ? student.feeAmount
    : 800;
}

export function getStudentFeeStatus(student: Student): FeeStatus {
  return student.feeStatus === 'paid' ? 'paid' : 'pending';
}

export function isStudentNextCycleRenewed(student: Student): boolean {
  return student.nextCycleRenewed === true;
}

export function getStudentPhoneForWhatsApp(student: Student): string {
  return (student.whatsappNumber || student.phone || '').trim();
}

export function getDaysRemaining(
  endDateStr: string,
  todayStr: string = getTodayDateString()
): number | null {
  const endMs = parseUtcDateMs(endDateStr);
  const todayMs = parseUtcDateMs(todayStr);
  if (endMs === null || todayMs === null) return null;
  return Math.round((endMs - todayMs) / 86_400_000);
}

export function formatExpiryRemainingLabel(daysRemaining: number): string {
  if (daysRemaining === 0) return 'Due today';
  if (daysRemaining === 1) return 'Ends in 1 day';
  if (daysRemaining > 1) return `Ends in ${daysRemaining} days`;
  const overdue = Math.abs(daysRemaining);
  return overdue === 1 ? 'Overdue by 1 day' : `Overdue by ${overdue} days`;
}

export function isExpiringOrNextRenewalDue(
  student: Student,
  todayStr: string = getTodayDateString()
): { eligible: boolean; daysRemaining: number | null; endDate: string } {
  const endDate = getStudentSubscriptionEndDate(student);
  const daysRemaining = getDaysRemaining(endDate, todayStr);

  if (daysRemaining === null || isStudentNextCycleRenewed(student)) {
    return { eligible: false, daysRemaining, endDate };
  }

  return {
    eligible: daysRemaining <= 3,
    daysRemaining,
    endDate,
  };
}

export function formatWhatsAppPhone(rawPhone: string): string {
  const digits = rawPhone.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) {
    return `91${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    return `91${digits.slice(1)}`;
  }
  return digits;
}

export function buildWhatsAppReminderMessage(
  student: Student,
  todayStr: string = getTodayDateString()
): string {
  const rawEndDate = getStudentSubscriptionEndDate(student);
  if (!rawEndDate) {
    return `Hello ${student.name}, welcome to Success Kar Library! Please contact the desk to activate your monthly subscription plan. Thank you!`;
  }

  const readableEndDate = formatReadableDate(rawEndDate);
  const daysRemaining = getDaysRemaining(rawEndDate, todayStr);
  const amount = getStudentFeeAmount(student);

  if (daysRemaining === 0) {
    return `Hello ${student.name}, your current subscription ending on ${readableEndDate} is expiring today. Please pay the fee of ₹${amount} for next month's renewal to continue without interruption. Thank you!`;
  }

  if (daysRemaining !== null && daysRemaining < 0) {
    const overdueDays = Math.abs(daysRemaining);
    const dayWord = overdueDays === 1 ? 'day' : 'days';
    return `Hello ${student.name}, your current subscription ending on ${readableEndDate} expired ${overdueDays} ${dayWord} ago. Please pay the fee of ₹${amount} for next month's renewal to continue without interruption. Thank you!`;
  }

  const days = daysRemaining ?? 3;
  const dayWord = days === 1 ? 'day' : 'days';
  return `Hello ${student.name}, your current subscription ending on ${readableEndDate} is expiring in ${days} ${dayWord}. Please pay the fee of ₹${amount} for next month's renewal to continue without interruption. Thank you!`;
}

export function buildWhatsAppReminderUrl(
  student: Student,
  todayStr: string = getTodayDateString()
): string | null {
  const formattedPhone = formatWhatsAppPhone(getStudentPhoneForWhatsApp(student));
  if (!formattedPhone) return null;
  const message = buildWhatsAppReminderMessage(student, todayStr);
  return `https://wa.me/${formattedPhone}?text=${encodeURIComponent(message)}`;
}

export function readRemindedTodayIds(todayStr: string = getTodayDateString()): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(`${REMINDED_STORAGE_PREFIX}${todayStr}`);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((v): v is string => typeof v === 'string'))
      : new Set();
  } catch {
    return new Set();
  }
}

export function saveRemindedTodayId(
  studentId: string,
  todayStr: string = getTodayDateString()
): Set<string> {
  const next = readRemindedTodayIds(todayStr);
  next.add(studentId);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(
        `${REMINDED_STORAGE_PREFIX}${todayStr}`,
        JSON.stringify(Array.from(next))
      );
    } catch {
      // ignore storage quota errors
    }
  }
  return next;
}

export function buildNextMonthRenewalUpdate(
  student: Student,
  todayStr: string = getTodayDateString()
): {
  currentPeriodEndDate: string;
  subscriptionEndDate: string;
  membershipExpiry: string;
  lastPaymentDate: string;
  feeStatus: FeeStatus;
  nextCycleRenewed: boolean;
  lastRemindedDate: string;
} {
  const baseEnd = getStudentSubscriptionEndDate(student) || todayStr;
  const nextPeriodEndDate = addOneMonth(baseEnd);
  const newDaysRemaining = getDaysRemaining(nextPeriodEndDate, todayStr);

  // For normal cycles (e.g. 2026-11-22 -> 2026-12-22), newDaysRemaining is ~30 (> 3),
  // so setting nextCycleRenewed: false clears today's alert while automatically
  // enabling next month's 3-day pre-expiry alert. Only set true if still <= 3 days away.
  const nextCycleRenewed = newDaysRemaining !== null && newDaysRemaining <= 3;

  return {
    currentPeriodEndDate: nextPeriodEndDate,
    subscriptionEndDate: nextPeriodEndDate,
    membershipExpiry: nextPeriodEndDate,
    lastPaymentDate: todayStr,
    feeStatus: 'paid',
    nextCycleRenewed,
    lastRemindedDate: '',
  };
}

export function buildEnquiryFollowUpMessage(enquiry: Pick<Enquiry, 'name'>): string {
  return `Hello ${enquiry.name}, thank you for visiting Success Kar Library! Please let us know when you would like to reserve your study seat or if you have any questions about our shifts. We look forward to welcoming you!`;
}

export function buildEnquiryWhatsAppUrl(
  enquiry: Pick<Enquiry, 'name' | 'phone'>
): string | null {
  const formattedPhone = formatWhatsAppPhone(enquiry.phone);
  if (!formattedPhone) return null;
  const message = buildEnquiryFollowUpMessage(enquiry);
  return `https://wa.me/${formattedPhone}?text=${encodeURIComponent(message)}`;
}

export function buildInvoiceWhatsAppMessage(invoice: Invoice): string {
  const seatShift = [invoice.seatLabel, invoice.shiftLabel]
    .filter((v) => v && v.trim().length > 0)
    .join(' · ') || 'Library Membership';
  const validity = `${formatReadableDate(invoice.validFrom)} to ${formatReadableDate(invoice.validTo)}`;
  return [
    `Hello ${invoice.studentName}, thank you for your payment at Success Kar Library!`,
    ``,
    `Payment Receipt`,
    `Invoice No: ${invoice.invoiceNumber}`,
    `Seat / Shift: ${seatShift}`,
    `Validity: ${validity}`,
    `Amount Paid: ${formatINR(invoice.amount)} (${invoice.paymentMode})`,
    ``,
    `Thank you and happy studying!`,
  ].join('\n');
}

export function buildInvoiceWhatsAppUrl(invoice: Invoice): string | null {
  const formattedPhone = formatWhatsAppPhone(invoice.studentPhone);
  if (!formattedPhone) return null;
  const message = buildInvoiceWhatsAppMessage(invoice);
  return `https://wa.me/${formattedPhone}?text=${encodeURIComponent(message)}`;
}


