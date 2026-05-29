export type RegistrationStatus = 'registered' | 'unregistered' | 'expired';
export type SubscriptionStatus = 'trial' | 'active' | 'past_due' | 'none';
export type ComplianceSeverity = 'ok' | 'notice' | 'warning' | 'critical';

export interface SubscriptionPlan {
  id: string;
  name: string;
  monthlyPrice: number;
  productLimit: number;
  features: string[];
}

export interface Vendor {
  id: string;
  name: string;
  slug: string;
  location: string;
  addressLine1?: string;
  addressLine2?: string;
  parish?: string;
  latitude?: number | string | null;
  longitude?: number | string | null;
  rating: number;
  deliveryDays: string[];
  summary: string;
  registrationStatus: RegistrationStatus;
  onboardedAt: string;
  subscriptionStatus: SubscriptionStatus;
  subscriptionPlan: string;
  lastPaymentAt?: string;
  nextBillingAt?: string;
  categories: string[];
  storeType?: 'products' | 'services' | 'foods' | 'mixed' | string;
  status?: 'active' | 'disabled' | 'pending';
}

export interface DiscountSummary {
  id?: string;
  name?: string;
  code?: string;
  discountType?: 'percent' | 'fixed' | string;
  amount?: number;
  scope?: string;
  cartOffer?: boolean;
}

export interface DiscountedPrice {
  price: number;
  originalPrice?: number;
  hasDiscount?: boolean;
  discount?: DiscountSummary | null;
}

export interface Product {
  id: string;
  name: string;
  vendorId: string;
  vendorName?: string;
  vendorSlug?: string;
  category: string;
  price: number;
  originalPrice?: number;
  hasDiscount?: boolean;
  discount?: DiscountSummary | null;
  rating: number;
  deliveryDay: string;
  description: string;
  stockQuantity?: number;
  discountIds?: string;
  discountNames?: string;
  imageUrl?: string;
  isFeatured?: boolean;
  featuredUntil?: string | null;
}

export interface UserProfile {
  name: string;
  email: string;
  phone: string;
  parish: string;
  role: AccountRole;
  preferences: string[];
}

export type AccountRole = 'customer' | 'vendor' | 'admin';

export interface AccountUser {
  id: string;
  name: string;
  emailPhone: string;
  role: AccountRole;
  businessName?: string;
  businessLocation?: string;
  storeType?: string;
}

export interface ServiceReview {
  name: string;
  comment: string;
  rating: number;
}

export interface MarketService {
  id: string;
  name: string;
  vendor: string;
  category: string;
  rating: number;
  price: number;
  pricingType: string;
  description: string;
  details: string;
  imageUrl?: string;
  reviews: ServiceReview[];
}

export interface FoodOffering {
  id: string;
  name: string;
  vendorId: string;
  vendorName?: string;
  vendorSlug?: string;
  price: number;
  originalPrice?: number;
  hasDiscount?: boolean;
  discount?: DiscountSummary | null;
  imageUrl?: string;
  description: string;
}

export interface JobListing {
  id: string;
  title: string;
  employer: string;
  category: string;
  location: string;
  salary: number;
  type: string;
  postedAt: string;
  deadline: string;
  description: string;
  responsibilities: string[];
  requirements: string[];
  contact: string;
  isApproved: boolean;
  status: 'Draft' | 'Published' | 'draft' | 'pending_approval' | 'published' | 'closed' | 'rejected';
}

