import { Injectable, signal } from '@angular/core';
import { apiUrl } from './api-url';
import { JobListing } from './market-data';

export interface JobApplication {
  id: string;
  jobId: string;
  jobTitle: string;
  employer: string;
  applicantName: string;
  phone: string;
  resumeName: string;
  message: string;
  status: 'Pending' | 'Reviewed';
  appliedAt: string;
}

const APPLICATIONS_KEY = 'urbanMarketJAApplications';

@Injectable({ providedIn: 'root' })
export class JobService {
  private readonly jobsSignal = signal<JobListing[]>([]);
  private readonly applicationsSignal = signal<JobApplication[]>(this.loadApplications());
  private readonly errorSignal = signal('');

  readonly jobs = this.jobsSignal.asReadonly();
  readonly applications = this.applicationsSignal.asReadonly();
  readonly error = this.errorSignal.asReadonly();

  constructor() {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    try {
      const response = await fetch(apiUrl('/api/jobs'));
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Jobs could not be loaded.');
      }
      const jobs = await response.json() as JobListing[];
      const normalized = jobs.map((job) => this.normalizeJob(job));
      this.jobsSignal.set(normalized);
      this.errorSignal.set('');
    } catch (error) {
      this.errorSignal.set(error instanceof Error ? error.message : 'Jobs could not be loaded.');
    }
  }

  async loadJob(id: string): Promise<void> {
    try {
      const response = await fetch(apiUrl(`/api/jobs/${encodeURIComponent(id)}`));
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Job could not be loaded.');
      }
      const job = this.normalizeJob(await response.json() as JobListing);
      this.jobsSignal.set(this.jobsSignal().some((item) => item.id === job.id)
        ? this.jobsSignal().map((item) => item.id === job.id ? job : item)
        : [...this.jobsSignal(), job]);
      this.errorSignal.set('');
    } catch (error) {
      this.errorSignal.set(error instanceof Error ? error.message : 'Job could not be loaded.');
    }
  }

  saveJob(job: JobListing): void {
    const jobs = this.jobsSignal();
    const exists = jobs.some((item) => item.id === job.id);
    const next = exists ? jobs.map((item) => item.id === job.id ? job : item) : [...jobs, job];
    this.jobsSignal.set(next);
  }

  addApplication(application: Omit<JobApplication, 'id' | 'status' | 'appliedAt'>): void {
    const next = [
      ...this.applicationsSignal(),
      {
        ...application,
        id: `app${Date.now()}`,
        status: 'Pending' as const,
        appliedAt: new Date().toISOString()
      }
    ];
    this.applicationsSignal.set(next);
    this.save(APPLICATIONS_KEY, next);
  }

  private loadApplications(): JobApplication[] {
    return this.load<JobApplication[]>(APPLICATIONS_KEY, []);
  }

  private load<T>(key: string, fallback: T): T {
    if (typeof localStorage === 'undefined') {
      return fallback;
    }

    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) as T : fallback;
    } catch {
      return fallback;
    }
  }

  private save<T>(key: string, value: T): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, JSON.stringify(value));
    }
  }

  private normalizeJob(job: JobListing): JobListing {
    const status = job.status || (job.isApproved ? 'published' : 'pending_approval');
    return {
      ...job,
      salary: Number(job.salary || 0),
      responsibilities: Array.isArray(job.responsibilities) ? job.responsibilities : [],
      requirements: Array.isArray(job.requirements) ? job.requirements : [],
      postedAt: job.postedAt || new Date().toISOString(),
      deadline: job.deadline || '',
      isApproved: job.isApproved || status === 'published' || status === 'Published',
      status
    };
  }
}
