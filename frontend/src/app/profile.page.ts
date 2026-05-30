import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { apiUrl } from './api-url';
import { AuthService } from './auth.service';

interface AccountProfile {
  id?: string;
  name: string;
  email: string;
  phone: string;
  parish: string;
  role: string;
  status?: string;
}

@Component({
  selector: 'app-profile-page',
  imports: [FormsModule, RouterLink],
  template: `
    <main>
      <section class="page-hero">
        <div class="container page-header">
          <p class="eyebrow">Profile management</p>
          <h1>Manage your Urban Market JA account</h1>
          <p>Update contact details attached to your signed-in platform account.</p>
        </div>
      </section>

      <section class="container section profile-layout">
        <form class="profile-form" (ngSubmit)="saveProfile()">
          <h2>Account details</h2>
          <p class="product-meta">Keep your contact details current for orders, alerts, and account access.</p>
          <label>
            Full name
            <input name="name" [(ngModel)]="profile.name" required>
          </label>
          <label>
            Email
            <input name="email" type="email" [(ngModel)]="profile.email">
          </label>
          <label>
            Phone
            <input name="phone" [(ngModel)]="profile.phone">
          </label>
          @if (profile.role === 'customer') {
            <label>
              Parish
              <select name="parish" [(ngModel)]="profile.parish">
                <option value="">Select parish</option>
                @for (parish of parishOptions; track parish) {
                  <option [value]="parish">{{ parish }}</option>
                }
              </select>
            </label>
          }
          <label>
            Account role
            <input name="role" [value]="profile.role" disabled>
          </label>
          <button class="button primary-button" type="submit" [disabled]="isSaving()">{{ isSaving() ? 'Saving...' : 'Save profile' }}</button>
          @if (message()) {
            <div class="notice" [class.error]="isError()">{{ message() }}</div>
          }
        </form>

        <aside class="dashboard-card account-context-card">
          <span class="product-tag">{{ roleLabel() }}</span>
          <h2>{{ accountHeading() }}</h2>
          <p>{{ accountDescription() }}</p>
          <div class="account-action-grid">
            <a class="button primary-button" [routerLink]="dashboardLink()">{{ dashboardLabel() }}</a>
            @if (profile.role === 'vendor') {
              <a class="button outline-button" routerLink="/vendor-dashboard">Edit store location</a>
            }
            @if (profile.role === 'customer') {
              <a class="button outline-button" routerLink="/user-dashboard">Delivery addresses</a>
            }
            @if (profile.role === 'admin') {
              <a class="button outline-button" routerLink="/admin">Manage vendors</a>
            }
          </div>
        </aside>
      </section>
    </main>
  `
})
export class ProfilePage implements OnInit {
  private readonly auth = inject(AuthService);
  protected readonly message = signal('');
  protected readonly isError = signal(false);
  protected readonly isSaving = signal(false);
  protected readonly parishOptions = ['Kingston', 'St. Andrew', 'St. Catherine', 'Clarendon', 'Manchester', 'St. Elizabeth', 'Westmoreland', 'Hanover', 'St. James', 'Trelawny', 'St. Ann', 'St. Mary', 'Portland', 'St. Thomas'];

  protected profile: AccountProfile = {
    name: '',
    email: '',
    phone: '',
    parish: '',
    role: ''
  };

  ngOnInit(): void {
    void this.loadProfile();
  }

  protected async loadProfile(): Promise<void> {
    try {
      const response = await fetch(apiUrl('/api/profile/me'), { headers: this.auth.authHeaders() });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Profile could not be loaded.');
      }
      this.profile = {
        id: payload.id,
        name: payload.name || '',
        email: payload.email || (String(payload.emailPhone || '').includes('@') ? payload.emailPhone : ''),
        phone: payload.phone || (!String(payload.emailPhone || '').includes('@') ? payload.emailPhone : ''),
        parish: payload.parish || '',
        role: payload.role || '',
        status: payload.status
      };
    } catch (error) {
      this.isError.set(true);
      this.message.set(error instanceof Error ? error.message : 'Profile could not be loaded.');
    }
  }

  protected async saveProfile(): Promise<void> {
    this.isSaving.set(true);
    this.isError.set(false);
    this.message.set('');
    try {
      const response = await fetch(apiUrl('/api/profile/me'), {
        method: 'POST',
        headers: this.auth.authHeaders(),
        body: JSON.stringify(this.profile)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Profile could not be saved.');
      }
      this.profile = { ...this.profile, ...payload };
      this.auth.updateCurrentUser({
        name: this.profile.name,
        emailPhone: this.profile.email || this.profile.phone
      });
      this.message.set('Profile saved.');
    } catch (error) {
      this.isError.set(true);
      this.message.set(error instanceof Error ? error.message : 'Profile could not be saved.');
    } finally {
      this.isSaving.set(false);
    }
  }

  protected roleLabel(): string {
    return this.profile.role ? this.profile.role : 'account';
  }

  protected dashboardLink(): string {
    if (this.profile.role === 'vendor') return '/vendor-dashboard';
    if (this.profile.role === 'admin') return '/admin';
    return '/user-dashboard';
  }

  protected dashboardLabel(): string {
    if (this.profile.role === 'vendor') return 'Open vendor dashboard';
    if (this.profile.role === 'admin') return 'Open admin dashboard';
    return 'Open customer dashboard';
  }

  protected accountHeading(): string {
    if (this.profile.role === 'vendor') return 'Vendor workspace';
    if (this.profile.role === 'admin') return 'Platform management';
    return 'Customer account';
  }

  protected accountDescription(): string {
    if (this.profile.role === 'vendor') return 'Manage store profile, location, listings, orders, subscriptions, and payout details from your vendor dashboard.';
    if (this.profile.role === 'admin') return 'Review users, vendors, registrations, listings, orders, plans, and platform finance activity from the admin dashboard.';
    return 'Manage saved delivery addresses, orders, alerts, reviews, and checkout details from your customer dashboard.';
  }
}
