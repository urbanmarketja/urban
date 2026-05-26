import { Injectable, computed, signal } from '@angular/core';
import { apiUrl } from './api-url';
import { AccountRole, AccountUser } from './market-data';

const CURRENT_USER_KEY = 'urbanMarketJACurrentUser';
const TOKEN_KEY = 'urbanMarketJAAuthToken';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly currentUserSignal = signal<AccountUser | null>(this.loadCurrentUser());
  readonly currentUser = this.currentUserSignal.asReadonly();
  readonly isSignedIn = computed(() => this.currentUserSignal() !== null);

  async login(emailPhone: string, password: string): Promise<AccountUser> {
    const response = await this.post<{ user: AccountUser; token: string }>('/api/auth/login', { emailPhone, password }, false);
    this.setToken(response.token);
    this.setCurrentUser(response.user);
    return response.user;
  }

  async signup(user: Omit<AccountUser, 'id'>, password: string): Promise<AccountUser> {
    const response = await this.post<{ user: AccountUser; token: string }>('/api/auth/signup', { ...user, password }, false);
    this.setToken(response.token);
    this.setCurrentUser(response.user);
    return response.user;
  }

  logout(): void {
    this.currentUserSignal.set(null);
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(CURRENT_USER_KEY);
      localStorage.removeItem(TOKEN_KEY);
    }
    this.post('/api/auth/logout', {}).catch(() => undefined);
  }

  updateCurrentUser(patch: Partial<AccountUser>): void {
    const current = this.currentUserSignal();
    if (!current) return;
    this.setCurrentUser({ ...current, ...patch });
  }

  ensureRole(role: AccountRole): boolean {
    return this.currentUserSignal()?.role === role;
  }

  authHeaders(): Record<string, string> {
    const token = this.getToken();
    return token
      ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
      : { 'Content-Type': 'application/json' };
  }

  private setCurrentUser(user: AccountUser): void {
    this.currentUserSignal.set(user);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
    }
  }

  private setToken(token: string): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(TOKEN_KEY, token);
    }
  }

  private getToken(): string {
    if (typeof localStorage === 'undefined') {
      return '';
    }
    return localStorage.getItem(TOKEN_KEY) || '';
  }

  private loadCurrentUser(): AccountUser | null {
    if (typeof localStorage === 'undefined') {
      return null;
    }

    try {
      const raw = localStorage.getItem(CURRENT_USER_KEY);
      return raw ? JSON.parse(raw) as AccountUser : null;
    } catch {
      return null;
    }
  }

  private async post<T = unknown>(path: string, body: unknown, includeAuth = true): Promise<T> {
    const response = await fetch(apiUrl(path), {
      method: 'POST',
      headers: includeAuth ? this.authHeaders() : { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error('API request failed');
    }
    return await response.json() as T;
  }
}
