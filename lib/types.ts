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

export interface Student {
  id: string;
  name: string;
  phone: string;
  membershipType: string;
  membershipExpiry: string; // YYYY-MM-DD
  status: StudentStatus;
  createdAt: unknown;
  updatedAt: unknown;
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
