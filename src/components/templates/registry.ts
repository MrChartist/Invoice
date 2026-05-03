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
  /** Short description of what business this template suits */
  description: string;
  /** Emoji icon representing the business type */
  icon: string;
}

export const TEMPLATES: TemplateMetadata[] = [
  { id: 'classic_orange', name: 'Classic Orange', category: 'Professional', layout: 'classic', accent: '#f07020', fontFamily: 'var(--font-display)', description: 'Versatile template for consultants & agencies', icon: '📋' },
  { id: 'corporate_navy', name: 'Corporate Navy', category: 'Professional', layout: 'corporate', accent: '#1a365d', fontFamily: 'var(--font-serif)', description: 'Formal corporate invoicing with header block', icon: '🏢' },
  { id: 'minimal_clean', name: 'Minimal Clean', category: 'Minimal', layout: 'minimal', accent: '#333333', fontFamily: 'var(--font-body)', description: 'Ultra-clean for solo professionals', icon: '✨' },
  { id: 'swiss_grid', name: 'Swiss Grid', category: 'Minimal', layout: 'classic', accent: '#d32f2f', fontFamily: 'var(--font-body)', description: 'Precision grid layout, Swiss design inspired', icon: '🇨🇭' },
  { id: 'modern_teal', name: 'Modern Teal', category: 'Creative', layout: 'minimal', accent: '#008080', fontFamily: 'var(--font-display)', description: 'Fresh modern look for creative teams', icon: '🎨' },
  { id: 'freelancer_light', name: 'Freelancer Light', category: 'Freelancer', layout: 'centered', accent: '#8b5cf6', fontFamily: 'var(--font-body)', description: 'Centered layout perfect for freelancers', icon: '💻' },
  { id: 'tech_startup', name: 'Tech Startup', category: 'Tech', layout: 'classic', accent: '#10b981', fontFamily: 'var(--font-mono)', description: 'Monospace tech aesthetic for SaaS & IT', icon: '🚀' },
  { id: 'creative_studio', name: 'Creative Studio', category: 'Creative', layout: 'corporate', accent: '#ec4899', fontFamily: 'var(--font-display)', description: 'Bold pink for design & media studios', icon: '🎬' },
  { id: 'medical_clean', name: 'Medical Clean', category: 'Healthcare', layout: 'classic', accent: '#0ea5e9', fontFamily: 'var(--font-body)', description: 'Clean & trustworthy for clinics & labs', icon: '🏥' },
  { id: 'construction_bold', name: 'Construction Bold', category: 'Trade', layout: 'corporate', accent: '#f59e0b', fontFamily: 'var(--font-display)', description: 'High-visibility for contractors & trades', icon: '🔨' },
  { id: 'real_estate', name: 'Real Estate', category: 'Professional', layout: 'classic', accent: '#475569', fontFamily: 'var(--font-serif)', description: 'Elegant for property & brokerage firms', icon: '🏠' },
  { id: 'photography_minimal', name: 'Photography', category: 'Creative', layout: 'minimal', accent: '#000000', fontFamily: 'var(--font-body)', description: 'Pure black minimal for visual artists', icon: '📷' },
  { id: 'retail_receipt', name: 'Retail Receipt', category: 'Retail', layout: 'centered', accent: '#64748b', fontFamily: 'var(--font-mono)', description: 'Receipt-style for shops & retail stores', icon: '🛒' },
  { id: 'architect_line', name: 'Architect Line', category: 'Design', layout: 'minimal', accent: '#0f172a', fontFamily: 'var(--font-body)', description: 'Precision hairlines for architects & engineers', icon: '📐' },
  { id: 'marketing_pop', name: 'Marketing Pop', category: 'Creative', layout: 'corporate', accent: '#f43f5e', fontFamily: 'var(--font-display)', description: 'Vibrant for marketing & ad agencies', icon: '📢' },
  { id: 'accounting_ledger', name: 'Accounting Ledger', category: 'Finance', layout: 'classic', accent: '#166534', fontFamily: 'var(--font-serif)', description: 'Formal ledger style for CA & accountants', icon: '📊' },
  { id: 'luxury_gold', name: 'Luxury Gold', category: 'Premium', layout: 'centered', accent: '#b45309', fontFamily: 'var(--font-serif)', description: 'Premium gold for luxury brands & jewellers', icon: '👑' },
  { id: 'envelope_format', name: 'Envelope Format', category: 'Minimal', layout: 'minimal', accent: '#52525b', fontFamily: 'var(--font-body)', description: 'Letter-style for formal correspondence', icon: '✉️' },
  { id: 'indian_gst', name: 'Indian GST', category: 'Compliance', layout: 'classic', accent: '#1e3a8a', fontFamily: 'var(--font-display)', description: 'GST-compliant layout for Indian businesses', icon: '🇮🇳' },
  { id: 'two_column', name: 'Two-Column Split', category: 'Modern', layout: 'corporate', accent: '#6366f1', fontFamily: 'var(--font-body)', description: 'Modern split layout for tech & services', icon: '📑' },
];
