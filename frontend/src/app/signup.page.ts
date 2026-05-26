import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from './auth.service';
import { CartService } from './cart.service';
import { AccountRole } from './market-data';

@Component({
  selector: 'app-signup-page',
  imports: [FormsModule, RouterLink],
  template: `
    <main>
      <section class="page-hero">
        <div class="container page-header">
          <p class="eyebrow">New account</p>
          <h1>Create your Urban Market JA account</h1>
          <p>Choose customer or vendor to get started. Vendors can provide business details for verification.</p>
        </div>
      </section>

      <section class="container section">
        <form class="profile-form auth-form" (ngSubmit)="signup()">
          <label>Full name <input name="name" [(ngModel)]="name" required></label>
          <label>Email or phone <input name="emailPhone" [(ngModel)]="emailPhone" required></label>
          <label>Password <input name="password" type="password" [(ngModel)]="password" required></label>
          <label>Confirm password <input name="confirmPassword" type="password" [(ngModel)]="confirmPassword" required></label>
          <label>
            Account type
            <select name="accountType" [(ngModel)]="role">
              <option value="customer">Customer</option>
              <option value="vendor">Vendor</option>
            </select>
          </label>

          @if (role === 'vendor') {
            <div class="form-grid">
              <label>Business name <input name="businessName" [(ngModel)]="businessName"></label>
              <label>Business location <input name="businessLocation" [(ngModel)]="businessLocation"></label>
              <label>
                Store type
                <select name="storeType" [(ngModel)]="storeType">
                  <option value="products">Products</option>
                  <option value="foods">Foods</option>
                  <option value="services">Services</option>
                  <option value="mixed">Mixed store</option>
                </select>
              </label>
            </div>
          }

          @if (errorMessage) {
            <div class="notice error">{{ errorMessage }}</div>
          }

          <div class="checkout-actions">
            <button class="button primary-button" type="submit">Create account</button>
            <a routerLink="/login">Already have an account?</a>
          </div>
        </form>
      </section>
    </main>
  `
})
export class SignupPage {
  private readonly auth = inject(AuthService);
  private readonly cart = inject(CartService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected name = '';
  protected emailPhone = '';
  protected password = '';
  protected confirmPassword = '';
  protected role: AccountRole = 'customer';
  protected businessName = '';
  protected businessLocation = '';
  protected storeType = 'products';
  protected errorMessage = '';

  protected async signup(): Promise<void> {
    if (this.password !== this.confirmPassword) {
      this.errorMessage = 'Passwords must match.';
      return;
    }

    try {
      const user = await this.auth.signup({
        name: this.name,
        emailPhone: this.emailPhone,
        role: this.role,
        businessName: this.role === 'vendor' ? this.businessName : undefined,
        businessLocation: this.role === 'vendor' ? this.businessLocation : undefined,
        storeType: this.role === 'vendor' ? this.storeType : undefined
      }, this.password);
      if (user.role === 'customer') {
        await this.cart.syncLocalCartToAccount();
      }

      const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
      void this.router.navigateByUrl(returnUrl || (user.role === 'vendor' ? '/vendor-dashboard' : '/user-dashboard'));
    } catch {
      this.errorMessage = 'Account could not be created. Check the details and try again.';
    }
  }
}