export const vendors: Vendor[] = [
  {
    id: 'v1',
    name: 'Island Eats',
    slug: 'island-eats',
    location: 'Half Way Tree',
    addressLine1: 'Half Way Tree',
    parish: 'St. Andrew',
    latitude: 18.0125,
    longitude: -76.7981,
    rating: 4.8,
    deliveryDays: ['Mon', 'Wed', 'Fri'],
    summary: 'Jerk meals, patties, event trays, and catering support with scheduled delivery.',
    registrationStatus: 'unregistered',
    onboardedAt: '2026-02-01',
    subscriptionStatus: 'trial',
    subscriptionPlan: 'Starter vendor',
    lastPaymentAt: undefined,
    nextBillingAt: '2026-05-01',
    categories: ['Food', 'Catering']
  },
  {
    id: 'v2',
    name: 'Market Glow',
    slug: 'market-glow',
    location: 'Portmore',
    addressLine1: 'Portmore',
    parish: 'St. Catherine',
    latitude: 17.9503,
    longitude: -76.8827,
    rating: 4.7,
    deliveryDays: ['Wed', 'Fri'],
    summary: 'Beauty, wellness, and daily market essentials from trusted local sellers.',
    registrationStatus: 'registered',
    onboardedAt: '2025-06-15',
    subscriptionStatus: 'active',
    subscriptionPlan: 'Growth vendor',
    lastPaymentAt: '2026-04-15',
    nextBillingAt: '2026-05-15',
    categories: ['Beauty', 'Wellness']
  },
  {
    id: 'v3',
    name: 'Green Grove',
    slug: 'green-grove',
    location: 'Spanish Town',
    addressLine1: 'Spanish Town',
    parish: 'St. Catherine',
    latitude: 17.9911,
    longitude: -76.9574,
    rating: 4.9,
    deliveryDays: ['Tue', 'Fri'],
    summary: 'Fresh produce bundles, fruit crates, herbs, and pantry staples.',
    registrationStatus: 'registered',
    onboardedAt: '2025-09-05',
    subscriptionStatus: 'active',
    subscriptionPlan: 'Growth vendor',
    lastPaymentAt: '2026-04-05',
    nextBillingAt: '2026-05-05',
    categories: ['Produce', 'Groceries']
  }
];

export const subscriptionPlans: SubscriptionPlan[] = [
  {
    id: 'starter',
    name: 'Starter vendor',
    monthlyPrice: 2500,
    productLimit: 25,
    features: ['Storefront', 'QR share tools', 'Basic order dashboard']
  },
  {
    id: 'growth',
    name: 'Growth vendor',
    monthlyPrice: 6500,
    productLimit: 150,
    features: ['Featured placement', 'Service bookings', 'Job posting tools']
  },
  {
    id: 'pro',
    name: 'Pro vendor',
    monthlyPrice: 12500,
    productLimit: 500,
    features: ['Priority support', 'Advanced analytics', 'Campaign support']
  }
];

export const products: Product[] = [
  {
    id: 'p1',
    name: 'Organic Callaloo Bundle',
    vendorId: 'v3',
    category: 'Products',
    price: 2350,
    rating: 4.9,
    deliveryDay: 'Fri',
    description: 'Fresh island greens with herbs and seasoning add-ons.'
  },
  {
    id: 'p2',
    name: 'Jerk Chicken Family Pack',
    vendorId: 'v1',
    category: 'Food',
    price: 4250,
    rating: 4.8,
    deliveryDay: 'Mon',
    description: 'Family meal pack with sides, sauce, and pickup or delivery.'
  },
  {
    id: 'p3',
    name: 'Fresh Pineapple Crate',
    vendorId: 'v3',
    category: 'Products',
    price: 1650,
    rating: 4.7,
    deliveryDay: 'Fri',
    description: 'Seasonal pineapple crate sourced from local growers.'
  },
  {
    id: 'p4',
    name: 'Glow Essentials Kit',
    vendorId: 'v2',
    category: 'Beauty',
    price: 3900,
    rating: 4.7,
    deliveryDay: 'Wed',
    description: 'Beauty and wellness bundle for weekly self-care.'
  }
];

