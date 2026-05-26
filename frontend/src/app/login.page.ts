import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from './auth.service';
import { CartService } from './cart.service';
import { AccountRole } from './market-data';

@Component({
  selector: 'app-login-page',
  imports: [FormsModule, RouterLink],
  template: `
    <main>
      <section class="page-hero">
        <div class="container page-header">
          <p class="eyebrow">Secure access</p>
          <h1>Sign in to Urban Market JA</h1>
          <p>Use your registered customer, vendor, or admin account.</p>
        </div>
      </section>

      <section class="container section">
        <form class="profile-form auth-form" (ngSubmit)="login()">
          <label>Email or phone <input name="emailPhone" [(ngModel)]="emailPhone" required></label>
          <label>Password <input name="password" type="password" [(ngModel)]="password" required></label>
          <div class="checkout-actions">
            <button class="button primary-button" type="submit">Sign in</button>
            <a routerLink="/signup" [queryParams]="signupQueryParams()">Create an account</a>
          </div>
          @if (errorMessage) {
            <div class="notice error">{{ errorMessage }}</div>
          }
        </form>
      </section>
    </main>
  `
})
export class LoginPage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly cart = inject(CartService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected emailPhone = '';
  protected password = '';
  protected errorMessage = '';

  ngOnInit(): void {
    const user = this.auth.currentUser();
    if (user) {
      void this.router.navigateByUrl(this.dashboardUrl(user.role));
    }
  }

  protected signupQueryParams(): { returnUrl?: string } {
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    return returnUrl ? { returnUrl } : {};
  }

  protected async login(): Promise<void> {
    this.errorMessage = '';
    try {
      const user = await this.auth.login(this.emailPhone, this.password);
      if (user.role === 'customer') {
        await this.cart.syncLocalCartToAccount();
      }
      const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
      if (returnUrl) {
        void this.router.navigateByUrl(returnUrl);
        return;
      }

      void this.router.navigateByUrl(this.dashboardUrl(user.role));
    } catch {
      this.errorMessage = 'Sign in failed. Check the email/phone and password.';
    }
  }

  private dashboardUrl(role: AccountRole): string {
    if (role === 'admin') return '/admin';
    if (role === 'vendor') return '/vendor-dashboard';
    return '/user-dashboard';
  }
}
