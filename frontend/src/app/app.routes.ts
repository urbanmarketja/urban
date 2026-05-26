import { Routes } from '@angular/router';
import { HomePage } from './home.page';
import { AlertsPage } from './alerts.page';
import { AdminPage } from './admin.page';
import { CartPage } from './cart.page';
import { CheckoutPage } from './checkout.page';
import { DashboardAccessPage } from './dashboard-access.page';
import { FoodsPage } from './foods.page';
import { JobDetailPage } from './job-detail.page';
import { JobsPage } from './jobs.page';
import { MarketplacePage } from './marketplace.page';
import { OrderDetailPage } from './order-detail.page';
import { PostJobPage } from './post-job.page';
import { ProfilePage } from './profile.page';
import { LoginPage } from './login.page';
import { ServiceDetailPage } from './service-detail.page';
import { ServicesPage } from './services.page';
import { SignupPage } from './signup.page';
import { UserDashboardPage } from './user-dashboard.page';
import { VendorDashboardPage } from './vendor-dashboard.page';
import { VendorStorePage } from './vendor-store.page';
import { requireAuth } from './auth.guard';

export const routes: Routes = [
  { path: '', component: HomePage },
  { path: 'marketplace', component: MarketplacePage },
  { path: 'login', component: LoginPage },
  { path: 'signup', component: SignupPage },
  { path: 'dashboard-access', component: DashboardAccessPage, canActivate: [requireAuth] },
  { path: 'alerts', component: AlertsPage, canActivate: [requireAuth] },
  { path: 'user-dashboard', component: UserDashboardPage, canActivate: [requireAuth], data: { roles: ['customer', 'admin'] } },
  { path: 'admin', component: AdminPage, canActivate: [requireAuth], data: { roles: ['admin'] } },
  { path: 'services', component: ServicesPage },
  { path: 'services/:id', component: ServiceDetailPage },
  { path: 'foods', component: FoodsPage },
  { path: 'jobs', component: JobsPage },
  { path: 'jobs/post', component: PostJobPage, canActivate: [requireAuth], data: { roles: ['vendor', 'admin'] } },
  { path: 'jobs/:id', component: JobDetailPage },
  { path: 'cart', component: CartPage },
  { path: 'checkout', component: CheckoutPage, canActivate: [requireAuth], data: { roles: ['customer', 'admin'] } },
  { path: 'orders/:id', component: OrderDetailPage, canActivate: [requireAuth], data: { roles: ['customer', 'admin'] } },
  { path: 'vendor-dashboard', component: VendorDashboardPage, canActivate: [requireAuth], data: { roles: ['vendor', 'admin'] } },
  { path: 'profile', component: ProfilePage, canActivate: [requireAuth] },
  { path: 'vendor/:slug', component: VendorStorePage },
  { path: '**', redirectTo: '' }
];