export const marketServices: MarketService[] = [
  {
    id: 'delivery-run',
    name: 'Same-Day Delivery Run',
    vendor: 'Urban Couriers',
    category: 'Delivery Services',
    rating: 4.9,
    price: 1100,
    pricingType: 'Fixed',
    description: 'Send packages, groceries, or urgent items across the city with fast local delivery.',
    details: 'Includes up to 3 stops and live drop-off updates. Extra stops can be added after booking.',
    reviews: [
      { name: 'Janice A.', comment: 'Picked up my package and delivered it within hours. Super reliable.', rating: 5 },
      { name: 'Marcus L.', comment: 'Great service for last-minute deliveries. Easy booking.', rating: 4 }
    ]
  },
  {
    id: 'home-repairs',
    name: 'Home Repairs & Maintenance',
    vendor: 'Fix-It Crew',
    category: 'Home Services',
    rating: 4.8,
    price: 2800,
    pricingType: 'Hourly',
    description: 'Local technicians for plumbing, electrical, carpentry, and small home repairs.',
    details: 'Technician arrives with basic tools and materials. Exact quote is provided after assessment.',
    reviews: [
      { name: 'Sasha D.', comment: 'Quick response and excellent workmanship.', rating: 5 },
      { name: 'Derek P.', comment: 'Very professional crew. Fixed our door and lighting well.', rating: 4 }
    ]
  },
  {
    id: 'personal-care',
    name: 'Personal Care & Grooming',
    vendor: 'Glow Mobile Salon',
    category: 'Personal Services',
    rating: 4.7,
    price: 2000,
    pricingType: 'Fixed',
    description: 'Mobile beauty and grooming services for haircuts, manicures, and styling.',
    details: 'Good for busy days, events, or appointments at home. Add extra treatments when you book.',
    reviews: [
      { name: 'Alicia R.', comment: 'Loved the convenience and the stylist did an amazing job.', rating: 5 },
      { name: 'Trevor M.', comment: 'Friendly and arrived on time.', rating: 4 }
    ]
  },
  {
    id: 'errand-run',
    name: 'Errands & Pickup Service',
    vendor: 'Errand Express',
    category: 'Errands / Pickup Services',
    rating: 4.6,
    price: 950,
    pricingType: 'Fixed',
    description: 'Run errands, pick up groceries, or collect parcels from local stores and vendors.',
    details: 'Ideal for grocery pickups, merchant collections, and small time-sensitive errands.',
    reviews: [
      { name: 'Nadine T.', comment: 'Consistent and convenient. Saved me so much time.', rating: 5 },
      { name: 'Jason K.', comment: 'Very helpful and responsive.', rating: 4 }
    ]
  }
];

export const foodOfferings: FoodOffering[] = [
  { id: 'f1', name: 'Spicy Jerk Chicken', vendorId: 'v1', price: 2750, description: 'Hot jerk chicken meal for families and events.' },
  { id: 'f2', name: 'Patties & Sides', vendorId: 'v1', price: 1620, description: 'Assorted patty platter with drinks and snacks.' },
  { id: 'f3', name: 'Fresh Fruit Crate', vendorId: 'v3', price: 2100, description: 'Seasonal fruits sourced from local growers.' },
  { id: 'f4', name: 'Island Breakfast Box', vendorId: 'v1', price: 1980, description: 'Breakfast items with coffee, buns, and fresh juice.' }
];

export const initialJobs: JobListing[] = [
  {
    id: 'jm001',
    title: 'Marketplace Delivery Coordinator',
    employer: 'Island Logistics',
    category: 'Delivery',
    location: 'Kingston',
    salary: 2400,
    type: 'Full-time',
    postedAt: '2026-04-10',
    deadline: '2026-05-05',
    description: 'Coordinate delivery teams, manage routes, and ensure on-time pickup for marketplace orders.',
    responsibilities: ['Plan delivery routes', 'Communicate with vendors and drivers', 'Track performance and delivery time'],
    requirements: ['Excellent communication skills', 'Experience with local logistics', 'Ability to work with scheduling tools'],
    contact: 'jobs@islandlogistics.jm',
    isApproved: true,
    status: 'Published'
  },
  {
    id: 'jm002',
    title: 'Freelance Website Builder',
    employer: 'Market Glow',
    category: 'Digital Services',
    location: 'Remote',
    salary: 1800,
    type: 'Contract',
    postedAt: '2026-04-12',
    deadline: '2026-05-01',
    description: 'Build landing pages and e-commerce storefronts for local vendors using simple responsive design.',
    responsibilities: ['Develop websites', 'Collect vendor assets', 'Deploy finished pages'],
    requirements: ['Web development experience', 'Responsive design skills', 'Basic SEO knowledge'],
    contact: 'talent@marketglow.jm',
    isApproved: true,
    status: 'Published'
  },
  {
    id: 'jm003',
    title: 'Event Catering Assistant',
    employer: 'Island Eats',
    category: 'Hospitality',
    location: 'Portmore',
    salary: 1200,
    type: 'Part-time',
    postedAt: '2026-04-14',
    deadline: '2026-04-28',
    description: 'Support catering events with food prep, delivery setup, and customer service during meals.',
    responsibilities: ['Prepare food packages', 'Assist at event sites', 'Communicate with customers and vendors'],
    requirements: ['Friendly customer service', 'Weekend availability', 'Food handling experience preferred'],
    contact: 'careers@islandeats.jm',
    isApproved: true,
    status: 'Published'
  }
];

