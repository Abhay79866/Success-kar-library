# Firestore Security Specification (Admin-Only Library Seat Booking System)

## 1. Data Invariants
1. **Admin-Only Access**: All read and write access to `students`, `floors`, `seats`, `categories`, `time_slots`, and `bookings` is strictly restricted to authenticated, email-verified administrators (`isAdmin()`). Unauthenticated callers have zero access.
2. **Identity & Role Integrity**: Non-super-admins cannot escalate privileges or inject arbitrary admin records. The bootstrapped owner email (`2004abhaypatel@gmail.com`, verified) can initialize their own `admins/{uid}` record as `super_admin`.
3. **Strict Schema Enforcement**: Every document creation and update validates exact allowed keys (`hasAll` + `hasOnly`), data types, bounded string lengths, valid ID regex (`^[a-zA-Z0-9_\\-]+$`), and server timestamps (`request.time`) for `createdAt` / `updatedAt`.
4. **Relational Integrity**:
   - A `Seat` must reference an existing `Floor` (`floorId`).
   - A `Booking` must reference an existing `Student`, `Seat`, `Floor`, and `TimeSlot`, and `bookedBy` must equal `request.auth.uid`.
5. **PII Isolation**: Student phone numbers are stored in `/students/{studentId}` and are readable only by verified admins (`isAdmin()`).
6. **Terminal State Protection**: Cancelled bookings (`status == 'cancelled'`) cannot be mutated by non-super-admin staff.

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return `PERMISSION_DENIED`)
1. **Unauthenticated Student Read**: `get /students/stu_01` with `auth == null`.
2. **Unverified Email Admin Spoof**: `list /students` with `email: "2004abhaypatel@gmail.com"`, `email_verified: false`.
3. **Non-Admin Signed-In User Read**: `get /students/stu_01` with `uid: "random_user"`, not in `/admins`.
4. **Self-Assigned Super Admin Escalation**: `create /admins/attacker` by `attacker` with `role: "super_admin"` (not bootstrapped email).
5. **Shadow Field Injection on Student**: `create /students/stu_02` by admin with extra ghost key `isFreeAccess: true`.
6. **Oversized Document ID Poisoning**: `create /students/<200-char-id>` by admin.
7. **Invalid Phone Length / Empty Name**: `create /students/stu_03` with `name: ""` or `phone: "1"`.
8. **Client-Spoofed Timestamp**: `create /categories/cat_01` with client-forged `createdAt` != `request.time`.
9. **Invalid Category Color Hex**: `create /categories/cat_02` with `colorHex: "red"` (violates `^#[0-9A-Fa-f]{6}$`).
10. **Orphaned Booking (Missing Seat)**: `create /bookings/bk_01` referencing non-existent `seatId: "missing_seat"`.
11. **Identity Spoofing on Booking**: `create /bookings/bk_02` by admin `uid_1` with `bookedBy: "uid_2"`.
12. **Immutable Field Tampering on Booking Update**: `update /bookings/bk_01` changing `studentId` or `createdAt`.
