import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
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
  imports: [FormsModule],
  template: `
    <main>
      <section class="page-hero">
        <div class="container page-header">
          <p class="eyebrow">Profile management</p>
          <h1>Manage your Urban Market JA account</h1>
          <p>Update contact details attached to your signed-in platform account.</p>
        </div>
      </section>

      <section class="container section">
        <form class="profile-form" (ngSubmit)="saveProfile()">
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
              <input name="parish" [(ngModel)]="profile.parish">
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
      </section>
    </main>
  `
})
export class ProfilePage implements OnInit {
  private readonly auth = inject(AuthService);
  protected readonly message = signal('');
  protected readonly isError = signal(false);
  protected readonly isSaving = signal(false);

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
}
