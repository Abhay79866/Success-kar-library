/**
 * Security Specification Test Suite (Payload-First TDD Reference)
 * Verifies the "Dirty Dozen" adversarial payloads against firestore.rules
 * when executed against the Firebase Emulator Suite (`@firebase/rules-unit-testing`).
 */

export const DIRTY_DOZEN_CASES = [
  { id: 1, name: 'Unauthenticated student read', collection: 'students', op: 'get', expected: 'PERMISSION_DENIED' },
  { id: 2, name: 'Unverified email admin spoof', collection: 'students', op: 'list', expected: 'PERMISSION_DENIED' },
  { id: 3, name: 'Non-admin signed-in user read', collection: 'students', op: 'get', expected: 'PERMISSION_DENIED' },
  { id: 4, name: 'Self-assigned super_admin escalation', collection: 'admins', op: 'create', expected: 'PERMISSION_DENIED' },
  { id: 5, name: 'Shadow field injection on student', collection: 'students', op: 'create', expected: 'PERMISSION_DENIED' },
  { id: 6, name: 'Oversized document ID poisoning', collection: 'students', op: 'create', expected: 'PERMISSION_DENIED' },
  { id: 7, name: 'Invalid empty name or short phone', collection: 'students', op: 'create', expected: 'PERMISSION_DENIED' },
  { id: 8, name: 'Client-spoofed createdAt timestamp', collection: 'categories', op: 'create', expected: 'PERMISSION_DENIED' },
  { id: 9, name: 'Invalid hex color on category', collection: 'categories', op: 'create', expected: 'PERMISSION_DENIED' },
  { id: 10, name: 'Orphaned booking with missing seat', collection: 'bookings', op: 'create', expected: 'PERMISSION_DENIED' },
  { id: 11, name: 'BookedBy identity spoofing', collection: 'bookings', op: 'create', expected: 'PERMISSION_DENIED' },
  { id: 12, name: 'Immutable studentId tampering on booking', collection: 'bookings', op: 'update', expected: 'PERMISSION_DENIED' },
] as const;