export const currentUser: UserProfile = {
  name: 'Alicia Brown',
  email: 'alicia@example.com',
  phone: '(876) 555-0134',
  parish: 'Kingston',
  role: 'vendor',
  preferences: ['Fresh produce', 'Ready meals', 'Delivery updates']
};

function isStarterPlan(vendor: Vendor): boolean {
  return vendor.subscriptionPlan.toLowerCase().includes('starter');
}

function isPublicVendor(vendor: Vendor): boolean {
  return vendor.registrationStatus === 'registered'
    && vendor.subscriptionStatus === 'active'
    && !isStarterPlan(vendor);
}

function isRegisteredVendor(vendorId: string): boolean {
  return vendors.some((vendor) => vendor.id === vendorId && isPublicVendor(vendor));
}

export function vendorById(id: string): Vendor | undefined {
  return vendors.find((vendor) => vendor.id === id && isPublicVendor(vendor));
}

export function vendorBySlug(slug: string): Vendor | undefined {
  return vendors.find((vendor) => vendor.slug === slug && isPublicVendor(vendor));
}

export function productsForVendor(vendorId: string): Product[] {
  return isRegisteredVendor(vendorId) ? products.filter((product) => product.vendorId === vendorId) : [];
}

export function serviceById(id: string): MarketService | undefined {
  return marketServices.find((service) => service.id === id);
}

export function jobById(id: string, jobs = initialJobs): JobListing | undefined {
  return jobs.find((job) => job.id === id);
}

export function formatCurrency(value: number): string {
  return `JMD ${value.toLocaleString()}`;
}

export function hasDiscountPrice(item: DiscountedPrice): boolean {
  const price = Number(item.price || 0);
  const originalPrice = Number(item.originalPrice ?? price);
  return Boolean(item.hasDiscount) || originalPrice > price;
}

export function discountLabelFor(item: DiscountedPrice): string {
  const discount = item.discount;
  if (!discount) return 'Vendor offer';

  const amount = Number(discount.amount || 0);
  const value = discount.discountType === 'fixed'
    ? `${formatCurrency(amount)} off`
    : amount > 0 ? `${amount}% off` : '';
  const name = discount.name || discount.code || 'Vendor offer';
  return value ? `${name}: ${value}` : name;
}

export function unregisteredExpiry(vendor: Vendor): Date {
  const expiry = new Date(vendor.onboardedAt);
  expiry.setFullYear(expiry.getFullYear() + 1);
  return expiry;
}

export function daysUntilExpiry(vendor: Vendor): number {
  const milliseconds = unregisteredExpiry(vendor).getTime() - Date.now();
  return Math.ceil(milliseconds / 86400000);
}

export function complianceSeverity(vendor: Vendor): ComplianceSeverity {
  if (vendor.subscriptionStatus === 'past_due') {
    return 'critical';
  }

  if (vendor.registrationStatus === 'unregistered') {
    const daysLeft = daysUntilExpiry(vendor);
    if (daysLeft < 0) {
      return 'critical';
    }
    if ([90, 30, 7].some((threshold) => daysLeft <= threshold)) {
      return daysLeft <= 7 ? 'critical' : 'warning';
    }
    return 'notice';
  }

  return 'ok';
}

export function complianceMessage(vendor: Vendor): string {
  if (vendor.subscriptionStatus === 'past_due') {
    return 'Subscription is past due. Product publishing should be paused until payment is restored.';
  }

  if (vendor.registrationStatus === 'unregistered') {
    const daysLeft = daysUntilExpiry(vendor);
    if (daysLeft < 0) {
      return 'Registration window expired. Business registration is required before this store can appear publicly.';
    }
    return 'Business registration is required before this store and its listings can appear publicly. Offer registration assistance.';
  }

  return 'Vendor is compliant.';
}

export function canPublishProducts(vendor: Vendor): boolean {
  return vendor.subscriptionStatus === 'active'
    && vendor.registrationStatus === 'registered'
    && !isStarterPlan(vendor);
}
