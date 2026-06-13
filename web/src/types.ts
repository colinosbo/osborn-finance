// Profile-related types. App-owned fields are editable via our API; Entra-owned
// fields (email verification, password, MFA methods) are read-only mirrors here.

export interface SecurityInfo {
  mfaEnabled: boolean;
  methods: ('app' | 'sms' | 'email')[];
  lastPasswordChange?: string; // ISO; sourced from Entra in production
  lastMfaUpdate?: string;      // ISO
  recoveryEmail?: string;      // security info (Entra-owned in prod)
  recoveryPhone?: string;
  authenticatorApp?: boolean;  // authenticator app registered
}

export interface Session {
  id: string;
  device: string;       // 'Chrome on macOS'
  location: string;     // 'New York, US' (approx)
  lastActive: string;   // ISO
  current: boolean;
}

export interface ActivityEvent {
  id: string;
  event: string;        // 'sign_in' | 'data_export' | 'bank_linked' | ...
  detail?: string;
  at: string;           // ISO
}

export interface Profile {
  id: string;
  email: string;            // Entra-owned, read-only
  emailVerified: boolean;
  displayName: string;      // app-owned, editable
  preferredName?: string;
  phone?: string;
  avatarUrl?: string | null;
  plan: 'free' | 'personal' | 'family' | 'enterprise' | string;
  memberSince?: string;     // ISO (users.created_at)
  security: SecurityInfo;
  sessions: Session[];
  activity: ActivityEvent[];
}
