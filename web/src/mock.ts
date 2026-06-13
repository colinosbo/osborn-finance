// Phase 1 mock data so the Profile page is fully buildable without the backend
// endpoints or Azure. Replaced by real /api/me/* responses in Phase 2/3.
import type { Profile, Session, ActivityEvent } from './types';

const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString();

export function mockSessions(): Session[] {
  return [
    { id: 's1', device: 'Chrome on macOS', location: 'New York, US', lastActive: new Date().toISOString(), current: true },
    { id: 's2', device: 'Safari on iPhone', location: 'New York, US', lastActive: daysAgo(1), current: false },
    { id: 's3', device: 'Edge on Windows', location: 'Newark, US', lastActive: daysAgo(6), current: false }
  ];
}

export function mockActivity(): ActivityEvent[] {
  return [
    { id: 'a1', event: 'sign_in', detail: 'Chrome on macOS', at: new Date().toISOString() },
    { id: 'a2', event: 'data_export', detail: 'JSON export', at: daysAgo(2) },
    { id: 'a3', event: 'bank_linked', detail: 'Mock Community Bank', at: daysAgo(9) },
    { id: 'a4', event: 'plan_activated', detail: 'personal', at: daysAgo(9) },
    { id: 'a5', event: 'sign_in', detail: 'Safari on iPhone', at: daysAgo(1) }
  ];
}

// Build a Profile from whatever /api/me returned, filling the not-yet-built
// fields with mock values. `me` is the existing { email, plan, ... } shape.
export function mockProfile(me?: Partial<Profile> & { email?: string; plan?: string; id?: string }): Profile {
  return {
    id: me?.id || 'usr_mock',
    email: me?.email || 'demo@osbornfinance.com',
    emailVerified: true,
    displayName: me?.displayName || (me?.email ? me.email.split('@')[0] : 'Demo User'),
    preferredName: me?.preferredName || '',
    phone: me?.phone || '',
    avatarUrl: me?.avatarUrl ?? null,
    plan: me?.plan || 'free',
    memberSince: me?.memberSince || daysAgo(120),
    security: {
      mfaEnabled: false,
      methods: [],
      lastPasswordChange: daysAgo(45),
      lastMfaUpdate: undefined,
      recoveryEmail: '',
      recoveryPhone: '',
      authenticatorApp: false
    },
    sessions: mockSessions(),
    activity: mockActivity()
  };
}

export const ACTIVITY_LABEL: Record<string, string> = {
  sign_in: 'Signed in',
  data_export: 'Exported data',
  bank_linked: 'Linked a bank',
  bank_unlinked: 'Unlinked a bank',
  plan_activated: 'Plan activated',
  plan_updated: 'Plan changed',
  password_change: 'Password changed',
  mfa_updated: 'MFA updated'
};
