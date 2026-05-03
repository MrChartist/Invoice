import type { InvoiceState, SenderProfile } from '../../store/useInvoiceStore';

export interface TemplateProps {
  invoice: InvoiceState;
  sender: SenderProfile;
}

export type TemplateLayout = 'classic' | 'minimal' | 'corporate' | 'centered';

export interface TemplateMetadata {
  id: string;
  name: string;
  category: string;
  layout: TemplateLayout;
  accent: string;
  fontFamily: string;
}

export const TEMPLATES: TemplateMetadata[] = [
  { id: 'classic_orange', name: 'Classic Orange', category: 'Professional', layout: 'classic', accent: '#f07020', fontFamily: 'var(--font-display)' },
  { id: 'corporate_navy', name: 'Corporate Navy', category: 'Professional', layout: 'corporate', accent: '#1a365d', fontFamily: 'var(--font-serif)' },
  { id: 'minimal_clean', name: 'Minimal Clean', category: 'Minimal', layout: 'minimal', accent: '#333333', fontFamily: 'var(--font-body)' },
  { id: 'swiss_grid', name: 'Swiss Grid', category: 'Minimal', layout: 'classic', accent: '#d32f2f', fontFamily: 'var(--font-body)' },
  { id: 'modern_teal', name: 'Modern Teal', category: 'Creative', layout: 'minimal', accent: '#008080', fontFamily: 'var(--font-display)' },
  { id: 'freelancer_light', name: 'Freelancer Light', category: 'Freelancer', layout: 'centered', accent: '#8b5cf6', fontFamily: 'var(--font-body)' },
  { id: 'tech_startup', name: 'Tech Startup', category: 'Tech', layout: 'classic', accent: '#10b981', fontFamily: 'var(--font-mono)' },
  { id: 'creative_studio', name: 'Creative Studio', category: 'Creative', layout: 'corporate', accent: '#ec4899', fontFamily: 'var(--font-display)' },
  { id: 'medical_clean', name: 'Medical Clean', category: 'Healthcare', layout: 'classic', accent: '#0ea5e9', fontFamily: 'var(--font-body)' },
  { id: 'construction_bold', name: 'Construction Bold', category: 'Trade', layout: 'corporate', accent: '#f59e0b', fontFamily: 'var(--font-display)' },
  { id: 'real_estate', name: 'Real Estate', category: 'Professional', layout: 'classic', accent: '#475569', fontFamily: 'var(--font-serif)' },
  { id: 'photography_minimal', name: 'Photography Minimal', category: 'Creative', layout: 'minimal', accent: '#000000', fontFamily: 'var(--font-body)' },
  { id: 'retail_receipt', name: 'Retail Receipt', category: 'Retail', layout: 'centered', accent: '#64748b', fontFamily: 'var(--font-mono)' },
  { id: 'architect_line', name: 'Architect Line', category: 'Design', layout: 'minimal', accent: '#0f172a', fontFamily: 'var(--font-body)' },
  { id: 'marketing_pop', name: 'Marketing Pop', category: 'Creative', layout: 'corporate', accent: '#f43f5e', fontFamily: 'var(--font-display)' },
  { id: 'accounting_ledger', name: 'Accounting Ledger', category: 'Finance', layout: 'classic', accent: '#166534', fontFamily: 'var(--font-serif)' },
  { id: 'luxury_gold', name: 'Luxury Gold', category: 'Premium', layout: 'centered', accent: '#b45309', fontFamily: 'var(--font-serif)' },
  { id: 'envelope_format', name: 'Envelope Format', category: 'Minimal', layout: 'minimal', accent: '#52525b', fontFamily: 'var(--font-body)' },
  { id: 'indian_gst', name: 'Indian GST', category: 'Compliance', layout: 'classic', accent: '#1e3a8a', fontFamily: 'var(--font-display)' },
  { id: 'two_column', name: 'Two-Column Split', category: 'Modern', layout: 'corporate', accent: '#6366f1', fontFamily: 'var(--font-body)' },
];
