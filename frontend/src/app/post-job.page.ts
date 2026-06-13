import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiUrl } from './api-url';
import { AuthService } from './auth.service';
import { JobService } from './job.service';
import { JobListing } from './market-data';

@Component({
  selector: 'app-post-job-page',
  imports: [FormsModule],
  template: `
    <main>
      <section class="page-hero">
        <div class="container page-header">
          <p class="eyebrow">Post a job</p>
          <h1>Create a local hiring listing</h1>
          <p>Save as draft or publish for admin approval.</p>
        </div>
      </section>

      <section class="container section">
        <form class="profile-form wide-form" (ngSubmit)="save('Published')">
          <div class="form-grid">
            <label>Job title <input name="title" [(ngModel)]="job.title" required></label>
            <label>Employer <input name="employer" [(ngModel)]="job.employer" required></label>
            <label>Category <select name="category" [(ngModel)]="job.category"><option>Delivery</option><option>Retail</option><option>Digital Services</option><option>Hospitality</option><option>Home Services</option><option>Other</option></select></label>
            <label>Location <input name="location" [(ngModel)]="job.location" required></label>
            <label>Job type <select name="type" [(ngModel)]="job.type"><option>Full-time</option><option>Part-time</option><option>Contract</option><option>Temporary</option><option>Internship</option><option>Remote</option><option>One-time Gig</option></select></label>
            <label>Minimum salary / pay <input name="salaryMin" type="number" min="0" [(ngModel)]="job.salaryMin" placeholder="Minimum amount in JMD" required></label>
            <label>Maximum salary / pay <input name="salaryMax" type="number" min="0" [(ngModel)]="job.salaryMax" placeholder="Maximum amount in JMD" required></label>
            <label>Deadline <input name="deadline" type="date" [(ngModel)]="job.deadline" required></label>
            <label>Contact <input name="contact" [(ngModel)]="job.contact" required></label>
          </div>

          <label>Description <textarea name="description" [(ngModel)]="job.description" rows="5" placeholder="Describe the role, schedule, and work expectations" required></textarea></label>
          <label>Responsibilities <textarea name="responsibilities" [(ngModel)]="responsibilitiesText" rows="4" placeholder="List the main duties" required></textarea></label>
          <label>Requirements <textarea name="requirements" [(ngModel)]="requirementsText" rows="4" placeholder="List qualifications and skills" required></textarea></label>

          <div class="checkout-actions">
            <button class="button secondary-button" type="button" [disabled]="isSaving()" (click)="save('Draft')">Save as draft</button>
            <button class="button primary-button" type="submit" [disabled]="isSaving()">{{ isSaving() ? 'Saving...' : 'Publish job' }}</button>
          </div>
          @if (message()) {
            <div class="notice" [class.error]="isError()">{{ message() }}</div>
          }
        </form>
      </section>
    </main>
  `
})
export class PostJobPage {
  private readonly auth = inject(AuthService);
  private readonly jobService = inject(JobService);
  protected responsibilitiesText = '';
  protected requirementsText = '';
  protected readonly message = signal('');
  protected readonly isError = signal(false);
  protected readonly isSaving = signal(false);

  protected job: Omit<JobListing, 'salary' | 'salaryMin' | 'salaryMax'> & { salaryMin: number | null; salaryMax: number | null } = {
    id: `jm${Date.now()}`,
    title: '',
    employer: '',
    category: 'Delivery',
    location: '',
    salaryMin: null,
    salaryMax: null,
    type: 'Full-time',
    postedAt: new Date().toISOString().split('T')[0],
    deadline: '',
    description: '',
    responsibilities: [],
    requirements: [],
    contact: '',
    isApproved: false,
    status: 'Draft'
  };

  protected async save(status: 'Draft' | 'Published'): Promise<void> {
    const salaryMin = Number(this.job.salaryMin) || 0;
    const salaryMax = Math.max(salaryMin, Number(this.job.salaryMax) || salaryMin);
    const savedJob: JobListing = {
      ...this.job,
      salary: salaryMin,
      salaryMin,
      salaryMax,
      status,
      isApproved: false,
      responsibilities: this.responsibilitiesText.split('\n').map((item) => item.trim()).filter(Boolean),
      requirements: this.requirementsText.split('\n').map((item) => item.trim()).filter(Boolean)
    };
    this.isSaving.set(true);
    this.isError.set(false);
    this.message.set('');
    try {
      const response = await fetch(apiUrl('/api/jobs'), {
        method: 'POST',
        headers: this.auth.authHeaders(),
        body: JSON.stringify(savedJob)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Job could not be saved.');
      }
      this.jobService.saveJob(payload as JobListing);
      await this.jobService.refresh();
      this.message.set(status === 'Published'
        ? 'Job submitted and pending admin approval.'
        : 'Job saved as draft.');
    } catch (error) {
      this.isError.set(true);
      this.message.set(error instanceof Error ? error.message : 'Job could not be saved.');
    } finally {
      this.isSaving.set(false);
    }
  }
}
