import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { JobService } from './job.service';
import { JobListing, formatCurrency } from './market-data';

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
          <label>Min salary <input type="number" min="0" [(ngModel)]="salaryMinFilter" placeholder="Any minimum"></label>
          <label>Max salary <input type="number" min="0" [(ngModel)]="salaryMaxFilter" placeholder="Any maximum"></label>
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
              <p><strong>Salary:</strong> {{ salaryLabel(job) }}</p>
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
  protected salaryMinFilter: number | null = null;
  protected salaryMaxFilter: number | null = null;

  protected readonly categories = computed(() => this.uniqueValues((job) => job.category));
  protected readonly locations = computed(() => this.uniqueValues((job) => job.location));
  protected readonly types = computed(() => this.uniqueValues((job) => job.type));

  ngOnInit(): void {
    void this.jobService.refresh();
  }

  protected filteredJobs() {
    const search = this.search.toLowerCase();
    const minSalary = Number(this.salaryMinFilter || 0);
    const maxSalary = Number(this.salaryMaxFilter || Infinity);
    return this.jobService.jobs().filter((job) => {
      const matchesSearch = !search || [job.title, job.employer, job.description].some((field) => field.toLowerCase().includes(search));
      const jobMin = Number(job.salaryMin ?? job.salary ?? 0);
      const jobMax = Number(job.salaryMax ?? jobMin);
      return matchesSearch
        && (this.category === 'all' || job.category === this.category)
        && (this.location === 'all' || job.location === this.location)
        && (this.type === 'all' || job.type === this.type)
        && jobMax >= minSalary
        && jobMin <= maxSalary
        && job.isApproved;
    });
  }

  protected salaryLabel(job: JobListing): string {
    const min = Number(job.salaryMin ?? job.salary ?? 0);
    const max = Number(job.salaryMax ?? min);
    return max > min ? `${this.money(min)} - ${this.money(max)}` : this.money(min);
  }

  protected dateLabel(value: string): string {
    return new Date(value).toLocaleDateString();
  }

  private uniqueValues(selector: (job: JobListing) => string): string[] {
    return [...new Set(this.jobService.jobs()
      .filter((job) => job.isApproved)
      .map((job) => selector(job).trim())
      .filter(Boolean))]
      .sort();
  }
}
