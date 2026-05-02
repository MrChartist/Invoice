export interface CompanyProfile {
  id: string;
  name: string;
  tagline?: string;
  address: string;
  gstin?: string;
  pan?: string;
  email: string;
  phone?: string;
  website?: string;
  logo?: string; // base64 data URI
  bankName?: string;
  accountNumber?: string;
  ifsc?: string;
  upiId?: string;
  invoicePrefix: string;
}

export interface Client {
  id: string;
  name: string;
  address: string;
  gstin?: string;
  email?: string;
  phone?: string;
  notes?: string;
}

export interface ServiceTemplate {
  id: string;
  name: string;
  description?: string;
  defaultRate: number;
  hsnSacCode?: string;
  taxRate: number;
}

export interface LineItem {
  id: string;
  description: string;
  quantity: number;
  rate: number;
  hsnSacCode?: string;
  taxRate: number;
}

export interface TaxConfig {
  type: 'IGST' | 'CGST_SGST' | 'NONE';
  isReverseCharge: boolean;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  issueDate: string; // ISO string
  dueDate: string;   // ISO string
  
  senderId: string; // references CompanyProfile
  
  // Embedded Client Details (Snapshot at time of creation)
  clientName: string;
  clientEmail: string;
  clientAddress: string;
  clientGstin?: string;
  
  items: LineItem[];
  
  taxConfig: TaxConfig;
  discount: number; // absolute amount
  notes?: string;
  terms?: string;
  
  status: 'Draft' | 'Sent' | 'Paid' | 'Overdue';
  currency: string;
}
  
