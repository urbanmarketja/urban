import { Routes } from '@angular/router';
import { requireAuth } from './auth.guard';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./home.page').then((m) => m.HomePage) },
  { path: 'marketplace', loadComponent: () => import('./marketplace.page').then((m) => m.MarketplacePage) },
  { path: 'login', loadComponent: () => import('./login.page').then((m) => m.LoginPage) },
  { path: 'signup', loadComponent: () => import('./signup.page').then((m) => m.SignupPage) },
  { path: 'dashboard-access', loadComponent: () => import('./dashboard-access.page').then((m) => m.DashboardAccessPage), canActivate: [requireAuth] },
  { path: 'alerts', loadComponent: () => import('./alerts.page').then((m) => m.AlertsPage), canActivate: [requireAuth] },
  { path: 'user-dashboard', loadComponent: () => import('./user-dashboard.page').then((m) => m.UserDashboardPage), canActivate: [requireAuth], data: { roles: ['customer', 'admin'] } },
  { path: 'admin', loadComponent: () => import('./admin.page').then((m) => m.AdminPage), canActivate: [requireAuth], data: { roles: ['admin'] } },
  { path: 'services', loadComponent: () => import('./services.page').then((m) => m.ServicesPage) },
  { path: 'services/:id', loadComponent: () => import('./service-detail.page').then((m) => m.ServiceDetailPage) },
  { path: 'foods', loadComponent: () => import('./foods.page').then((m) => m.FoodsPage) },
  { path: 'jobs', loadComponent: () => import('./jobs.page').then((m) => m.JobsPage) },
  { path: 'jobs/post', loadComponent: () => import('./post-job.page').then((m) => m.PostJobPage), canActivate: [requireAuth], data: { roles: ['vendor', 'admin'] } },
  { path: 'jobs/:id', loadComponent: () => import('./job-detail.page').then((m) => m.JobDetailPage) },
  { path: 'cart', loadComponent: () => import('./cart.page').then((m) => m.CartPage) },
  { path: 'checkout', loadComponent: () => import('./checkout.page').then((m) => m.CheckoutPage), canActivate: [requireAuth], data: { roles: ['customer', 'admin'] } },
  { path: 'orders/:id', loadComponent: () => import('./order-detail.page').then((m) => m.OrderDetailPage), canActivate: [requireAuth], data: { roles: ['customer', 'admin'] } },
  { path: 'vendor-dashboard', loadComponent: () => import('./vendor-dashboard.page').then((m) => m.VendorDashboardPage), canActivate: [requireAuth], data: { roles: ['vendor', 'admin'] } },
  { path: 'profile', loadComponent: () => import('./profile.page').then((m) => m.ProfilePage), canActivate: [requireAuth] },
  { path: 'vendor/:slug', loadComponent: () => import('./vendor-store.page').then((m) => m.VendorStorePage) },
  { path: '**', redirectTo: '' }
];
