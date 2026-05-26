import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { apiUrl } from './api-url';
import { AuthService } from './auth.service';
import { MarketApiService } from './market-api.service';
import { formatCurrency } from './market-data';

@Component({
  selector: 'app-service-detail-page',
  imports: [FormsModule, RouterLink],
  template: `
    <main>
      @if (service(); as item) {
        <section class="page-hero">
          <div class="container page-header">
            <p class="eyebrow">{{ item.category }}</p>
            <h1>{{ item.name }}</h1>
            <p>{{ item.description }}</p>
            <p class="vendor-meta">{{ item.vendor }} · {{ item.rating }} star · {{ money(item.price) }} {{ item.pricingType }}</p>
          </div>
        </section>

        <section class="container section split-grid">
          <article class="dashboard-card">
            <h2>What's included</h2>
            <p>{{ item.details }}</p>
            <h2>Reviews</h2>
            <div class="review-list">
              @for (review of item.reviews; track review.name) {
                <article class="review-card">
                  <strong>{{ review.name }} · {{ review.rating }} star</strong>
                  <p>{{ review.comment }}</p>
                </article>
              }
            </div>
            <h2>Nearby services</h2>
            <div class="service-grid compact">
              @for (nearby of nearbyServices(); track nearby.id) {
                <a class="nearby-card" [routerLink]="['/services', nearby.id]">
                  <strong>{{ nearby.name }}</strong>
                  <span>{{ nearby.vendor }} · {{ money(nearby.price) }}</span>
                </a>
              }
            </div>
          </article>

          <form class="profile-form" (ngSubmit)="confirmBooking(item.name)">
            <h2>Book service</h2>
            <label>
              Select a date
              <input name="date" type="date" [(ngModel)]="booking.date" required>
            </label>
            <label>
              Select a time
              <input name="time" type="time" [(ngModel)]="booking.time" required>
            </label>
            <label>
              Location
              <input name="location" [(ngModel)]="booking.location" placeholder="Street, parish, notes" required>
            </label>
            <label>
              Booking notes
              <textarea name="notes" [(ngModel)]="booking.notes" rows="4"></textarea>
            </label>
            <button class="button primary-button" type="submit" [disabled]="isBooking()">{{ isBooking() ? 'Booking...' : 'Confirm booking' }}</button>
            @if (bookingMessage()) {
              <div class="notice" [class.error]="bookingError()">{{ bookingMessage() }}</div>
            }
            @if (pendingBooking(); as pending) {
              <div class="notice">
                <strong>Payment needed</strong>
                <p>{{ money(pending.total || 0) }} must be confirmed before the vendor receives held Market Credits.</p>
                @if (pending.paymentSession?.id) {
                  <button class="button secondary-button" type="button" (click)="confirmServicePayment(pending.paymentSession.id)" [disabled]="isBooking()">Confirm service payment</button>
                }
              </div>
            }
          </form>
        </section>
      } @else {
        <section class="container section">
          <h1>Service not found</h1>
          <a routerLink="/services">Back to services</a>
        </section>
      }
    </main>
  `
})
export class ServiceDetailPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly market = inject(MarketApiService);
  protected readonly money = formatCurrency;
  protected readonly bookingMessage = signal('');
  protected readonly bookingError = signal(false);
  protected readonly isBooking = signal(false);
  protected readonly pendingBooking = signal<any | null>(null);

  protected booking = {
    date: '',
    time: '',
    location: '',
    notes: ''
  };

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    void this.market.loadMarketplace();
    void this.market.loadService(id);
  }

  protected readonly service = computed(() => {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    return this.market.services().find((item) => item.id === id);
  });

  protected nearbyServices() {
    const item = this.service();
    return item ? this.market.services().filter((service) => service.category === item.category && service.id !== item.id).slice(0, 2) : [];
  }

  protected async confirmBooking(serviceName: string): Promise<void> {
    const item = this.service();
    if (!item) return;
    if (!this.auth.isSignedIn()) {
      await this.router.navigate(['/login'], { queryParams: { returnUrl: `/services/${item.id}` } });
      return;
    }
    if (this.auth.currentUser()?.role === 'vendor') {
      this.bookingError.set(true);
      this.bookingMessage.set('Vendor accounts cannot book services. Sign in as a customer to book.');
      return;
    }

    this.isBooking.set(true);
    this.bookingError.set(false);
    this.bookingMessage.set('');
    try {
      const booking = { serviceId: item.id, serviceName, ...this.booking, bookedAt: new Date().toISOString() };
      const response = await fetch(apiUrl('/api/bookings'), {
        method: 'POST',
        headers: this.auth.authHeaders(),
        body: JSON.stringify(booking)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Booking could not be confirmed.');
      }
      this.pendingBooking.set(payload);
      this.bookingMessage.set(`Your booking request for ${serviceName} is saved for ${this.booking.date} at ${this.booking.time}. Confirm payment so the vendor can start.`);
      this.booking = { date: '', time: '', location: '', notes: '' };
    } catch (error) {
      this.bookingError.set(true);
      this.bookingMessage.set(error instanceof Error ? error.message : 'Booking could not be confirmed.');
    } finally {
      this.isBooking.set(false);
    }
  }

  protected async confirmServicePayment(paymentSessionId: string): Promise<void> {
    this.isBooking.set(true);
    this.bookingError.set(false);
    try {
      const response = await fetch(apiUrl(`/api/payments/sessions/${paymentSessionId}/mock-pay`), {
        method: 'POST',
        headers: this.auth.authHeaders(),
        body: JSON.stringify({})
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Service payment could not be confirmed.');
      }
      this.pendingBooking.set(null);
      this.bookingMessage.set('Service payment confirmed. Vendor credits are now held until you confirm the service was completed.');
    } catch (error) {
      this.bookingError.set(true);
      this.bookingMessage.set(error instanceof Error ? error.message : 'Service payment could not be confirmed.');
    } finally {
      this.isBooking.set(false);
    }
  }
}
