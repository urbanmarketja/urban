import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { apiUrl } from './api-url';
import { AuthService } from './auth.service';
import { JobService } from './job.service';
import { JobListing, formatCurrency } from './market-data';

@Component({
  selector: 'app-job-detail-page',
  imports: [FormsModule, RouterLink],
  template: `
    <main>
      @if (job(); as item) {
        <section class="page-hero">
          <div class="container page-header">
            <p class="eyebrow">{{ item.category }}</p>
            <h1>{{ item.title }}</h1>
            <p>{{ item.description }}</p>
          </div>
        </section>

        <section class="container section split-grid">
          <article class="dashboard-card">
            <div class="job-meta-row">
              <div><strong>{{ item.employer }}</strong><p>Employer</p></div>
              <div><strong>{{ item.location }}</strong><p>Location</p></div>
              <div><strong>{{ salaryLabel(item) }}</strong><p>Pay range</p></div>
              <div><strong>{{ item.type }}</strong><p>Type</p></div>
            </div>
            <h2>Responsibilities</h2>
            <ul>@for (task of item.responsibilities; track task) { <li>{{ task }}</li> }</ul>
            <h2>Requirements</h2>
            <ul>@for (requirement of item.requirements; track requirement) { <li>{{ requirement }}</li> }</ul>
            <p class="product-meta">Posted {{ dateLabel(item.postedAt) }} · Deadline {{ dateLabel(item.deadline) }}</p>
          </article>

          <form class="profile-form" (ngSubmit)="submitApplication(item.id, item.title, item.employer)">
            <h2>Apply now</h2>
            <label>Full name <input name="name" [(ngModel)]="application.name" required></label>
            <label>Contact number <input name="phone" [(ngModel)]="application.phone" required></label>
            <label>
              Resume PDF
              <input id="resumeFile" name="resumeFile" type="file" accept="application/pdf,.pdf" required (change)="selectResume($event)">
            </label>
            @if (application.resumeName) {
              <p class="product-meta">{{ application.resumeName }} - {{ resumeSizeLabel() }}</p>
            }
            <label>Cover message <textarea name="message" [(ngModel)]="application.message" rows="5"></textarea></label>
            <button class="button primary-button" type="submit">Submit application</button>
            @if (message()) {
              <div class="notice" [class.error]="isError()">{{ message() }}</div>
            }
          </form>
        </section>
      } @else {
        <section class="container section">
          <h1>Job not found</h1>
          <a routerLink="/jobs">Back to jobs</a>
        </section>
      }
    </main>
  `
})
export class JobDetailPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly jobService = inject(JobService);
  protected readonly money = formatCurrency;
  protected readonly message = signal('');
  protected readonly isError = signal(false);

  protected application = {
    name: '',
    phone: '',
    resumeName: '',
    resumeMimeType: '',
    resumeSizeBytes: 0,
    resumeDataBase64: '',
    message: ''
  };

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    void this.jobService.loadJob(id);
  }

  protected readonly job = computed(() => {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    return this.jobService.jobs().find((item) => item.id === id);
  });

  protected async submitApplication(jobId: string, jobTitle: string, employer: string): Promise<void> {
    if (!this.auth.isSignedIn()) {
      await this.router.navigate(['/login'], { queryParams: { returnUrl: `/jobs/${jobId}` } });
      return;
    }
    if (this.auth.currentUser()?.role === 'vendor') {
      this.isError.set(true);
      this.message.set('Vendor accounts cannot apply for jobs. Sign in as a customer to apply.');
      return;
    }

    this.isError.set(false);
    this.message.set('');
    if (!this.application.resumeDataBase64) {
      this.isError.set(true);
      this.message.set('Upload your resume as a PDF before submitting.');
      return;
    }

    try {
      const response = await fetch(apiUrl(`/api/jobs/${jobId}/applications`), {
        method: 'POST',
        headers: this.auth.authHeaders(),
        body: JSON.stringify({
          applicantName: this.application.name,
          phone: this.application.phone,
          resumeName: this.application.resumeName,
          resumeMimeType: this.application.resumeMimeType,
          resumeSizeBytes: this.application.resumeSizeBytes,
          resumeDataBase64: this.application.resumeDataBase64,
          message: this.application.message
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Application could not be submitted.');
      }
      this.jobService.addApplication({
        jobId,
        jobTitle,
        employer,
        applicantName: this.application.name,
        phone: this.application.phone,
        resumeName: this.application.resumeName,
        message: this.application.message
      });
      this.message.set('Application submitted. Your status is now pending.');
      this.application = { name: '', phone: '', resumeName: '', resumeMimeType: '', resumeSizeBytes: 0, resumeDataBase64: '', message: '' };
      const input = typeof document !== 'undefined' ? document.getElementById('resumeFile') as HTMLInputElement | null : null;
      if (input) input.value = '';
    } catch (error) {
      this.isError.set(true);
      this.message.set(error instanceof Error ? error.message : 'Application could not be submitted.');
    }
  }

  protected selectResume(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    this.isError.set(false);
    this.message.set('');

    this.application.resumeName = '';
    this.application.resumeMimeType = '';
    this.application.resumeSizeBytes = 0;
    this.application.resumeDataBase64 = '';

    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      this.isError.set(true);
      this.message.set('Resume must be a PDF file.');
      input.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      this.isError.set(true);
      this.message.set('Resume PDF must be 5 MB or smaller.');
      input.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || '');
      const base64 = value.includes(',') ? value.split(',')[1] : value;
      this.application.resumeName = file.name;
      this.application.resumeMimeType = file.type || 'application/pdf';
      this.application.resumeSizeBytes = file.size;
      this.application.resumeDataBase64 = base64;
    };
    reader.onerror = () => {
      this.isError.set(true);
      this.message.set('Resume PDF could not be read. Try selecting it again.');
      input.value = '';
    };
    reader.readAsDataURL(file);
  }

  protected dateLabel(value: string): string {
    return new Date(value).toLocaleDateString();
  }

  protected salaryLabel(job: JobListing): string {
    const min = Number(job.salaryMin ?? job.salary ?? 0);
    const max = Number(job.salaryMax ?? min);
    return max > min ? `${this.money(min)} - ${this.money(max)}` : this.money(min);
  }

  protected resumeSizeLabel(): string {
    if (!this.application.resumeSizeBytes) return 'Ready to upload';
    const kb = this.application.resumeSizeBytes / 1024;
    return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB selected` : `${Math.round(kb)} KB selected`;
  }
}
