export type AdminRole = 'super_admin' | 'staff';

export interface AdminProfile {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  createdAt: unknown;
  updatedAt: unknown;
}

export type StudentStatus = 'active' | 'blocked';
export type FeeStatus = 'paid' | 'pending';
export type StudentGender = 'Male' | 'Female' | 'Other';

export interface Student {
  id: string;
  name: string;
  phone?: string;
  whatsappNumber?: string;
  gender?: StudentGender;
  membershipType?: string;
  admissionDate?: string; // YYYY-MM-DD
  lastPaymentDate?: string; // YYYY-MM-DD
  currentPeriodEndDate?: string; // YYYY-MM-DD
  membershipExpiry?: string; // YYYY-MM-DD (legacy alias synced with currentPeriodEndDate)
  subscriptionEndDate?: string; // YYYY-MM-DD (alias synced with currentPeriodEndDate)
  feeAmount?: number;
  feeStatus?: FeeStatus;
  nextCycleRenewed?: boolean; // default false; suppresses alert for current cycle when true
  lastRemindedDate?: string; // YYYY-MM-DD
  status: StudentStatus;
  createdAt: unknown;
  updatedAt?: unknown;
}

export interface Floor {
  id: string;
  name: string;
  widthPx: number;
  heightPx: number;
  layoutVersion: number;
  updatedAt: unknown;
}

export type SeatShape = 'desk' | 'wall' | 'door' | 'pillar';
export type SeatStatus = 'active' | 'maintenance';

export interface Seat {
  id: string;
  floorId: string;
  seatCode: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  shape: SeatShape;
  categoryId: string;
  status: SeatStatus;
  updatedAt: unknown;
}

export interface Category {
  id: string;
  name: string;
  colorHex: string;
  price: number;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface TimeSlot {
  id: string;
  name: string;
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  price?: number;
  createdAt: unknown;
  updatedAt: unknown;
}

export type PaymentStatus = 'paid' | 'pending';
export type BookingStatus = 'reserved' | 'checked_in' | 'cancelled';

export interface Booking {
  id: string;
  studentId: string;
  seatId: string;
  floorId: string;
  slotId: string;
  bookingDate: string; // YYYY-MM-DD
  amount: number;
  paymentStatus: PaymentStatus;
  status: BookingStatus;
  bookedBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export type EnquiryStatus = 'new' | 'contacted' | 'joined';

export interface Enquiry {
  id: string;
  name: string;
  phone: string;
  enquiryDate: string; // YYYY-MM-DD
  status: EnquiryStatus;
  createdAt: unknown;
  updatedAt?: unknown;
}

export type InvoicePaymentMode = 'UPI' | 'Cash' | 'Bank/Card';

export interface Invoice {
  id: string;
  invoiceNumber: string; // e.g. INV-0001
  invoiceDate: string; // YYYY-MM-DD
  studentId?: string;
  studentName: string;
  studentPhone: string;
  seatLabel: string;
  shiftLabel: string;
  validFrom: string; // YYYY-MM-DD
  validTo: string; // YYYY-MM-DD
  amount: number;
  paymentMode: InvoicePaymentMode;
  createdAt: unknown;
  updatedAt?: unknown;
}
