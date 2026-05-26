import { Injectable, inject, signal } from '@angular/core';
import { apiUrl } from './api-url';
import { AuthService } from './auth.service';
import { SubscriptionPlan, Vendor } from './market-data';

export interface PaymentSession {
  id: string;
  vendorId: string;
  planId: string;
  amount: number;
  status: 'created' | 'pending' | 'paid' | 'failed' | 'refunded';
  checkoutUrl: string;
  provider?: string;
  providerSessionId?: string;
}

interface MockCheckoutResult {
  session: PaymentSession;
  vendor?: Vendor;
  processed?: boolean;
  alreadyProcessed?: boolean;
}

const SESSION_KEY = 'urbanMarketJAPaymentSessions';

@Injectable({ providedIn: 'root' })
export class SubscriptionService {
  private readonly auth = inject(AuthService);
  private readonly sessionsSignal = signal<PaymentSession[]>(this.loadSessions());
  readonly sessions = this.sessionsSignal.asReadonly();

  async createCheckout(vendor: Vendor, plan: SubscriptionPlan): Promise<PaymentSession> {
    const response = await fetch(apiUrl('/api/subscriptions/checkout'), {
      method: 'POST',
      headers: this.auth.authHeaders(),
      body: JSON.stringify({ vendorId: vendor.id, planId: plan.id })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || 'Checkout session could not be created.');
    }

    const session = payload as PaymentSession;
    const next = [...this.sessionsSignal().filter((item) => item.id !== session.id), session];
    this.sessionsSignal.set(next);
    this.saveSessions(next);
    return session;
  }

  async completeMockCheckout(sessionId: string): Promise<MockCheckoutResult> {
    const response = await fetch(apiUrl(`/api/subscriptions/sessions/${encodeURIComponent(sessionId)}/mock-pay`), {
      method: 'POST',
      headers: this.auth.authHeaders(),
      body: JSON.stringify({})
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || 'Payment could not be completed.');
    }

    const result = payload as MockCheckoutResult;
    if (result.session?.id) {
      this.markPaid(result.session.id);
    }
    return result;
  }

  markPaid(sessionId: string): void {
    const next = this.sessionsSignal().map((session) => session.id === sessionId ? { ...session, status: 'paid' as const } : session);
    this.sessionsSignal.set(next);
    this.saveSessions(next);
  }

  private loadSessions(): PaymentSession[] {
    if (typeof localStorage === 'undefined') {
      return [];
    }

    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) as PaymentSession[] : [];
    } catch {
      return [];
    }
  }

  private saveSessions(sessions: PaymentSession[]): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SESSION_KEY, JSON.stringify(sessions));
    }
  }
}
