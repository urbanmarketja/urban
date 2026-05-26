import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { JobService } from './job.service';
import { formatCurrency } from './market-data';

@Component({
  selector: 'app-jobs-page',
  imports: [FormsModule, RouterLink],
  template: `
    <main>
      <section class="page-hero">
        <div class="container page-header">
          <p class="eyebrow">Jobs</p>
          <h1>Hire local talent or find your next opportunity</h1>
          <p>Search jobs, filter by category, location, salary, and type, then apply or post a listing.</p>
        </div>
      </section>

      <section class="container section">
        <div class="job-tools">
          <div>
            <h2>Explore job openings</h2>
            <p>Browse recent listings from businesses, vendors, and the community.</p>
          </div>
          <a class="button primary-button" routerLink="/jobs/post">Post a job</a>
        </div>

        <div class="job-filter-panel">
          <label>Keyword <input type="search" [(ngModel)]="search" placeholder="Search title, employer, description"></label>
          <label>Category <select [(ngModel)]="category"><option value="all">All categories</option>@for (item of categories(); track item) { <option [value]="item">{{ item }}</option> }</select></label>
          <label>Location <select [(ngModel)]="location"><option value="all">All locations</option>@for (item of locations(); track item) { <option [value]="item">{{ item }}</option> }</select></label>
          <label>Type <select [(ngModel)]="type"><option value="all">All types</option>@for (item of types(); track item) { <option [value]="item">{{ item }}</option> }</select></label>
          <label>Salary <select [(ngModel)]="salaryRange"><option value="all">Any</option><option value="0-1500">Up to JMD 1,500</option><option value="1500-3000">JMD 1,500 - 3,000</option><option value="3000-999999">JMD 3,000+</option></select></label>
        </div>

        @if (jobService.error()) {
          <div class="notice error">{{ jobService.error() }}</div>
        }

        <div class="job-grid">
          @for (job of filteredJobs(); track job.id) {
            <article class="job-card">
              <div class="job-card-header">
                <span class="card-icon">💼</span>
                <span class="product-tag">{{ job.category }}</span>
                <span class="job-badge">{{ job.type }}</span>
              </div>
              <h3>{{ job.title }}</h3>
              <p><strong>Employer:</strong> {{ job.employer }}</p>
              <p><strong>Location:</strong> {{ job.location }}</p>
              <p><strong>Salary:</strong> {{ money(job.salary) }}</p>
              <p><strong>Deadline:</strong> {{ dateLabel(job.deadline) }}</p>
              <div class="hero-actions">
                <a class="button secondary-button" [routerLink]="['/jobs', job.id]">View details</a>
                <a class="button primary-button" [routerLink]="['/jobs', job.id]">Apply now</a>
              </div>
            </article>
          } @empty {
            <div class="cart-empty">No job listings match your filters.</div>
          }
        </div>
      </section>
    </main>
  `
})
export class JobsPage implements OnInit {
  protected readonly jobService = inject(JobService);
  protected readonly money = formatCurrency;
  protected search = '';
  protected category = 'all';
  protected location = 'all';
  protected type = 'all';
  protected salaryRange = 'all';

  protected readonly categories = computed(() => [...new Set(this.jobService.jobs().map((job) => job.category))].sort());
  protected readonly locations = computed(() => [...new Set(this.jobService.jobs().map((job) => job.location))].sort());
  protected readonly types = computed(() => [...new Set(this.jobService.jobs().map((job) => job.type))].sort());

  ngOnInit(): void {
    void this.jobService.refresh();
  }

  protected filteredJobs() {
    const search = this.search.toLowerCase();
    const [minSalary, maxSalary] = this.salaryRange === 'all' ? [0, Infinity] : this.salaryRange.split('-').map(Number);
    return this.jobService.jobs().filter((job) => {
      const matchesSearch = !search || [job.title, job.employer, job.description].some((field) => field.toLowerCase().includes(search));
      return matchesSearch
        && (this.category === 'all' || job.category === this.category)
        && (this.location === 'all' || job.location === this.location)
        && (this.type === 'all' || job.type === this.type)
        && job.salary >= minSalary
        && job.salary <= maxSalary
        && job.isApproved;
    });
  }

  protected dateLabel(value: string): string {
    return new Date(value).toLocaleDateString();
  }
}
