import React, { createContext, useContext, useState, useEffect } from 'react';
import type { CompanyProfile, Client, ServiceTemplate, Invoice } from '../types/invoice';

interface AppState {
  profiles: CompanyProfile[];
  clients: Client[];
  catalog: ServiceTemplate[];
  invoices: Invoice[];
  currentInvoiceId: string | null;
}

interface InvoiceContextType {
  state: AppState;
  
  // Profiles
  addProfile: (profile: CompanyProfile) => void;
  updateProfile: (profile: CompanyProfile) => void;
  deleteProfile: (id: string) => void;
  
  // Clients
  addClient: (client: Client) => void;
  updateClient: (client: Client) => void;
  deleteClient: (id: string) => void;
  
  // Catalog
  addService: (service: ServiceTemplate) => void;
  updateService: (service: ServiceTemplate) => void;
  deleteService: (id: string) => void;
  
  // Invoices
  saveInvoice: (invoice: Invoice) => void;
  deleteInvoice: (id: string) => void;
  setCurrentInvoice: (id: string | null) => void;
}

const defaultState: AppState = {
  profiles: [
    {
      id: 'default-profile',
      name: 'Mr. Chartist',
      tagline: 'SEBI Registered Research Analyst — INH000015297',
      address: 'Mumbai, Maharashtra, India',
      email: 'mrchartist@zohomail.in',
      website: 'www.mrchartist.com',
      invoicePrefix: 'MRC',
    }
  ],
  clients: [],
  catalog: [],
  invoices: [],
  currentInvoiceId: null,
};

const InvoiceContext = createContext<InvoiceContextType | undefined>(undefined);

export const InvoiceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AppState>(() => {
    const saved = localStorage.getItem('mrchartist_invoice_state');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return { ...defaultState, ...parsed };
      } catch (e) {
        console.error('Failed to parse state', e);
      }
    }
    return defaultState;
  });

  useEffect(() => {
    localStorage.setItem('mrchartist_invoice_state', JSON.stringify(state));
  }, [state]);

  const updateState = (updater: (prev: AppState) => AppState) => {
    setState(updater);
  };

  const value: InvoiceContextType = {
    state,
    
    addProfile: (p) => updateState(s => ({ ...s, profiles: [...s.profiles, p] })),
    updateProfile: (p) => updateState(s => ({ ...s, profiles: s.profiles.map(x => x.id === p.id ? p : x) })),
    deleteProfile: (id) => updateState(s => ({ ...s, profiles: s.profiles.filter(x => x.id !== id) })),
    
    addClient: (c) => updateState(s => ({ ...s, clients: [...s.clients, c] })),
    updateClient: (c) => updateState(s => ({ ...s, clients: s.clients.map(x => x.id === c.id ? c : x) })),
    deleteClient: (id) => updateState(s => ({ ...s, clients: s.clients.filter(x => x.id !== id) })),
    
    addService: (sv) => updateState(s => ({ ...s, catalog: [...s.catalog, sv] })),
    updateService: (sv) => updateState(s => ({ ...s, catalog: s.catalog.map(x => x.id === sv.id ? sv : x) })),
    deleteService: (id) => updateState(s => ({ ...s, catalog: s.catalog.filter(x => x.id !== id) })),
    
    saveInvoice: (inv) => updateState(s => {
      const exists = s.invoices.find(x => x.id === inv.id);
      if (exists) {
        return { ...s, invoices: s.invoices.map(x => x.id === inv.id ? inv : x) };
      }
      return { ...s, invoices: [...s.invoices, inv] };
    }),
    deleteInvoice: (id) => updateState(s => ({ 
      ...s, 
      invoices: s.invoices.filter(x => x.id !== id),
      currentInvoiceId: s.currentInvoiceId === id ? null : s.currentInvoiceId
    })),
    setCurrentInvoice: (id) => updateState(s => ({ ...s, currentInvoiceId: id })),
  };

  return <InvoiceContext.Provider value={value}>{children}</InvoiceContext.Provider>;
};

export const useInvoiceStore = () => {
  const context = useContext(InvoiceContext);
  if (context === undefined) {
    throw new Error('useInvoiceStore must be used within an InvoiceProvider');
  }
  return context;
};
