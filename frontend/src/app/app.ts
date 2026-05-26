import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './auth.service';
import { CartService } from './cart.service';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly cart = inject(CartService);
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected dashboardLink(): string {
    const role = this.auth.currentUser()?.role;
    if (role === 'admin') return '/admin';
    if (role === 'vendor') return '/vendor-dashboard';
    return '/user-dashboard';
  }

  protected dashboardLabel(): string {
    const role = this.auth.currentUser()?.role;
    if (role === 'admin') return 'Admin';
    if (role === 'vendor') return 'Dashboard';
    return 'Account';
  }

  protected signOut(): void {
    this.auth.logout();
    void this.router.navigateByUrl('/');
  }
}
