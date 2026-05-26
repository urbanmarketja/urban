import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-dashboard-access-page',
  imports: [RouterLink],
  template: `
    <main>
      <section class="page-hero">
        <div class="container page-header">
          <p class="eyebrow">Dashboard access</p>
          <h1>Vendor and owner tools are separated</h1>
          <p>Dashboard access is kept away from the public homepage so operational areas stay clearer.</p>
        </div>
      </section>

      <section class="container section dashboard-grid">
        <article class="dashboard-card">
          <h2>Customer dashboard</h2>
          <p>Track product orders, service bookings, and job applications.</p>
          <a class="button secondary-button" routerLink="/user-dashboard">Go to customer dashboard</a>
        </article>
        <article class="dashboard-card">
          <h2>Vendor dashboard</h2>
          <p>Manage store status, products, subscriptions, registration support, and share tools.</p>
          <a class="button secondary-button" routerLink="/vendor-dashboard">Go to vendor dashboard</a>
        </article>
        <article class="dashboard-card owner-card">
          <h2>Owner admin dashboard</h2>
          <p>Restricted area for moderation, vendor oversight, revenue, and marketplace operations.</p>
          <a class="button primary-button" routerLink="/login">Owner login</a>
        </article>
      </section>
    </main>
  `
})
export class DashboardAccessPage {}
